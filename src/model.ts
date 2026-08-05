import {
    BLOCK_TYPES,
    type BlockType,
    type GolfBlock,
    type GolfProject,
    type HoleData,
    type MediaItem,
    type MulticamAngle,
    type MulticamSuggestion,
    type OverlayPosition,
    type OverlayType,
    type PlayerHoleScore,
    type ProjectSettings,
    type SequenceDraft,
    type ShotDetails,
    type ShotTracerEffect,
    type ShotTracerPoint,
} from './types';

const CORE_BLOCKS: BlockType[] = ['tee-shot', 'approach', 'greenside', 'putt'];
const SHOT_BLOCKS = new Set<BlockType>(['tee-shot', 'approach', 'greenside', 'bunker', 'putt', 'extra-shot', 'penalty']);

const id = () => crypto.randomUUID();

export function blockLabel(type: BlockType): string {
    return BLOCK_TYPES.find(([value]) => value === type)?.[1] ?? type;
}

export function defaultShotDetails(type: BlockType, shotNumber: number | null = null): ShotDetails {
    return {
        shotNumber: SHOT_BLOCKS.has(type) ? shotNumber : null,
        club: '', distanceMeters: null, result: '', notes: '',
    };
}

export function createDefaultCourseData(settings: ProjectSettings) {
    return {
        scorecardSourcePath: null,
        holes: Array.from({ length: settings.holes }, (_, index): HoleData => ({
            number: index + 1, par: 4, lengthMeters: null, strokeIndex: null, teeColor: '',
        })),
    };
}

export function createDefaultBlocks(settings: ProjectSettings): GolfBlock[] {
    const blocks: GolfBlock[] = [];
    for (let hole = 1; hole <= settings.holes; hole += 1) {
        for (const player of settings.players) {
            CORE_BLOCKS.forEach((type, order) => {
                blocks.push({
                    id: id(),
                    hole,
                    playerId: player.id,
                    type,
                    label: blockLabel(type),
                    order,
                    sequenceIds: [],
                    details: defaultShotDetails(type, order + 1),
                });
            });
        }
    }
    return blocks;
}

export function createProject(settings: ProjectSettings): GolfProject {
    return {
        schemaVersion: 8,
        settings,
        media: [],
        suggestions: [],
        groups: [],
        blocks: createDefaultBlocks(settings),
        sequences: [],
        overlays: [],
        shotTracers: [],
        playerOrders: [],
        courseData: createDefaultCourseData(settings),
        playerScores: [],
        modifiedAt: new Date().toISOString(),
    };
}

export function normalizeProject(input: unknown): GolfProject {
    if (!input || typeof input !== 'object') throw new Error('Ungültige Projektdatei.');
    const raw = input as Partial<GolfProject>;
    if (!raw.settings?.course || !Array.isArray(raw.settings.players)) {
        throw new Error('Die Projektdatei enthält keine gültigen Runden-Einstellungen.');
    }
    const settings: ProjectSettings = {
        ...raw.settings,
        orientation: raw.settings.orientation ?? 'horizontal',
        resolution: raw.settings.resolution ?? '4K',
        frameRate: raw.settings.frameRate ?? 60,
    };
    const blocks = Array.isArray(raw.blocks) && raw.blocks.length
        ? raw.blocks.map((block) => ({
            ...block,
            sequenceIds: [...(block.sequenceIds ?? [])],
            details: { ...defaultShotDetails(block.type, SHOT_BLOCKS.has(block.type) ? block.order + 1 : null), ...(block.details ?? {}) },
        }))
        : createDefaultBlocks(settings);
    const defaultCourseData = createDefaultCourseData(settings);
    const rawHoles = raw.courseData?.holes ?? [];
    const courseData = {
        scorecardSourcePath: raw.courseData?.scorecardSourcePath ?? null,
        holes: defaultCourseData.holes.map((hole) => ({ ...hole, ...(rawHoles.find((item) => item.number === hole.number) ?? {}) })),
    };
    return {
        schemaVersion: 8,
        settings,
        media: Array.isArray(raw.media) ? raw.media : [],
        suggestions: Array.isArray(raw.suggestions) ? raw.suggestions : [],
        groups: Array.isArray(raw.groups) ? raw.groups.map((group) => ({
            ...group,
            syncOffsetsSeconds: Object.fromEntries(Object.entries(group.syncOffsetsSeconds ?? {})
                .filter(([, value]) => typeof value === 'number' && Number.isFinite(value))
                .map(([mediaId, value]) => [mediaId, Math.min(3600, Math.max(-3600, Math.round(value * 1000) / 1000))])),
        })) : [],
        blocks,
        sequences: Array.isArray(raw.sequences) ? raw.sequences.map((sequence) => ({
            ...sequence,
            activeMediaId: sequence.sourceType === 'group' ? sequence.activeMediaId : undefined,
            multicamAngles: sequence.sourceType === 'group' && Array.isArray(sequence.multicamAngles)
                ? sequence.multicamAngles.map((angle) => ({
                    mediaId: angle.mediaId,
                    inFrame: Math.max(0, Math.round(angle.inFrame)),
                    outFrame: Math.max(1, Math.round(angle.outFrame)),
                    sourceFps: angle.sourceFps,
                }))
                : undefined,
        })) : [],
        overlays: Array.isArray(raw.overlays) ? raw.overlays.map((overlay) => ({
            ...overlay,
            position: overlay.position ?? (overlay.type === 'hole-info' ? 'top-right' : overlay.type === 'score-card' ? 'top-left' : 'bottom-left'),
        })) : [],
        shotTracers: Array.isArray(raw.shotTracers) ? raw.shotTracers.map((tracer) => ({
            ...tracer,
            color: tracer.color ?? '#c8ff42',
            thickness: tracer.thickness ?? 5,
            glow: tracer.glow ?? 12,
            smoothing: tracer.smoothing ?? 0.72,
            tailLength: tracer.tailLength ?? 0.16,
            occlusionStartFrame: tracer.occlusionStartFrame ?? null,
            occlusionEndFrame: tracer.occlusionEndFrame ?? null,
            cameraLock: tracer.cameraLock ?? null,
            points: Array.isArray(tracer.points) ? tracer.points.map((point) => ({
                frame: Math.max(0, Math.round(point.frame)),
                x: Math.min(1, Math.max(0, point.x)),
                y: Math.min(1, Math.max(0, point.y)),
                kind: point.kind,
            })) : [],
        })) : [],
        playerOrders: Array.isArray(raw.playerOrders) ? raw.playerOrders : [],
        courseData,
        playerScores: Array.isArray(raw.playerScores) ? raw.playerScores : [],
        modifiedAt: raw.modifiedAt ?? new Date().toISOString(),
    };
}

export function upsertSequence(project: GolfProject, draft: SequenceDraft): GolfProject {
    if (draft.outFrame <= draft.inFrame) throw new Error('Der Out-Punkt muss hinter dem In-Punkt liegen.');
    const now = new Date().toISOString();
    const oldSequence = draft.id ? project.sequences.find((sequence) => sequence.id === draft.id) : undefined;
    let blocks = project.blocks.map((block) => ({ ...block, sequenceIds: [...block.sequenceIds] }));
    let target = draft.targetBlockId
        ? blocks.find((block) => block.id === draft.targetBlockId && block.hole === draft.hole && block.playerId === draft.playerId)
        : blocks.find((block) => (
            block.hole === draft.hole
            && block.playerId === draft.playerId
            && block.type === draft.blockType
        ));
    if (!target) {
        const order = Math.max(-1, ...blocks
            .filter((block) => block.hole === draft.hole && block.playerId === draft.playerId)
            .map((block) => block.order)) + 1;
        target = {
            id: id(),
            hole: draft.hole,
            playerId: draft.playerId,
            type: draft.blockType,
            label: blockLabel(draft.blockType),
            order,
            sequenceIds: [],
            details: defaultShotDetails(draft.blockType, order + 1),
        };
        blocks = [...blocks, target];
    }
    const sequenceId = oldSequence?.id ?? id();
    blocks = blocks.map((block) => ({
        ...block,
        sequenceIds: block.id === target!.id
            ? [...new Set([...block.sequenceIds, sequenceId])]
            : block.sequenceIds.filter((value) => value !== sequenceId),
    }));
    const sequence = {
        id: sequenceId,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        inFrame: Math.max(0, Math.round(draft.inFrame)),
        outFrame: Math.max(1, Math.round(draft.outFrame)),
        sourceFps: draft.sourceFps,
        activeMediaId: draft.sourceType === 'group' ? draft.activeMediaId : undefined,
        multicamAngles: draft.sourceType === 'group' ? draft.multicamAngles : undefined,
        targetBlockId: target.id,
        createdAt: oldSequence?.createdAt ?? now,
        updatedAt: now,
    };
    return {
        ...project,
        schemaVersion: 8,
        blocks,
        sequences: oldSequence
            ? project.sequences.map((item) => item.id === sequenceId ? sequence : item)
            : [...project.sequences, sequence],
        modifiedAt: now,
    };
}

export function removeSequence(project: GolfProject, sequenceId: string): GolfProject {
    return {
        ...project,
        blocks: project.blocks.map((block) => ({
            ...block,
            sequenceIds: block.sequenceIds.filter((id) => id !== sequenceId),
        })),
        sequences: project.sequences.filter((sequence) => sequence.id !== sequenceId),
        overlays: project.overlays.filter((overlay) => overlay.sequenceId !== sequenceId),
        shotTracers: project.shotTracers.filter((tracer) => tracer.sequenceId !== sequenceId),
        modifiedAt: new Date().toISOString(),
    };
}

function touch(project: GolfProject, blocks: GolfBlock[], sequences = project.sequences): GolfProject {
    return { ...project, blocks, sequences, modifiedAt: new Date().toISOString() };
}

function nextBlockLabel(project: GolfProject, hole: number, playerId: string, type: BlockType): string {
    const count = project.blocks.filter((block) => block.hole === hole && block.playerId === playerId && block.type === type).length;
    return count ? `${blockLabel(type)} ${count + 1}` : blockLabel(type);
}

export function addBlock(project: GolfProject, hole: number, playerId: string, type: BlockType): GolfProject {
    const lane = project.blocks.filter((block) => block.hole === hole && block.playerId === playerId);
    const block: GolfBlock = {
        id: id(), hole, playerId, type,
        label: nextBlockLabel(project, hole, playerId, type),
        order: Math.max(-1, ...lane.map((item) => item.order)) + 1,
        sequenceIds: [],
        details: defaultShotDetails(type, SHOT_BLOCKS.has(type) ? lane.length + 1 : null),
    };
    return touch(project, [...project.blocks, block]);
}

export function duplicateBlock(project: GolfProject, blockId: string): GolfProject {
    const original = project.blocks.find((block) => block.id === blockId);
    if (!original) return project;
    const lane = project.blocks.filter((block) => block.hole === original.hole && block.playerId === original.playerId);
    const duplicate: GolfBlock = {
        ...original,
        id: id(),
        label: nextBlockLabel(project, original.hole, original.playerId, original.type),
        order: original.order + 1,
        sequenceIds: [],
        details: { ...original.details },
    };
    const blocks = project.blocks.map((block) => (
        block.hole === original.hole && block.playerId === original.playerId && block.order > original.order
            ? { ...block, order: block.order + 1 }
            : block
    ));
    return touch(project, [...blocks, duplicate]);
}

export function deleteBlock(project: GolfProject, blockId: string): GolfProject {
    const removed = project.blocks.find((block) => block.id === blockId);
    if (!removed) return project;
    const removedSequences = new Set(removed.sequenceIds);
    const blocks = project.blocks
        .filter((block) => block.id !== blockId)
        .map((block) => block.hole === removed.hole && block.playerId === removed.playerId && block.order > removed.order
            ? { ...block, order: block.order - 1 }
            : block);
    return {
        ...touch(project, blocks, project.sequences.filter((sequence) => !removedSequences.has(sequence.id))),
        overlays: project.overlays.filter((overlay) => !removedSequences.has(overlay.sequenceId)),
        shotTracers: project.shotTracers.filter((tracer) => !removedSequences.has(tracer.sequenceId)),
    };
}

export function moveBlock(project: GolfProject, blockId: string, direction: -1 | 1): GolfProject {
    const current = project.blocks.find((block) => block.id === blockId);
    if (!current) return project;
    const lane = project.blocks
        .filter((block) => block.hole === current.hole && block.playerId === current.playerId)
        .sort((left, right) => left.order - right.order);
    const index = lane.findIndex((block) => block.id === blockId);
    const swap = lane[index + direction];
    if (!swap) return project;
    return touch(project, project.blocks.map((block) => {
        if (block.id === current.id) return { ...block, order: swap.order };
        if (block.id === swap.id) return { ...block, order: current.order };
        return block;
    }));
}

export function moveSequence(project: GolfProject, blockId: string, sequenceId: string, direction: -1 | 1): GolfProject {
    const block = project.blocks.find((item) => item.id === blockId);
    if (!block) return project;
    const index = block.sequenceIds.indexOf(sequenceId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= block.sequenceIds.length) return project;
    const sequenceIds = [...block.sequenceIds];
    [sequenceIds[index], sequenceIds[target]] = [sequenceIds[target], sequenceIds[index]];
    return touch(project, project.blocks.map((item) => item.id === blockId ? { ...item, sequenceIds } : item));
}

export function roughCutSequenceIds(project: GolfProject, onlyHole?: number): string[] {
    const holes = onlyHole
        ? [onlyHole]
        : Array.from({ length: project.settings.holes }, (_, index) => index + 1);
    const result: string[] = [];
    for (const hole of holes) {
        const lanes = new Map(project.settings.players.map((player) => [player.id, project.blocks
            .filter((block) => block.hole === hole && block.playerId === player.id)
            .sort((left, right) => left.order - right.order)]));
        const longestLane = Math.max(0, ...[...lanes.values()].map((lane) => lane.length));
        for (let blockIndex = 0; blockIndex < longestLane; blockIndex += 1) {
            for (const playerId of effectivePlayerOrder(project, hole, blockIndex)) {
                const block = lanes.get(playerId)?.[blockIndex];
                if (block) result.push(...block.sequenceIds);
            }
        }
    }
    return result.filter((sequenceId) => project.sequences.some((sequence) => sequence.id === sequenceId));
}

export function toggleSequenceOverlay(project: GolfProject, sequenceId: string, type: OverlayType): GolfProject {
    const existing = project.overlays.find((overlay) => overlay.sequenceId === sequenceId && overlay.type === type);
    const sequence = project.sequences.find((item) => item.id === sequenceId);
    if (!sequence) return project;
    const overlays = existing
        ? project.overlays.map((overlay) => overlay.id === existing.id ? { ...overlay, enabled: !overlay.enabled } : overlay)
        : [...project.overlays, {
            id: id(), sequenceId, type, enabled: true, startFrame: 0,
            endFrame: sequence.outFrame - sequence.inFrame,
            position: type === 'hole-info' ? 'top-right' as const : type === 'score-card' ? 'top-left' as const : 'bottom-left' as const,
        }];
    return { ...project, schemaVersion: 8, overlays, modifiedAt: new Date().toISOString() };
}

function defaultShotTracer(sequence: GolfProject['sequences'][number]): ShotTracerEffect {
    const duration = Math.max(1, sequence.outFrame - sequence.inFrame);
    const endFrame = Math.max(1, Math.round(duration * 0.78));
    return {
        id: id(), sequenceId: sequence.id, enabled: true,
        impactFrame: 0, endFrame, disappearFrame: duration,
        points: [
            { frame: 0, x: 0.32, y: 0.76, kind: 'impact' },
            { frame: Math.round(endFrame * 0.48), x: 0.57, y: 0.22, kind: 'curve' },
            { frame: endFrame, x: 0.82, y: 0.44, kind: 'landing' },
        ],
        color: '#c8ff42', thickness: 5, glow: 12, smoothing: 0.72, tailLength: 0.16,
        occlusionStartFrame: null, occlusionEndFrame: null,
        cameraLock: null,
    };
}

export function toggleShotTracer(project: GolfProject, sequenceId: string): GolfProject {
    const existing = project.shotTracers.find((tracer) => tracer.sequenceId === sequenceId);
    const sequence = project.sequences.find((item) => item.id === sequenceId);
    if (!sequence) return project;
    const shotTracers = existing
        ? project.shotTracers.map((tracer) => tracer.id === existing.id ? { ...tracer, enabled: !tracer.enabled } : tracer)
        : [...project.shotTracers, defaultShotTracer(sequence)];
    return { ...project, schemaVersion: 8, shotTracers, modifiedAt: new Date().toISOString() };
}

export function updateShotTracer(project: GolfProject, sequenceId: string, patch: Partial<Omit<ShotTracerEffect, 'id' | 'sequenceId'>>): GolfProject {
    const tracer = project.shotTracers.find((item) => item.sequenceId === sequenceId);
    const sequence = project.sequences.find((item) => item.id === sequenceId);
    if (!tracer || !sequence) return project;
    const duration = Math.max(1, sequence.outFrame - sequence.inFrame);
    const impactFrame = Math.min(duration - 1, Math.max(0, Math.round(patch.impactFrame ?? tracer.impactFrame ?? 0)));
    const endFrame = Math.min(duration, Math.max(impactFrame + 1, Math.round(patch.endFrame ?? tracer.endFrame ?? duration)));
    const disappearFrame = Math.min(duration, Math.max(endFrame, Math.round(patch.disappearFrame ?? tracer.disappearFrame ?? duration)));
    const points = (patch.points ?? tracer.points).map((point): ShotTracerPoint => ({
        frame: Math.min(duration, Math.max(0, Math.round(point.frame))),
        x: Math.min(1, Math.max(0, point.x)),
        y: Math.min(1, Math.max(0, point.y)),
        kind: point.kind,
    })).sort((left, right) => left.frame - right.frame);
    const updated: ShotTracerEffect = {
        ...tracer, ...patch, impactFrame, endFrame, disappearFrame, points,
        thickness: Math.min(16, Math.max(1, patch.thickness ?? tracer.thickness)),
        glow: Math.min(30, Math.max(0, patch.glow ?? tracer.glow)),
        smoothing: Math.min(1, Math.max(0, patch.smoothing ?? tracer.smoothing)),
        tailLength: Math.min(.5, Math.max(.04, patch.tailLength ?? tracer.tailLength ?? .16)),
        occlusionStartFrame: patch.occlusionStartFrame === null ? null : Math.min(duration, Math.max(0, Math.round(patch.occlusionStartFrame ?? tracer.occlusionStartFrame ?? 0))),
        occlusionEndFrame: patch.occlusionEndFrame === null ? null : Math.min(duration, Math.max(0, Math.round(patch.occlusionEndFrame ?? tracer.occlusionEndFrame ?? 0))),
    };
    return {
        ...project,
        schemaVersion: 8,
        shotTracers: project.shotTracers.map((item) => item.id === tracer.id ? updated : item),
        modifiedAt: new Date().toISOString(),
    };
}

export function proposeShotTracer(project: GolfProject, sequenceId: string, x: number, y: number, direction: -1 | 1): GolfProject {
    const sequence = project.sequences.find((item) => item.id === sequenceId);
    if (!sequence) return project;
    let next = project.shotTracers.some((tracer) => tracer.sequenceId === sequenceId)
        ? project
        : toggleShotTracer(project, sequenceId);
    const tracer = next.shotTracers.find((item) => item.sequenceId === sequenceId)!;
    const duration = Math.max(1, sequence.outFrame - sequence.inFrame);
    const impactFrame = Math.min(duration - 1, Math.max(0, tracer.impactFrame ?? 0));
    const endFrame = Math.max(impactFrame + 1, Math.round(impactFrame + (duration - impactFrame) * 0.78));
    const horizontalSpace = direction > 0 ? 1 - x : x;
    const reach = Math.min(0.5, Math.max(0.22, horizontalSpace * 0.7));
    const endX = Math.min(0.96, Math.max(0.04, x + direction * reach));
    const apexX = x + (endX - x) * 0.52;
    const apexY = Math.max(0.06, y - Math.min(0.58, Math.max(0.28, y * 0.68)));
    return updateShotTracer(next, sequenceId, {
        enabled: true, endFrame, disappearFrame: duration,
        points: [
            { frame: impactFrame, x, y, kind: 'impact' },
            { frame: Math.round(impactFrame + (endFrame - impactFrame) * 0.48), x: apexX, y: apexY, kind: 'curve' },
            { frame: endFrame, x: endX, y: Math.min(0.9, Math.max(apexY + 0.12, y - 0.16)), kind: 'landing' },
        ],
    });
}

export function updateSequenceOverlay(project: GolfProject, sequenceId: string, type: OverlayType, patch: Partial<{ startFrame: number; endFrame: number; position: OverlayPosition }>): GolfProject {
    const overlay = project.overlays.find((item) => item.sequenceId === sequenceId && item.type === type);
    if (!overlay) return project;
    const sequence = project.sequences.find((item) => item.id === sequenceId);
    const duration = sequence ? sequence.outFrame - sequence.inFrame : overlay.endFrame;
    const startFrame = Math.min(duration, Math.max(0, Math.round(patch.startFrame ?? overlay.startFrame)));
    const endFrame = Math.min(duration, Math.max(startFrame + 1, Math.round(patch.endFrame ?? overlay.endFrame)));
    return {
        ...project,
        overlays: project.overlays.map((item) => item.id === overlay.id ? { ...item, ...patch, startFrame, endFrame } : item),
        modifiedAt: new Date().toISOString(),
    };
}

export function updateBlockDetails(project: GolfProject, blockId: string, patch: Partial<ShotDetails>): GolfProject {
    return {
        ...project,
        blocks: project.blocks.map((block) => block.id === blockId ? { ...block, details: { ...block.details, ...patch } } : block),
        modifiedAt: new Date().toISOString(),
    };
}

export function updateHoleData(project: GolfProject, holeNumber: number, patch: Partial<HoleData>): GolfProject {
    return {
        ...project,
        courseData: {
            ...project.courseData,
            holes: project.courseData.holes.map((hole) => hole.number === holeNumber ? { ...hole, ...patch, number: holeNumber } : hole),
        },
        modifiedAt: new Date().toISOString(),
    };
}

export function setScorecardSource(project: GolfProject, scorecardSourcePath: string | null): GolfProject {
    return { ...project, courseData: { ...project.courseData, scorecardSourcePath }, modifiedAt: new Date().toISOString() };
}

export function updatePlayerScore(project: GolfProject, hole: number, playerId: string, strokes: number | null): GolfProject {
    const exists = project.playerScores.some((score) => score.hole === hole && score.playerId === playerId);
    const score: PlayerHoleScore = { hole, playerId, strokes };
    return {
        ...project,
        playerScores: exists
            ? project.playerScores.map((item) => item.hole === hole && item.playerId === playerId ? score : item)
            : [...project.playerScores, score],
        modifiedAt: new Date().toISOString(),
    };
}

export function playerScoreToPar(project: GolfProject, playerId: string, throughHole: number): number | null {
    const scores = project.playerScores.filter((score) => score.playerId === playerId && score.hole <= throughHole && score.strokes !== null);
    if (!scores.length) return null;
    return scores.reduce((total, score) => {
        const par = project.courseData.holes.find((hole) => hole.number === score.hole)?.par ?? 4;
        return total + score.strokes! - par;
    }, 0);
}

export function effectivePlayerOrder(project: GolfProject, hole: number, blockOrder: number): string[] {
    const validIds = project.settings.players.map((player) => player.id);
    const stored = project.playerOrders.find((order) => order.hole === hole && order.blockOrder === blockOrder)?.playerIds;
    if (stored) return [...stored.filter((id) => validIds.includes(id)), ...validIds.filter((id) => !stored.includes(id))];
    return automaticPlayerOrder(project, hole, blockOrder);
}

function sourceStartMilliseconds(project: GolfProject, sequence: GolfProject['sequences'][number]): number {
    if (sequence.sourceType === 'media') {
        const media = project.media.find((item) => item.id === sequence.sourceId);
        return media?.recordedAt ? Date.parse(media.recordedAt) : Number.NaN;
    }
    const group = project.groups.find((item) => item.id === sequence.sourceId);
    const starts = (group?.mediaIds ?? [])
        .map((id) => project.media.find((item) => item.id === id)?.recordedAt)
        .filter(Boolean)
        .map((value) => Date.parse(value!))
        .filter(Number.isFinite);
    return starts.length ? Math.min(...starts) : Number.NaN;
}

export function automaticPlayerOrder(project: GolfProject, hole: number, blockOrder: number): string[] {
    const entries = project.settings.players.map((player, fallbackIndex) => {
        const block = project.blocks
            .filter((item) => item.hole === hole && item.playerId === player.id)
            .sort((left, right) => left.order - right.order)[blockOrder];
        const sequence = block?.sequenceIds.length
            ? project.sequences.find((item) => item.id === block.sequenceIds[0])
            : undefined;
        return { playerId: player.id, sequence, fallbackIndex };
    });
    return entries.sort((left, right) => {
        if (!left.sequence && !right.sequence) return left.fallbackIndex - right.fallbackIndex;
        if (!left.sequence) return 1;
        if (!right.sequence) return -1;
        const sameSource = left.sequence.sourceType === right.sequence.sourceType && left.sequence.sourceId === right.sequence.sourceId;
        const leftTime = sameSource
            ? left.sequence.inFrame / left.sequence.sourceFps
            : sourceStartMilliseconds(project, left.sequence) + left.sequence.inFrame / left.sequence.sourceFps * 1000;
        const rightTime = sameSource
            ? right.sequence.inFrame / right.sequence.sourceFps
            : sourceStartMilliseconds(project, right.sequence) + right.sequence.inFrame / right.sequence.sourceFps * 1000;
        if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return left.fallbackIndex - right.fallbackIndex;
        if (!Number.isFinite(leftTime)) return 1;
        if (!Number.isFinite(rightTime)) return -1;
        return leftTime - rightTime || left.fallbackIndex - right.fallbackIndex;
    }).map((entry) => entry.playerId);
}

export function hasPlayerOrderOverride(project: GolfProject, hole: number, blockOrder: number): boolean {
    return project.playerOrders.some((order) => order.hole === hole && order.blockOrder === blockOrder);
}

export function clearPlayerOrderOverride(project: GolfProject, hole: number, blockOrder: number): GolfProject {
    return {
        ...project,
        playerOrders: project.playerOrders.filter((order) => order.hole !== hole || order.blockOrder !== blockOrder),
        modifiedAt: new Date().toISOString(),
    };
}

export function movePlayerInOrder(project: GolfProject, hole: number, blockOrder: number, playerId: string, direction: -1 | 1): GolfProject {
    const playerIds = effectivePlayerOrder(project, hole, blockOrder);
    const index = playerIds.indexOf(playerId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= playerIds.length) return project;
    [playerIds[index], playerIds[target]] = [playerIds[target], playerIds[index]];
    const exists = project.playerOrders.some((order) => order.hole === hole && order.blockOrder === blockOrder);
    const playerOrders = exists
        ? project.playerOrders.map((order) => order.hole === hole && order.blockOrder === blockOrder ? { ...order, playerIds } : order)
        : [...project.playerOrders, { hole, blockOrder, playerIds }];
    return { ...project, schemaVersion: 8, playerOrders, modifiedAt: new Date().toISOString() };
}

const start = (media: MediaItem) => Date.parse(media.recordedAt);
const end = (media: MediaItem) => start(media) + media.durationSeconds * 1000;

export function multicamSyncOffset(project: GolfProject, groupId: string, mediaId: string): number {
    const value = project.groups.find((group) => group.id === groupId)?.syncOffsetsSeconds?.[mediaId] ?? 0;
    return Number.isFinite(value) ? value : 0;
}

export function multicamMediaStartMs(project: GolfProject, groupId: string, media: MediaItem): number {
    return start(media) - multicamSyncOffset(project, groupId, media.id) * 1000;
}

export function multicamTimeline(project: GolfProject, groupId: string): { startMs: number; endMs: number; fps: number; media: MediaItem[] } | null {
    const group = project.groups.find((item) => item.id === groupId);
    const media = (group?.mediaIds ?? [])
        .map((mediaId) => project.media.find((item) => item.id === mediaId))
        .filter((item): item is MediaItem => Boolean(item && item.kind === 'video' && Number.isFinite(start(item)) && item.durationSeconds > 0));
    if (!media.length) return null;
    return {
        startMs: Math.min(...media.map(start)),
        endMs: Math.max(...media.map((item) => multicamMediaStartMs(project, groupId, item) + item.durationSeconds * 1000)),
        fps: Math.max(1, ...media.map((item) => item.fps && item.fps > 0 ? item.fps : project.settings.frameRate ?? 30)),
        media,
    };
}

export function multicamAnglesForRange(project: GolfProject, groupId: string, inFrame: number, outFrame: number, sourceFps: number): MulticamAngle[] {
    const timeline = multicamTimeline(project, groupId);
    if (!timeline || outFrame <= inFrame || sourceFps <= 0) return [];
    const selectionStartMs = timeline.startMs + inFrame / sourceFps * 1000;
    const selectionEndMs = timeline.startMs + outFrame / sourceFps * 1000;
    return timeline.media.flatMap((media) => {
        const mediaStartMs = multicamMediaStartMs(project, groupId, media);
        const overlapStartMs = Math.max(selectionStartMs, mediaStartMs);
        const overlapEndMs = Math.min(selectionEndMs, mediaStartMs + media.durationSeconds * 1000);
        if (overlapEndMs <= overlapStartMs) return [];
        const fps = media.fps && media.fps > 0 ? media.fps : sourceFps;
        return [{
            mediaId: media.id,
            inFrame: Math.max(0, Math.round((overlapStartMs - mediaStartMs) / 1000 * fps)),
            outFrame: Math.max(1, Math.round((overlapEndMs - mediaStartMs) / 1000 * fps)),
            sourceFps: fps,
        }];
    });
}

export function setMulticamSyncOffsets(project: GolfProject, groupId: string, offsets: Record<string, number>, syncStatus: 'manual' | 'audio'): GolfProject {
    const group = project.groups.find((item) => item.id === groupId);
    if (!group) return project;
    const validOffsets = Object.fromEntries(Object.entries(offsets)
        .filter(([mediaId, seconds]) => group.mediaIds.includes(mediaId) && Number.isFinite(seconds))
        .map(([mediaId, seconds]) => [mediaId, Math.min(3600, Math.max(-3600, Math.round(seconds * 1000) / 1000))]));
    if (!Object.keys(validOffsets).length) return project;
    const now = new Date().toISOString();
    const groups = project.groups.map((item) => item.id === groupId ? {
        ...item,
        syncStatus,
        syncOffsetsSeconds: { ...(item.syncOffsetsSeconds ?? {}), ...validOffsets },
    } : item);
    const next = { ...project, schemaVersion: 8, groups, modifiedAt: now };
    return {
        ...next,
        sequences: next.sequences.map((sequence) => sequence.sourceType === 'group' && sequence.sourceId === groupId ? {
            ...sequence,
            multicamAngles: multicamAnglesForRange(next, groupId, sequence.inFrame, sequence.outFrame, sequence.sourceFps),
            updatedAt: now,
        } : sequence),
    };
}

export function setMulticamSyncOffset(project: GolfProject, groupId: string, mediaId: string, seconds: number): GolfProject {
    return setMulticamSyncOffsets(project, groupId, { [mediaId]: seconds }, 'manual');
}

function filenameCameraFamily(name: string): string {
    const stem = name.replace(/\.[^.]+$/, '').toLowerCase();
    const djiTimestamp = stem.match(/^dji[_-]\d{14,}[_-]\d+(?:[_-]([a-z]))?/);
    if (djiTimestamp) return `dji-timestamp-${djiTimestamp[1] ?? 'main'}`;
    if (/^dji[_-]\d{4}(?:[_-]\d+)?$/.test(stem)) return 'dji-classic';
    const withoutTrailingSegment = stem.replace(/[_-]\d{1,4}$/, '');
    return withoutTrailingSegment.replace(/[^a-z0-9]+/g, '-') || 'media';
}

function multicamSourceKey(media: MediaItem): string {
    return `${media.deviceKey}:${filenameCameraFamily(media.name)}`;
}

export function overlapMilliseconds(left: MediaItem, right: MediaItem): number {
    const overlap = Math.min(end(left), end(right)) - Math.max(start(left), start(right));
    return Number.isFinite(overlap) ? Math.max(0, overlap) : 0;
}

export function suggestMulticam(media: MediaItem[]): MulticamSuggestion[] {
    const sorted = media
        .filter((item) => item.recordedAt && item.durationSeconds > 0)
        .sort((left, right) => start(left) - start(right));
    const clusters: MediaItem[][] = [];
    for (const item of sorted) {
        const cluster = clusters.find((candidate) => candidate.some((other) => {
            const overlap = overlapMilliseconds(item, other);
            const shorter = Math.min(item.durationSeconds, other.durationSeconds) * 1000;
            return overlap >= 1000 && overlap / shorter >= 0.15;
        }));
        cluster ? cluster.push(item) : clusters.push([item]);
    }
    return clusters
        .filter((cluster) => cluster.length > 1 && new Set(cluster.map(multicamSourceKey)).size > 1)
        .map((cluster, index) => {
            const starts = cluster.map(start);
            const ends = cluster.map(end);
            const overlapRatios = cluster.flatMap((item, itemIndex) => cluster.slice(itemIndex + 1)
                .filter((other) => multicamSourceKey(item) !== multicamSourceKey(other))
                .map((other) => {
                    const shorter = Math.min(item.durationSeconds, other.durationSeconds) * 1000;
                    return shorter > 0 ? overlapMilliseconds(item, other) / shorter : 0;
                }));
            const overlapRatio = Math.max(0, ...overlapRatios);
            const audioSources = cluster.filter((item) => item.hasAudio || item.kind === 'audio').length;
            const confidence = overlapRatio >= 0.65 && audioSources >= 2 ? 'high' : overlapRatio >= 0.25 ? 'medium' : 'low';
            return {
                id: `suggestion-${index}-${Math.round(Math.min(...starts))}`,
                mediaIds: cluster.map((item) => item.id),
                startAt: new Date(Math.min(...starts)).toISOString(),
                endAt: new Date(Math.max(...ends)).toISOString(),
                confidence,
                reason: confidence === 'high'
                    ? 'Aufnahmezeiten überlappen deutlich; mehrere Tonquellen sind vorhanden.'
                    : 'Aufnahmezeiten verschiedener Geräte überschneiden sich.',
            };
        });
}
