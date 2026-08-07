import { describe, expect, it } from 'vitest';
import { addBlock, applyScorecardTee, automaticPlayerOrder, clearPlayerOrderOverride, createProject, deleteBlock, duplicateBlock, effectivePlayerOrder, hasPlayerOrderOverride, moveBlock, movePlayerInOrder, moveSequence, multicamAnglesForRange, multicamTimeline, normalizeProject, playerScoreToPar, proposeShotTracer, roughCutSequenceIds, sequenceDurationUs, setMulticamSyncOffset, setMulticamSyncOffsets, setScorecardSource, setSequenceActiveMedia, setSequenceCameraCutBoundary, setSequenceCameraForMoment, setSequenceCameraFrom, suggestMulticam, toggleSequenceOverlay, toggleShotTracer, updateBlockDetails, updateHoleData, updatePlayerScore, updateSequenceOverlay, updateShotTracer, upsertSequence, videoCutPlanIsValid } from './model';
import type { MediaItem, ProjectSettings } from './types';

const settings: ProjectSettings = {
    id: 'round',
    course: 'Eichenried',
    holes: 9,
    players: [{ id: 'joe', name: 'Joe' }],
    name: 'Eichenried · 9 Loch',
    createdAt: '2026-08-03T10:00:00.000Z',
};

describe('project model', () => {
    it('upgrades old projects without losing media', () => {
        const old = { schemaVersion: 1, settings, media: [{ id: 'media-1' }], suggestions: [], groups: [] };
        const project = normalizeProject(old);
        expect(project.schemaVersion).toBe(9);
        expect(project.media).toHaveLength(1);
        expect(project.blocks).toHaveLength(36);
        expect(project.sequences).toEqual([]);
        expect(project.overlays).toEqual([]);
        expect(project.playerOrders).toEqual([]);
        expect(project.courseData.holes).toHaveLength(9);
        expect(project.courseData.holes[0].par).toBe(4);
    });

    it('stores and moves a non-destructive sequence between blocks', () => {
        const project = createProject(settings);
        const created = upsertSequence(project, {
            sourceType: 'media', sourceId: 'media-1', inFrame: 60, outFrame: 180,
            sourceFps: 60, hole: 1, playerId: 'joe', blockType: 'tee-shot',
        });
        expect(created.sequences[0]).toMatchObject({ inFrame: 60, outFrame: 180 });
        const moved = upsertSequence(created, {
            id: created.sequences[0].id,
            sourceType: 'media', sourceId: 'media-1', inFrame: 61, outFrame: 181,
            sourceFps: 60, hole: 2, playerId: 'joe', blockType: 'approach',
        });
        expect(moved.sequences).toHaveLength(1);
        expect(moved.blocks.find((block) => block.id === moved.sequences[0].targetBlockId)?.hole).toBe(2);
    });

    it('adds, duplicates, reorders and removes flexible golf blocks', () => {
        const project = createProject(settings);
        const added = addBlock(project, 1, 'joe', 'approach');
        const newBlock = added.blocks.find((block) => block.label === 'Approach 2')!;
        const duplicated = duplicateBlock(added, newBlock.id);
        expect(duplicated.blocks.some((block) => block.label === 'Approach 3')).toBe(true);
        const moved = moveBlock(duplicated, newBlock.id, -1);
        expect(moved.blocks.find((block) => block.id === newBlock.id)!.order).toBeLessThan(newBlock.order);
        expect(deleteBlock(moved, newBlock.id).blocks.some((block) => block.id === newBlock.id)).toBe(false);
    });

    it('keeps sequence order inside a block', () => {
        let project = createProject(settings);
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'one', inFrame: 0, outFrame: 10, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'two', inFrame: 10, outFrame: 20, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        const block = project.blocks.find((item) => item.type === 'tee-shot' && item.hole === 1)!;
        const reordered = moveSequence(project, block.id, block.sequenceIds[1], -1);
        expect(reordered.blocks.find((item) => item.id === block.id)!.sequenceIds[0]).toBe(block.sequenceIds[1]);
    });

    it('builds an interleaved golf order and persists overlay tracks', () => {
        const twoPlayers = { ...settings, players: [...settings.players, { id: 'ferdi', name: 'Ferdi' }] };
        let project = createProject(twoPlayers);
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'joe-tee', inFrame: 0, outFrame: 30, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'ferdi-tee', inFrame: 0, outFrame: 30, sourceFps: 30, hole: 1, playerId: 'ferdi', blockType: 'tee-shot' });
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'joe-approach', inFrame: 0, outFrame: 30, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'approach' });
        expect(roughCutSequenceIds(project, 1).map((id) => project.sequences.find((sequence) => sequence.id === id)!.sourceId)).toEqual(['joe-tee', 'ferdi-tee', 'joe-approach']);
        const sequenceId = project.sequences[0].id;
        project = toggleSequenceOverlay(project, sequenceId, 'player-card');
        expect(project.overlays[0]).toMatchObject({ sequenceId, type: 'player-card', enabled: true, startFrame: 0, endFrame: 30 });
        project = movePlayerInOrder(project, 1, 0, 'ferdi', -1);
        expect(effectivePlayerOrder(project, 1, 0)).toEqual(['ferdi', 'joe']);
        expect(roughCutSequenceIds(project, 1).map((id) => project.sequences.find((sequence) => sequence.id === id)!.sourceId)).toEqual(['ferdi-tee', 'joe-tee', 'joe-approach']);
        expect(hasPlayerOrderOverride(project, 1, 0)).toBe(true);
        expect(effectivePlayerOrder(clearPlayerOrderOverride(project, 1, 0), 1, 0)).toEqual(['joe', 'ferdi']);
    });

    it('derives player order from In frames in one clip and timestamps across clips', () => {
        const twoPlayers = { ...settings, players: [...settings.players, { id: 'ferdi', name: 'Ferdi' }] };
        let project = createProject(twoPlayers);
        const mediaBase = { name: 'clip.mp4', kind: 'video' as const, device: 'Camera', deviceKey: 'camera', durationSeconds: 30, width: 1920, height: 1080, fps: 30, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1000 };
        project = { ...project, media: [
            { ...mediaBase, id: 'shared', path: 'shared.mp4', recordedAt: '2026-08-03T10:00:00.000Z' },
            { ...mediaBase, id: 'early', path: 'early.mp4', recordedAt: '2026-08-03T09:59:00.000Z' },
        ] };
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'shared', inFrame: 300, outFrame: 360, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'shared', inFrame: 30, outFrame: 90, sourceFps: 30, hole: 1, playerId: 'ferdi', blockType: 'tee-shot' });
        expect(automaticPlayerOrder(project, 1, 0)).toEqual(['ferdi', 'joe']);
        const joeSequence = project.sequences.find((sequence) => sequence.sourceId === 'shared' && sequence.inFrame === 300)!;
        project = upsertSequence(project, { id: joeSequence.id, sourceType: 'media', sourceId: 'early', inFrame: 0, outFrame: 60, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        expect(automaticPlayerOrder(project, 1, 0)).toEqual(['joe', 'ferdi']);
    });

    it('suggests multicam groups for parallel DJI filename families from the same reported device', () => {
        const base = {
            kind: 'video' as const,
            path: 'C:\\Clips\\round',
            device: 'DJI Osmo Pocket',
            deviceKey: 'dji-osmo-pocket:round',
            width: 3840,
            height: 2160,
            fps: 59.94,
            codec: 'h264',
            audioCodec: 'aac',
            hasAudio: true,
            sizeBytes: 1000,
        };
        const media: MediaItem[] = [
            { ...base, id: 'classic-853', name: 'DJI_0853.MP4', recordedAt: '2026-08-05T09:03:21.000Z', durationSeconds: 180 },
            { ...base, id: 'timestamp-47', name: 'DJI_20260805110321_0047_D.MP4', recordedAt: '2026-08-05T09:03:21.000Z', durationSeconds: 182 },
            { ...base, id: 'timestamp-48', name: 'DJI_20260805110816_0048_D.MP4', recordedAt: '2026-08-05T09:08:17.000Z', durationSeconds: 591 },
            { ...base, id: 'classic-854-1', name: 'DJI_0854_001.MP4', recordedAt: '2026-08-05T09:08:19.000Z', durationSeconds: 327 },
            { ...base, id: 'classic-854-2', name: 'DJI_0854_002.MP4', recordedAt: '2026-08-05T09:13:47.000Z', durationSeconds: 247 },
        ];

        const suggestions = suggestMulticam(media);

        expect(suggestions).toHaveLength(2);
        expect(suggestions[0].mediaIds).toEqual(['classic-853', 'timestamp-47']);
        expect(suggestions[1].mediaIds).toEqual(['timestamp-48', 'classic-854-1', 'classic-854-2']);
        expect(suggestions.every((suggestion) => suggestion.confidence === 'high')).toBe(true);
    });

    it('transfers every overlapping camera angle on the shared multicam timeline', () => {
        const project = createProject(settings);
        const mediaBase = { name: 'clip.mp4', kind: 'video' as const, device: 'Camera', deviceKey: 'camera', width: 1920, height: 1080, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1000 };
        const withGroup = { ...project, media: [
            { ...mediaBase, id: 'wide', path: 'wide.mp4', recordedAt: '2026-08-05T10:00:00.000Z', durationSeconds: 20, fps: 30 },
            { ...mediaBase, id: 'close', path: 'close.mp4', recordedAt: '2026-08-05T10:00:02.000Z', durationSeconds: 20, fps: 60 },
            { ...mediaBase, id: 'late', path: 'late.mp4', recordedAt: '2026-08-05T10:00:30.000Z', durationSeconds: 5, fps: 30 },
        ], groups: [{ id: 'group', name: 'Multicam 1', mediaIds: ['wide', 'close', 'late'], createdAt: '', syncStatus: 'timestamp-only' as const }] };

        expect(multicamTimeline(withGroup, 'group')).toMatchObject({
            startMs: Date.parse('2026-08-05T10:00:00.000Z'),
            endMs: Date.parse('2026-08-05T10:00:35.000Z'),
            fps: 60,
        });
        expect(multicamAnglesForRange(withGroup, 'group', 60, 600, 60)).toEqual([
            { mediaId: 'wide', inFrame: 30, outFrame: 300, sourceFps: 30 },
            { mediaId: 'close', inFrame: 0, outFrame: 480, sourceFps: 60 },
        ]);
    });

    it('switches the active multicam angle only when it belongs to the saved sequence', () => {
        const project = createProject(settings);
        const video = { name: 'clip.mp4', kind: 'video' as const, device: 'Camera', deviceKey: 'camera', recordedAt: '2026-08-05T10:00:00.000Z', durationSeconds: 20, width: 1920, height: 1080, fps: 30, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1000 };
        const withSequence = { ...project, media: [
            { ...video, id: 'wide', path: 'wide.mp4' },
            { ...video, id: 'close', path: 'close.mp4' },
            { ...video, id: 'unused', path: 'unused.mp4' },
        ], groups: [{ id: 'group', name: 'Multicam', mediaIds: ['wide', 'close', 'unused'], createdAt: '', syncStatus: 'audio' as const }], sequences: [{
            id: 'sequence', sourceType: 'group' as const, sourceId: 'group', inFrame: 60, outFrame: 300, sourceFps: 30,
            activeMediaId: 'wide', multicamAngles: [
                { mediaId: 'wide', inFrame: 60, outFrame: 300, sourceFps: 30 },
                { mediaId: 'close', inFrame: 90, outFrame: 330, sourceFps: 30 },
            ], targetBlockId: project.blocks[0].id, createdAt: '', updatedAt: '',
        }] };

        expect(setSequenceActiveMedia(withSequence, 'sequence', 'close').sequences[0].activeMediaId).toBe('close');
        expect(setSequenceActiveMedia(withSequence, 'sequence', 'unused')).toBe(withSequence);
    });

    it('persists manual camera sync and reapplies it to existing multicam sequences', () => {
        const project = createProject(settings);
        const mediaBase = { name: 'clip.mp4', kind: 'video' as const, device: 'Camera', deviceKey: 'camera', recordedAt: '2026-08-05T10:00:00.000Z', durationSeconds: 20, width: 1920, height: 1080, fps: 30, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1000 };
        const groupProject = { ...project, media: [
            { ...mediaBase, id: 'reference', path: 'reference.mp4' },
            { ...mediaBase, id: 'late-content', path: 'late.mp4' },
        ], groups: [{ id: 'group', name: 'Multicam', mediaIds: ['reference', 'late-content'], createdAt: '', syncStatus: 'timestamp-only' as const }], sequences: [{
            id: 'sequence', sourceType: 'group' as const, sourceId: 'group', inFrame: 60, outFrame: 300, sourceFps: 30,
            activeMediaId: 'reference', targetBlockId: project.blocks[0].id, createdAt: '', updatedAt: '',
        }] };

        const synced = setMulticamSyncOffset(groupProject, 'group', 'late-content', 1.5);

        expect(synced.schemaVersion).toBe(9);
        expect(synced.groups[0]).toMatchObject({ syncStatus: 'manual', syncOffsetsSeconds: { 'late-content': 1.5 } });
        expect(synced.sequences[0].multicamAngles).toEqual([
            { mediaId: 'reference', inFrame: 60, outFrame: 300, sourceFps: 30 },
            { mediaId: 'late-content', inFrame: 105, outFrame: 345, sourceFps: 30 },
        ]);
        const automatic = setMulticamSyncOffsets(groupProject, 'group', { reference: 0, 'late-content': 1.5 }, 'audio');
        expect(automatic.groups[0]).toMatchObject({ syncStatus: 'audio', syncOffsetsSeconds: { reference: 0, 'late-content': 1.5 } });
    });

    it('stores course, scorecard, score and shot metadata', () => {
        let project = createProject(settings);
        const block = project.blocks.find((item) => item.hole === 1 && item.playerId === 'joe')!;
        project = setScorecardSource(project, 'C:\\scorecards\\eichenried.pdf');
        project = updateHoleData(project, 1, { par: 5, lengthMeters: 487, strokeIndex: 3, teeColor: 'Gelb' });
        project = updatePlayerScore(project, 1, 'joe', 6);
        project = updateBlockDetails(project, block.id, { club: 'Driver', distanceMeters: 238, result: 'Fairway' });
        expect(project.courseData.scorecardSourcePath).toContain('eichenried.pdf');
        expect(project.courseData.holes[0]).toMatchObject({ par: 5, lengthMeters: 487, strokeIndex: 3, teeColor: 'Gelb' });
        expect(project.blocks.find((item) => item.id === block.id)?.details).toMatchObject({ club: 'Driver', distanceMeters: 238, result: 'Fairway' });
        expect(playerScoreToPar(project, 'joe', 1)).toBe(1);
    });

    it('applies a complete reviewed scorecard tee without changing player scores', () => {
        const project = updatePlayerScore(createProject(settings), 1, 'joe', 5);
        const tee = {
            id: 'tee-gelb',
            label: 'Gelb',
            holes: project.courseData.holes.map((hole) => ({
                number: hole.number,
                sourceLabel: `A${hole.number}`,
                par: hole.number === 1 ? 5 : 4,
                lengthMeters: 300 + hole.number,
                strokeIndex: hole.number,
            })),
        };
        const updated = applyScorecardTee(project, 'C:\\scorecards\\eichenried.pdf', tee);
        expect(updated.courseData.scorecardSourcePath).toContain('eichenried.pdf');
        expect(updated.courseData.holes[0]).toMatchObject({ par: 5, lengthMeters: 301, strokeIndex: 1, teeColor: 'Gelb' });
        expect(updated.playerScores).toEqual(project.playerScores);

        const incomplete = applyScorecardTee(project, 'C:\\scorecards\\broken.pdf', { ...tee, holes: tee.holes.slice(0, -1) });
        expect(incomplete).toBe(project);
    });

    it('clamps overlay timing and upgrades missing overlay positions', () => {
        let project = createProject(settings);
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'clip', inFrame: 10, outFrame: 70, sourceFps: 30, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        const sequenceId = project.sequences[0].id;
        project = toggleSequenceOverlay(project, sequenceId, 'score-card');
        project = updateSequenceOverlay(project, sequenceId, 'score-card', { startFrame: -20, endFrame: 999, position: 'bottom-right' });
        expect(project.overlays[0]).toMatchObject({ startFrame: 0, endFrame: 60, position: 'bottom-right' });
        const migrated = normalizeProject({ ...project, schemaVersion: 4, overlays: [{ ...project.overlays[0], position: undefined }] });
        expect(migrated.overlays[0].position).toBe('top-left');
    });

    it('creates, proposes and styles a frame-based shot tracer', () => {
        let project = createProject(settings);
        project = upsertSequence(project, { sourceType: 'media', sourceId: 'clip', inFrame: 20, outFrame: 140, sourceFps: 60, hole: 1, playerId: 'joe', blockType: 'tee-shot' });
        const sequenceId = project.sequences[0].id;
        project = toggleShotTracer(project, sequenceId);
        expect(project.shotTracers[0]).toMatchObject({ enabled: true, color: '#c8ff42', thickness: 5, glow: 12 });
        project = updateShotTracer(project, sequenceId, { impactFrame: 12, endFrame: 90, disappearFrame: 110, thickness: 99, glow: -5, tailLength: .9, occlusionStartFrame: 35, occlusionEndFrame: 80 });
        project = proposeShotTracer(project, sequenceId, .2, .8, 1);
        const tracer = project.shotTracers[0];
        expect(tracer.impactFrame).toBe(12);
        expect(tracer.points).toHaveLength(3);
        expect(tracer.points[0]).toMatchObject({ x: .2, y: .8, frame: 12, kind: 'impact' });
        expect(tracer.points[1].kind).toBe('curve');
        expect(tracer.points[2].kind).toBe('landing');
        expect(tracer.points[2].x).toBeGreaterThan(.2);
        expect(tracer.thickness).toBe(16);
        expect(tracer.glow).toBe(0);
        expect(tracer.tailLength).toBe(.5);
        expect(tracer).toMatchObject({ occlusionStartFrame: 35, occlusionEndFrame: 80 });
        expect(tracer.disappearFrame).toBe(120);
    });

    it('upgrades legacy tracer tracks with render defaults', () => {
        const project = createProject(settings);
        const migrated = normalizeProject({ ...project, schemaVersion: 5, shotTracers: [{ id: 'legacy', sequenceId: 'sequence', enabled: true, impactFrame: 0, endFrame: 30, disappearFrame: 40, points: [{ frame: 0, x: 2, y: -.5 }] }] });
        expect(migrated.schemaVersion).toBe(9);
        expect(migrated.shotTracers[0]).toMatchObject({ color: '#c8ff42', thickness: 5, glow: 12, smoothing: .72, tailLength: .16, occlusionStartFrame: null, occlusionEndFrame: null, cameraLock: null });
        expect(migrated.shotTracers[0].points[0]).toMatchObject({ x: 1, y: 0 });
    });

    it('creates a complete default render plan for every new sequence', () => {
        const project = upsertSequence(createProject(settings), {
            sourceType: 'media', sourceId: 'camera-a', inFrame: 60, outFrame: 180,
            sourceFps: 60, hole: 1, playerId: 'joe', blockType: 'tee-shot',
        });
        const sequence = project.sequences[0];
        expect(project.schemaVersion).toBe(9);
        expect(sequenceDurationUs(sequence)).toBe(2_000_000);
        expect(sequence.videoCuts).toEqual([{
            id: `${sequence.id}-cut-1`, mediaId: 'camera-a', startUs: 0, endUs: 2_000_000, origin: 'automatic',
        }]);
        expect(sequence.audioPlan).toEqual({ mediaId: 'camera-a', mode: 'master', offsetUs: 0, gainDb: 0, muted: false });
        expect(sequence.review).toEqual({ status: 'unreviewed', reviewedFingerprint: null });
        expect(videoCutPlanIsValid(sequence.videoCuts!, sequenceDurationUs(sequence))).toBe(true);
    });

    it('migrates a v8 multicam moment and tracer to the explicitly active camera', () => {
        const base = createProject(settings);
        const legacySequence = {
            id: 'moment-1', sourceType: 'group' as const, sourceId: 'group-1', inFrame: 30, outFrame: 270, sourceFps: 30,
            activeMediaId: 'camera-close', targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '',
        };
        const migrated = normalizeProject({
            ...base,
            schemaVersion: 8,
            sequences: [legacySequence],
            shotTracers: [{ id: 'tracer-1', sequenceId: 'moment-1', enabled: true, impactFrame: 0, endFrame: 30, disappearFrame: 40, points: [] }],
        });
        const cut = migrated.sequences[0].videoCuts![0];
        expect(cut).toEqual({ id: 'moment-1-cut-1', mediaId: 'camera-close', startUs: 0, endUs: 8_000_000, origin: 'migrated' });
        expect(migrated.sequences[0].audioPlan).toMatchObject({ mediaId: 'camera-close', mode: 'master' });
        expect(migrated.shotTracers[0].binding).toEqual({ cutId: cut.id, mediaId: 'camera-close' });
    });

    it('keeps a v8 multicam moment without an active camera explicitly unresolved', () => {
        const base = createProject(settings);
        const migrated = normalizeProject({
            ...base,
            schemaVersion: 8,
            sequences: [{
                id: 'unresolved', sourceType: 'group', sourceId: 'group-1', inFrame: 0, outFrame: 60, sourceFps: 30,
                targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '',
            }],
            shotTracers: [{ id: 'tracer', sequenceId: 'unresolved', enabled: true, impactFrame: 0, endFrame: 30, disappearFrame: 40, points: [] }],
        });
        expect(migrated.sequences[0].videoCuts![0]).toMatchObject({ mediaId: null, origin: 'migrated' });
        expect(migrated.sequences[0].audioPlan).toMatchObject({ mediaId: null, mode: 'master' });
        expect(migrated.shotTracers[0].binding).toEqual({ cutId: 'unresolved-cut-1', mediaId: undefined });
    });

    it('preserves valid v9 cuts and leaves a gapped plan diagnosably invalid', () => {
        const base = createProject(settings);
        const sequence = upsertSequence(base, {
            sourceType: 'media', sourceId: 'wide', inFrame: 0, outFrame: 90, sourceFps: 30,
            hole: 1, playerId: 'joe', blockType: 'tee-shot',
        }).sequences[0];
        const validCuts = [
            { id: 'cut-a', mediaId: 'wide', startUs: 0, endUs: 1_000_000, origin: 'manual' as const },
            { id: 'cut-b', mediaId: 'close', startUs: 1_000_000, endUs: 3_000_000, origin: 'manual' as const },
        ];
        const preserved = normalizeProject({ ...base, schemaVersion: 9, sequences: [{ ...sequence, videoCuts: validCuts }] });
        expect(preserved.sequences[0].videoCuts).toEqual(validCuts);
        const repaired = normalizeProject({
            ...base,
            schemaVersion: 9,
            sequences: [{ ...sequence, videoCuts: [{ ...validCuts[0], endUs: 900_000 }, validCuts[1]] }],
        });
        expect(repaired.sequences[0].videoCuts).toEqual([
            { ...validCuts[0], endUs: 900_000 },
            validCuts[1],
        ]);
        expect(videoCutPlanIsValid(repaired.sequences[0].videoCuts!, sequenceDurationUs(repaired.sequences[0]))).toBe(false);
        const empty = normalizeProject({ ...base, schemaVersion: 9, sequences: [{ ...sequence, videoCuts: [] }] });
        expect(empty.sequences[0].videoCuts).toEqual([]);
    });

    it('invalidates review when source timing moves without changing duration', () => {
        const initial = upsertSequence(createProject(settings), {
            sourceType: 'media', sourceId: 'wide', inFrame: 0, outFrame: 90, sourceFps: 30,
            hole: 1, playerId: 'joe', blockType: 'tee-shot',
        });
        const approved = {
            ...initial,
            sequences: initial.sequences.map((sequence) => ({
                ...sequence,
                review: { status: 'approved' as const, reviewedFingerprint: 'rp1-approved' },
            })),
        };
        const moved = upsertSequence(approved, {
            id: approved.sequences[0].id,
            sourceType: 'media', sourceId: 'wide', inFrame: 30, outFrame: 120, sourceFps: 30,
            hole: 1, playerId: 'joe', blockType: 'tee-shot', targetBlockId: approved.sequences[0].targetBlockId,
        });
        expect(moved.sequences[0].videoCuts).toEqual(approved.sequences[0].videoCuts);
        expect(moved.sequences[0].review).toEqual({ status: 'unreviewed', reviewedFingerprint: null });
    });

    it('records an A to B to A camera plan without changing master audio', () => {
        const base = createProject(settings);
        const sequence = {
            id: 'moment', sourceType: 'group' as const, sourceId: 'group', inFrame: 0, outFrame: 300, sourceFps: 30,
            activeMediaId: 'a', multicamAngles: [{ mediaId: 'a', inFrame: 0, outFrame: 300, sourceFps: 30 }, { mediaId: 'b', inFrame: 0, outFrame: 300, sourceFps: 30 }],
            videoCuts: [{ id: 'initial', mediaId: 'a', startUs: 0, endUs: 10_000_000, origin: 'automatic' as const }],
            audioPlan: { mediaId: 'a', mode: 'master' as const, offsetUs: 0, gainDb: 0, muted: false }, review: { status: 'approved' as const, reviewedFingerprint: 'old' },
            targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '',
        };
        const project = { ...base, groups: [{ id: 'group', name: 'Multicam', mediaIds: ['a', 'b'], createdAt: '', syncStatus: 'audio' as const }], sequences: [sequence] };
        const withB = setSequenceCameraFrom(project, 'moment', 'b', 2_000_000);
        const final = setSequenceCameraFrom(withB, 'moment', 'a', 8_000_000);
        expect(final.sequences[0].videoCuts?.map((cut) => [cut.mediaId, cut.startUs, cut.endUs])).toEqual([
            ['a', 0, 2_000_000], ['b', 2_000_000, 8_000_000], ['a', 8_000_000, 10_000_000],
        ]);
        expect(final.sequences[0].audioPlan).toEqual(sequence.audioPlan);
        expect(final.sequences[0].review).toEqual({ status: 'unreviewed', reviewedFingerprint: null });
        expect(setSequenceCameraForMoment(final, 'moment', 'b').sequences[0].videoCuts?.map((cut) => cut.mediaId)).toEqual(['b']);
    });

    it('drags a camera cut boundary while preserving a valid contiguous plan', () => {
        const base = createProject(settings);
        const sequence = {
            id: 'moment', sourceType: 'group' as const, sourceId: 'group', inFrame: 0, outFrame: 300, sourceFps: 30,
            activeMediaId: 'a', multicamAngles: [{ mediaId: 'a', inFrame: 0, outFrame: 300, sourceFps: 30 }, { mediaId: 'b', inFrame: 0, outFrame: 300, sourceFps: 30 }],
            videoCuts: [
                { id: 'a-cut', mediaId: 'a', startUs: 0, endUs: 4_000_000, origin: 'automatic' as const },
                { id: 'b-cut', mediaId: 'b', startUs: 4_000_000, endUs: 10_000_000, origin: 'automatic' as const },
            ],
            review: { status: 'approved' as const, reviewedFingerprint: 'old' }, targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '',
        };
        const project = { ...base, sequences: [sequence] };
        const moved = setSequenceCameraCutBoundary(project, 'moment', 'a-cut', 'b-cut', 6_250_000);
        expect(moved.sequences[0].videoCuts).toEqual([
            { ...sequence.videoCuts[0], endUs: 6_250_000, origin: 'manual' },
            { ...sequence.videoCuts[1], startUs: 6_250_000, origin: 'manual' },
        ]);
        expect(videoCutPlanIsValid(moved.sequences[0].videoCuts!, 10_000_000)).toBe(true);
        expect(moved.sequences[0].review).toEqual({ status: 'unreviewed', reviewedFingerprint: null });
    });

    it('keeps at least one timeline frame on either side of a dragged boundary', () => {
        const base = createProject(settings);
        const sequence = {
            id: 'moment', sourceType: 'group' as const, sourceId: 'group', inFrame: 0, outFrame: 300, sourceFps: 30,
            videoCuts: [
                { id: 'a-cut', mediaId: 'a', startUs: 0, endUs: 5_000_000, origin: 'manual' as const },
                { id: 'b-cut', mediaId: 'b', startUs: 5_000_000, endUs: 10_000_000, origin: 'manual' as const },
            ], targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '',
        };
        const moved = setSequenceCameraCutBoundary({ ...base, sequences: [sequence] }, 'moment', 'a-cut', 'b-cut', 10_000_000);
        expect(moved.sequences[0].videoCuts?.[0].endUs).toBe(9_966_667);
        expect(moved.sequences[0].videoCuts?.[1].startUs).toBe(9_966_667);
    });
});
