const MICROSECONDS_PER_SECOND = 1_000_000;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const integerUs = (value) => finite(value) ? Math.round(value) : null;
const frameToUs = (frame, fps) => finite(frame) && finite(fps) && fps > 0
    ? Math.round(frame / fps * MICROSECONDS_PER_SECOND)
    : null;
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function diagnostic(severity, code, message, context = {}) {
    return { severity, code, message, ...context };
}

function stableSerialize(value) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item === undefined ? null : item)).join(',')}]`;
    if (value && typeof value === 'object') {
        const entries = Object.keys(value)
            .filter((key) => value[key] !== undefined)
            .sort(compareText)
            .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(null);
}

function fingerprint(value) {
    const text = stableSerialize(value);
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= BigInt(text.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return `rp1-${hash.toString(16).padStart(16, '0')}`;
}

function sequenceDurationUs(sequence) {
    if (finite(sequence.durationUs)) return Math.max(0, Math.round(sequence.durationUs));
    if (finite(sequence.masterInUs) && finite(sequence.masterOutUs)) {
        return Math.max(0, Math.round(sequence.masterOutUs - sequence.masterInUs));
    }
    const duration = frameToUs(sequence.outFrame - sequence.inFrame, sequence.sourceFps);
    return duration === null ? null : Math.max(0, duration);
}

function legacyFullCut(sequence, durationUs) {
    const mediaId = sequence.sourceType === 'group' ? sequence.activeMediaId : sequence.sourceId;
    return [{ id: `legacy-${sequence.id}`, startUs: 0, endUs: durationUs, mediaId, legacy: true }];
}

function normalizedCuts(sequence, durationUs, diagnostics) {
    const context = { sequenceId: sequence.id };
    const rawCuts = Array.isArray(sequence.videoCuts)
        ? sequence.videoCuts
        : legacyFullCut(sequence, durationUs);
    if (!rawCuts.length) {
        diagnostics.push(diagnostic('error', 'VIDEO_CUTS_EMPTY', 'Der Moment besitzt keinen finalen Kamera-Cut.', context));
        return [];
    }
    const cuts = rawCuts.map((cut, index) => ({
        ...cut,
        id: typeof cut?.id === 'string' && cut.id ? cut.id : `cut-${index + 1}`,
        startUs: integerUs(cut?.startUs),
        endUs: integerUs(cut?.endUs),
        mediaId: typeof cut?.mediaId === 'string' && cut.mediaId ? cut.mediaId : null,
        inputIndex: index,
    })).sort((left, right) => (
        (left.startUs ?? Number.MAX_SAFE_INTEGER) - (right.startUs ?? Number.MAX_SAFE_INTEGER)
        || (left.endUs ?? Number.MAX_SAFE_INTEGER) - (right.endUs ?? Number.MAX_SAFE_INTEGER)
        || compareText(left.id, right.id)
        || left.inputIndex - right.inputIndex
    ));
    const seenIds = new Set();
    let cursor = 0;
    for (const cut of cuts) {
        const cutContext = { ...context, cutId: cut.id, ...(cut.mediaId ? { mediaId: cut.mediaId } : {}) };
        if (seenIds.has(cut.id)) diagnostics.push(diagnostic('error', 'VIDEO_CUT_ID_DUPLICATE', 'Kamera-Cut-IDs müssen innerhalb eines Moments eindeutig sein.', cutContext));
        seenIds.add(cut.id);
        if (cut.startUs === null || cut.endUs === null || cut.startUs < 0 || cut.endUs <= cut.startUs || cut.endUs > durationUs) {
            diagnostics.push(diagnostic('error', 'VIDEO_CUT_RANGE_INVALID', 'Der Kamera-Cut liegt außerhalb der Momentdauer oder besitzt keine positive Dauer.', cutContext));
            continue;
        }
        if (!cut.mediaId) diagnostics.push(diagnostic('error', 'VIDEO_CUT_MEDIA_MISSING', 'Dem Kamera-Cut ist keine finale Kamera zugeordnet.', cutContext));
        if (cut.startUs > cursor) diagnostics.push(diagnostic('error', 'VIDEO_CUT_GAP', `Vor diesem Kamera-Cut fehlen ${cut.startUs - cursor} Mikrosekunden Bild.`, cutContext));
        if (cut.startUs < cursor) diagnostics.push(diagnostic('error', 'VIDEO_CUT_OVERLAP', `Dieser Kamera-Cut überlappt den vorherigen um ${cursor - cut.startUs} Mikrosekunden.`, cutContext));
        cursor = Math.max(cursor, cut.endUs);
    }
    if (cursor < durationUs) diagnostics.push(diagnostic('error', 'VIDEO_CUT_GAP', `Am Ende des Moments fehlen ${durationUs - cursor} Mikrosekunden Bild.`, context));
    return cuts;
}

function angleRange(angle, durationUs) {
    const fps = finite(angle?.sourceFps) && angle.sourceFps > 0 ? angle.sourceFps : null;
    const sourceStartUs = integerUs(angle?.sourceStartUs ?? angle?.inUs) ?? frameToUs(angle?.inFrame, fps);
    const frameDurationUs = frameToUs(angle?.outFrame - angle?.inFrame, fps);
    const sourceEndUs = integerUs(angle?.sourceEndUs ?? angle?.outUs)
        ?? (sourceStartUs === null || frameDurationUs === null ? null : sourceStartUs + frameDurationUs);
    if (sourceStartUs === null || sourceEndUs === null || sourceEndUs <= sourceStartUs) return null;
    const explicitMomentStart = integerUs(angle?.momentStartUs);
    const explicitMomentEnd = integerUs(angle?.momentEndUs);
    const momentStartUs = explicitMomentStart ?? 0;
    const momentEndUs = explicitMomentEnd ?? Math.min(durationUs, sourceEndUs - sourceStartUs);
    return { sourceStartUs, sourceEndUs, momentStartUs, momentEndUs, sourceFps: fps };
}

function mediaContext(project, sequence, mediaId, durationUs, diagnostics, context) {
    const media = project.media.find((item) => item?.id === mediaId);
    if (!media) {
        diagnostics.push(diagnostic('error', 'MEDIA_MISSING', 'Die final gewählte Quelldatei ist nicht mehr im Projekt vorhanden.', context));
        return null;
    }
    if (sequence.sourceType === 'group') {
        const group = project.groups.find((item) => item?.id === sequence.sourceId);
        if (!group) {
            diagnostics.push(diagnostic('error', 'MULTICAM_GROUP_MISSING', 'Die Multicam-Gruppe des Moments ist nicht mehr vorhanden.', context));
            return null;
        }
        if (!Array.isArray(group.mediaIds) || !group.mediaIds.includes(mediaId)) {
            diagnostics.push(diagnostic('error', 'MEDIA_NOT_IN_GROUP', 'Die final gewählte Kamera gehört nicht zur Multicam-Gruppe.', context));
            return null;
        }
        const angle = Array.isArray(sequence.multicamAngles)
            ? sequence.multicamAngles.find((item) => item?.mediaId === mediaId)
            : null;
        if (!angle) {
            diagnostics.push(diagnostic('error', 'ANGLE_MISSING', 'Für die final gewählte Kamera existiert kein synchronisierter Winkel.', context));
            return null;
        }
        const range = angleRange(angle, durationUs);
        if (!range) {
            diagnostics.push(diagnostic('error', 'ANGLE_RANGE_INVALID', 'Der synchronisierte Quellbereich der Kamera ist ungültig.', context));
            return null;
        }
        return { media, range };
    }
    if (sequence.sourceId !== mediaId) {
        diagnostics.push(diagnostic('error', 'MEDIA_NOT_SEQUENCE_SOURCE', 'Ein Einzelclip-Moment darf nicht auf eine andere Quelldatei schneiden.', context));
        return null;
    }
    const sourceStartUs = frameToUs(sequence.inFrame, sequence.sourceFps) ?? 0;
    return { media, range: { sourceStartUs, sourceEndUs: sourceStartUs + durationUs, momentStartUs: 0, momentEndUs: durationUs, sourceFps: sequence.sourceFps } };
}

function resolveSourceRange(project, sequence, cut, durationUs, diagnostics, purpose = 'video') {
    const context = { sequenceId: sequence.id, cutId: cut.id, ...(cut.mediaId ? { mediaId: cut.mediaId } : {}) };
    if (!cut.mediaId || cut.startUs === null || cut.endUs === null || cut.endUs <= cut.startUs) return null;
    const offsetUs = purpose === 'audio' ? integerUs(cut.offsetUs) ?? 0 : 0;
    const explicitSourceStartUs = integerUs(cut.sourceStartUs);
    const explicitSourceEndUs = integerUs(cut.sourceEndUs);
    if (purpose === 'audio' && explicitSourceStartUs !== null && explicitSourceEndUs !== null) {
        const media = project.media.find((item) => item?.id === cut.mediaId);
        if (!media) {
            diagnostics.push(diagnostic('error', 'MEDIA_MISSING', 'Die gewählte Tonquelle ist nicht mehr im Projekt vorhanden.', context));
            return null;
        }
        if (media.hasAudio === false && media.kind !== 'audio') {
            diagnostics.push(diagnostic('error', 'AUDIO_SOURCE_UNAVAILABLE', 'Die gewählte Tonquelle enthält keine Audiospur.', context));
            return null;
        }
        const adjustedStartUs = explicitSourceStartUs + offsetUs;
        const adjustedEndUs = explicitSourceEndUs + offsetUs;
        if (adjustedStartUs < 0 || adjustedEndUs <= adjustedStartUs || adjustedEndUs - adjustedStartUs !== cut.endUs - cut.startUs) {
            diagnostics.push(diagnostic('error', 'AUDIO_SOURCE_RANGE_INVALID', 'Der lokale Tonbereich ist ungültig oder stimmt nicht mit der Cut-Dauer überein.', context));
            return null;
        }
        if (finite(media.durationSeconds) && adjustedEndUs > Math.round(media.durationSeconds * MICROSECONDS_PER_SECOND)) {
            diagnostics.push(diagnostic('error', offsetUs ? 'AUDIO_OFFSET_OUT_OF_BOUNDS' : 'SOURCE_RANGE_OUTSIDE_MEDIA', 'Audio-Offset und Momentdauer reichen über die verfügbare Tonquelle hinaus.', context));
            return null;
        }
        return { media, sourceStartUs: adjustedStartUs, sourceEndUs: adjustedEndUs, sourceFps: null };
    }
    const resolved = mediaContext(project, sequence, cut.mediaId, durationUs, diagnostics, context);
    if (!resolved) return null;
    if (purpose === 'video' && resolved.media.kind && resolved.media.kind !== 'video') {
        diagnostics.push(diagnostic('error', 'VIDEO_SOURCE_NOT_VIDEO', 'Der Kamera-Cut verweist nicht auf eine Videodatei.', context));
        return null;
    }
    if (purpose === 'audio' && resolved.media.hasAudio === false && resolved.media.kind !== 'audio') {
        diagnostics.push(diagnostic('error', 'AUDIO_SOURCE_UNAVAILABLE', 'Die gewählte Tonquelle enthält keine Audiospur.', context));
        return null;
    }
    const range = resolved.range;
    if (cut.startUs < range.momentStartUs || cut.endUs > range.momentEndUs) {
        diagnostics.push(diagnostic('error', 'ANGLE_COVERAGE_INCOMPLETE', 'Die gewählte Kamera deckt den gesamten Cut auf der gemeinsamen Zeitachse nicht ab.', context));
        return null;
    }
    const unshiftedStartUs = explicitSourceStartUs ?? range.sourceStartUs + (cut.startUs - range.momentStartUs);
    const unshiftedEndUs = explicitSourceEndUs ?? unshiftedStartUs + (cut.endUs - cut.startUs);
    if (unshiftedStartUs < range.sourceStartUs || unshiftedEndUs > range.sourceEndUs || unshiftedEndUs <= unshiftedStartUs) {
        diagnostics.push(diagnostic('error', 'SOURCE_RANGE_OUTSIDE_ANGLE', 'Der lokale Quellbereich liegt außerhalb des synchronisierten Winkels.', context));
        return null;
    }
    const sourceStartUs = unshiftedStartUs + offsetUs;
    const sourceEndUs = unshiftedEndUs + offsetUs;
    if (sourceStartUs < 0 || sourceEndUs <= sourceStartUs) {
        diagnostics.push(diagnostic('error', purpose === 'audio' && offsetUs ? 'AUDIO_OFFSET_OUT_OF_BOUNDS' : 'SOURCE_RANGE_OUTSIDE_MEDIA', 'Der lokale Quellbereich liegt außerhalb der Mediendatei.', context));
        return null;
    }
    if (finite(resolved.media.durationSeconds) && sourceEndUs > Math.round(resolved.media.durationSeconds * MICROSECONDS_PER_SECOND)) {
        diagnostics.push(diagnostic('error', purpose === 'audio' && offsetUs ? 'AUDIO_OFFSET_OUT_OF_BOUNDS' : 'SOURCE_RANGE_OUTSIDE_MEDIA', 'Der lokale Quellbereich reicht über das Ende der Mediendatei hinaus.', context));
        return null;
    }
    return { media: resolved.media, sourceStartUs, sourceEndUs, sourceFps: range.sourceFps };
}

function normalizedAudioCuts(sequence, durationUs, videoCuts, diagnostics) {
    if (sequence.audioPlan?.mode === 'muted' || sequence.audioPlan?.muted === true) return [];
    const explicitCuts = Array.isArray(sequence.audioCuts)
        ? sequence.audioCuts
        : Array.isArray(sequence.audioPlan?.cuts)
            ? sequence.audioPlan.cuts
            : null;
    if (explicitCuts) return explicitCuts.map((cut, index) => ({ ...cut, id: cut?.id || `audio-${index + 1}` }));
    if (sequence.audioPlan?.mode === 'follow-camera') {
        return videoCuts.map((cut) => ({
            id: `audio-${cut.id}`,
            startUs: cut.startUs,
            endUs: cut.endUs,
            mediaId: cut.mediaId,
            gainDb: sequence.audioPlan?.gainDb ?? 0,
        }));
    }
    const mediaId = sequence.audioPlan?.mediaId ?? sequence.audioPlan?.sourceMediaId
        ?? (sequence.videoCuts ? null : (sequence.sourceType === 'group' ? sequence.activeMediaId : sequence.sourceId));
    if (mediaId) {
        if (!sequence.audioPlan && sequence.sourceType === 'group') {
            diagnostics.push(diagnostic('warning', 'LEGACY_AUDIO_FOLLOWS_VIDEO', 'Dieses v8-Multicam-Moment verwendet weiterhin den Ton der gewählten Bildkamera.', { sequenceId: sequence.id, mediaId }));
        }
        const sourceStartUs = integerUs(sequence.audioPlan?.sourceStartUs);
        const sourceEndUs = integerUs(sequence.audioPlan?.sourceEndUs)
            ?? (sourceStartUs === null ? null : sourceStartUs + durationUs);
        return [{
            id: `audio-${sequence.id}`,
            startUs: 0,
            endUs: durationUs,
            mediaId,
            offsetUs: sequence.audioPlan?.mode === 'master' ? sequence.audioPlan.offsetUs ?? 0 : 0,
            gainDb: sequence.audioPlan?.gainDb ?? 0,
            ...(sourceStartUs === null ? {} : { sourceStartUs, sourceEndUs }),
        }];
    }
    if (videoCuts.length) diagnostics.push(diagnostic('warning', 'AUDIO_PLAN_MISSING', 'Für den Moment ist keine unabhängige Tonquelle festgelegt.', { sequenceId: sequence.id }));
    return [];
}

function compileAudioSegments(project, sequence, durationUs, videoCuts, filmStartUs, diagnostics) {
    const rawCuts = normalizedAudioCuts(sequence, durationUs, videoCuts, diagnostics);
    const cuts = rawCuts.map((cut, index) => ({
        ...cut,
        id: typeof cut?.id === 'string' && cut.id ? cut.id : `audio-${index + 1}`,
        startUs: integerUs(cut?.startUs),
        endUs: integerUs(cut?.endUs),
        mediaId: typeof cut?.mediaId === 'string' && cut.mediaId ? cut.mediaId : null,
        offsetUs: integerUs(cut?.offsetUs) ?? 0,
        gainDb: finite(cut?.gainDb) ? cut.gainDb : 0,
    })).sort((left, right) => (left.startUs ?? Number.MAX_SAFE_INTEGER) - (right.startUs ?? Number.MAX_SAFE_INTEGER) || compareText(left.id, right.id));
    const segments = [];
    let cursor = 0;
    for (const cut of cuts) {
        const context = { sequenceId: sequence.id, cutId: cut.id, ...(cut.mediaId ? { mediaId: cut.mediaId } : {}) };
        if (cut.startUs === null || cut.endUs === null || cut.startUs < 0 || cut.endUs <= cut.startUs || cut.endUs > durationUs) {
            diagnostics.push(diagnostic('error', 'AUDIO_CUT_RANGE_INVALID', 'Der Audiobereich ist ungültig.', context));
            continue;
        }
        if (cut.startUs > cursor) diagnostics.push(diagnostic('error', 'AUDIO_CUT_GAP', 'Der Moment besitzt eine Lücke in seiner Tonabdeckung.', context));
        if (cut.startUs < cursor) diagnostics.push(diagnostic('error', 'AUDIO_CUT_OVERLAP', 'Audiobereiche des Moments überlappen sich.', context));
        cursor = Math.max(cursor, cut.endUs);
        const source = resolveSourceRange(project, sequence, cut, durationUs, diagnostics, 'audio');
        if (!source) continue;
        segments.push({
            id: `${sequence.id}:${cut.id}`,
            sequenceId: sequence.id,
            audioCutId: cut.id,
            mediaId: cut.mediaId,
            startUs: cut.startUs,
            endUs: cut.endUs,
            filmStartUs: filmStartUs + cut.startUs,
            filmEndUs: filmStartUs + cut.endUs,
            sourceStartUs: source.sourceStartUs,
            sourceEndUs: source.sourceEndUs,
            offsetUs: cut.offsetUs,
            gainDb: cut.gainDb,
        });
    }
    if (cuts.length && cursor < durationUs) diagnostics.push(diagnostic('error', 'AUDIO_CUT_GAP', 'Der Moment besitzt am Ende keine vollständige Tonabdeckung.', { sequenceId: sequence.id }));
    return segments;
}

function tracerTimeRange(tracer, sequence) {
    const startUs = integerUs(tracer.startUs)
        ?? frameToUs(tracer.impactFrame ?? tracer.points?.[0]?.frame ?? 0, sequence.sourceFps)
        ?? 0;
    const endUs = integerUs(tracer.endUs)
        ?? frameToUs(tracer.disappearFrame ?? tracer.endFrame ?? tracer.points?.at?.(-1)?.frame ?? 0, sequence.sourceFps)
        ?? startUs;
    return { startUs, endUs: Math.max(startUs, endUs) };
}

function compileTracerPlacements(project, sequence, videoSegments, diagnostics) {
    const tracers = (project.shotTracers ?? []).filter((tracer) => tracer?.sequenceId === sequence.id && tracer.enabled !== false);
    const placements = [];
    for (const tracer of tracers) {
        const context = { sequenceId: sequence.id, tracerId: tracer.id };
        const binding = tracer.binding ?? {};
        if (!binding.cutId && !binding.mediaId && videoSegments.length > 1) {
            diagnostics.push(diagnostic('error', 'TRACER_BINDING_REQUIRED', 'Ein Shot-Tracer in einem Multicut-Moment muss an einen Cut oder Winkel gebunden sein.', context));
            continue;
        }
        const matching = videoSegments.filter((segment) => (
            (!binding.cutId || segment.cutId === binding.cutId)
            && (!binding.mediaId || segment.mediaId === binding.mediaId)
        ));
        if (!matching.length) {
            diagnostics.push(diagnostic('error', 'TRACER_BINDING_CONFLICT', 'Der Shot-Tracer passt zu keinem finalen Kamera-Cut.', { ...context, ...(binding.cutId ? { cutId: binding.cutId } : {}), ...(binding.mediaId ? { mediaId: binding.mediaId } : {}) }));
            continue;
        }
        const time = tracerTimeRange(tracer, sequence);
        for (const segment of matching) {
            const startUs = Math.max(segment.startUs, time.startUs);
            const endUs = Math.min(segment.endUs, time.endUs);
            if (endUs <= startUs) continue;
            placements.push({
                id: `${tracer.id}:${segment.cutId}`,
                tracerId: tracer.id,
                sequenceId: sequence.id,
                cutId: segment.cutId,
                mediaId: segment.mediaId,
                startUs,
                endUs,
                filmStartUs: segment.filmStartUs + (startUs - segment.startUs),
                filmEndUs: segment.filmStartUs + (endUs - segment.startUs),
                effect: tracer,
            });
        }
        if (!placements.some((placement) => placement.tracerId === tracer.id)) {
            diagnostics.push(diagnostic('warning', 'TRACER_OUTSIDE_CUT', 'Der Zeitbereich des Shot-Tracers überschneidet keinen gebundenen Kamera-Cut.', context));
        }
    }
    return placements;
}

/**
 * Compile the project into a deterministic, renderer-independent source of truth.
 * Invalid inputs produce diagnostics; cameras are never silently substituted.
 */
export function compileRenderPlan(projectValue, sequenceIdsValue) {
    const project = projectValue && typeof projectValue === 'object' ? projectValue : {};
    const diagnostics = [];
    const media = Array.isArray(project.media) ? project.media : [];
    const groups = Array.isArray(project.groups) ? project.groups : [];
    const sequences = Array.isArray(project.sequences) ? project.sequences : [];
    const blocks = Array.isArray(project.blocks) ? project.blocks : [];
    const normalizedProject = { ...project, media, groups, sequences, blocks, shotTracers: Array.isArray(project.shotTracers) ? project.shotTracers : [] };
    const sequenceIds = Array.isArray(sequenceIdsValue) ? sequenceIdsValue : [];
    const seenSequenceIds = new Set();
    const videoSegments = [];
    const audioSegments = [];
    const tracerPlacements = [];
    const moments = [];
    let filmCursorUs = 0;

    sequenceIds.forEach((sequenceId, order) => {
        if (typeof sequenceId !== 'string' || !sequenceId) {
            diagnostics.push(diagnostic('error', 'SEQUENCE_ID_INVALID', 'Der Renderplan enthält eine ungültige Sequenz-ID.', { order }));
            return;
        }
        if (seenSequenceIds.has(sequenceId)) {
            diagnostics.push(diagnostic('error', 'SEQUENCE_DUPLICATE', 'Eine Sequenz darf im Renderplan nicht doppelt vorkommen.', { sequenceId, order }));
            return;
        }
        seenSequenceIds.add(sequenceId);
        const sequence = sequences.find((item) => item?.id === sequenceId);
        if (!sequence) {
            diagnostics.push(diagnostic('error', 'SEQUENCE_MISSING', 'Eine angeforderte Sequenz ist nicht im Projekt vorhanden.', { sequenceId, order }));
            return;
        }
        const durationUs = sequenceDurationUs(sequence);
        if (durationUs === null || durationUs <= 0) {
            diagnostics.push(diagnostic('error', 'SEQUENCE_DURATION_INVALID', 'Die Sequenz besitzt keine gültige positive Dauer.', { sequenceId, order }));
            return;
        }
        const block = blocks.find((item) => item?.id === sequence.targetBlockId);
        if (!block) diagnostics.push(diagnostic('error', 'BLOCK_MISSING', 'Der Golfmoment verweist auf keinen vorhandenen Golfblock.', { sequenceId, blockId: sequence.targetBlockId }));
        if (sequence.sourceType === 'group' && !groups.some((group) => group?.id === sequence.sourceId)) {
            diagnostics.push(diagnostic('error', 'MULTICAM_GROUP_MISSING', 'Die Multicam-Gruppe des Moments ist nicht mehr vorhanden.', { sequenceId, groupId: sequence.sourceId }));
        }
        if (sequence.sourceType !== 'group' && sequence.sourceType !== 'media') {
            diagnostics.push(diagnostic('error', 'SEQUENCE_SOURCE_TYPE_INVALID', 'Der Moment besitzt keinen unterstützten Quelltyp.', { sequenceId }));
        }
        const cuts = normalizedCuts(sequence, durationUs, diagnostics);
        const momentVideoSegments = [];
        for (const cut of cuts) {
            const source = resolveSourceRange(normalizedProject, sequence, cut, durationUs, diagnostics, 'video');
            if (!source || cut.startUs === null || cut.endUs === null) continue;
            const segment = {
                id: `${sequence.id}:${cut.id}`,
                sequenceId: sequence.id,
                cutId: cut.id,
                order: momentVideoSegments.length,
                mediaId: cut.mediaId,
                blockId: sequence.targetBlockId,
                startUs: cut.startUs,
                endUs: cut.endUs,
                filmStartUs: filmCursorUs + cut.startUs,
                filmEndUs: filmCursorUs + cut.endUs,
                sourceStartUs: source.sourceStartUs,
                sourceEndUs: source.sourceEndUs,
                sourceFps: source.sourceFps,
            };
            momentVideoSegments.push(segment);
            videoSegments.push(segment);
        }
        const momentAudioSegments = compileAudioSegments(normalizedProject, sequence, durationUs, cuts, filmCursorUs, diagnostics);
        audioSegments.push(...momentAudioSegments);
        const momentTracerPlacements = compileTracerPlacements(normalizedProject, sequence, momentVideoSegments, diagnostics);
        tracerPlacements.push(...momentTracerPlacements);
        moments.push({
            sequenceId: sequence.id,
            order,
            blockId: sequence.targetBlockId,
            hole: block?.hole ?? null,
            playerId: block?.playerId ?? null,
            startUs: filmCursorUs,
            endUs: filmCursorUs + durationUs,
            durationUs,
            videoSegmentIds: momentVideoSegments.map((segment) => segment.id),
            audioSegmentIds: momentAudioSegments.map((segment) => segment.id),
            tracerPlacementIds: momentTracerPlacements.map((placement) => placement.id),
            review: sequence.review && typeof sequence.review === 'object' ? {
                status: sequence.review.status ?? 'unreviewed',
                reviewedFingerprint: sequence.review.reviewedFingerprint ?? null,
            } : null,
        });
        filmCursorUs += durationUs;
    });

    const valid = !diagnostics.some((item) => item.severity === 'error');
    const selectedMediaIds = new Set([
        ...videoSegments.map((segment) => segment.mediaId),
        ...audioSegments.map((segment) => segment.mediaId),
    ]);
    const selectedBlockIds = new Set(moments.map((moment) => moment.blockId));
    const renderState = {
        version: 1,
        valid,
        totalDurationUs: filmCursorUs,
        moments: moments.map(({ review: _review, ...moment }) => moment),
        videoSegments,
        audioSegments,
        tracerPlacements,
        media: media.filter((item) => selectedMediaIds.has(item?.id)).sort((left, right) => compareText(left.id, right.id)),
        blocks: blocks.filter((item) => selectedBlockIds.has(item?.id)).sort((left, right) => compareText(left.id, right.id)),
        overlays: (Array.isArray(project.overlays) ? project.overlays : [])
            .filter((overlay) => seenSequenceIds.has(overlay?.sequenceId))
            .sort((left, right) => compareText(left.id ?? '', right.id ?? '')),
        settings: project.settings ?? null,
        courseData: project.courseData ?? null,
        playerScores: project.playerScores ?? null,
    };
    return {
        version: 1,
        valid,
        renderFingerprint: fingerprint(renderState),
        totalDurationUs: filmCursorUs,
        moments,
        videoSegments,
        audioSegments,
        tracerPlacements,
        diagnostics,
    };
}
