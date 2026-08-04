import { describe, expect, it } from 'vitest';
import { addBlock, automaticPlayerOrder, clearPlayerOrderOverride, createProject, deleteBlock, duplicateBlock, effectivePlayerOrder, hasPlayerOrderOverride, moveBlock, movePlayerInOrder, moveSequence, normalizeProject, playerScoreToPar, proposeShotTracer, roughCutSequenceIds, setScorecardSource, toggleSequenceOverlay, toggleShotTracer, updateBlockDetails, updateHoleData, updatePlayerScore, updateSequenceOverlay, updateShotTracer, upsertSequence } from './model';
import type { ProjectSettings } from './types';

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
        expect(project.schemaVersion).toBe(6);
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
        expect(migrated.schemaVersion).toBe(6);
        expect(migrated.shotTracers[0]).toMatchObject({ color: '#c8ff42', thickness: 5, glow: 12, smoothing: .72, tailLength: .16, occlusionStartFrame: null, occlusionEndFrame: null, cameraLock: null });
        expect(migrated.shotTracers[0].points[0]).toMatchObject({ x: 1, y: 0 });
    });
});
