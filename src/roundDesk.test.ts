import { describe, expect, it } from 'vitest';
import { createProject, markSequenceReviewed } from './model';
import { firstSequenceForHole, holeStoryStatus, summarizeRoundDesk } from './roundDesk';
import { compileRenderPlan } from './renderPlan';
import type { GolfProject, VirtualSequence } from './types';

function project(): GolfProject {
    return createProject({
        id: 'round', course: 'North Links', holes: 18, players: [{ id: 'p1', name: 'Jo' }],
        name: 'North Links', createdAt: '2026-08-05T10:00:00.000Z', orientation: 'horizontal', resolution: '4K', frameRate: 60,
    });
}

function sequence(id: string, targetBlockId: string, durationFrames = 600): VirtualSequence {
    return { id, sourceType: 'media', sourceId: 'media-1', inFrame: 0, outFrame: durationFrames, sourceFps: 60, targetBlockId, createdAt: '', updatedAt: '' };
}

describe('round desk summaries', () => {
    it('distinguishes empty structure from a film-ready hole', () => {
        expect(holeStoryStatus(0, 0)).toBe('empty');
        expect(holeStoryStatus(3, 0)).toBe('empty');
        expect(holeStoryStatus(3, 1)).toBe('started');
        expect(holeStoryStatus(3, 3)).toBe('story-ready');
    });

    it('summarizes all 18 holes from real block and sequence relationships', () => {
        const base = project();
        const firstBlock = base.blocks.find((block) => block.hole === 1)!;
        const secondBlock = base.blocks.find((block) => block.hole === 2)!;
        const clip = sequence('sequence-1', firstBlock.id);
        const populated = {
            ...base,
            sequences: [clip],
            blocks: base.blocks.map((block) => block.id === firstBlock.id ? { ...block, sequenceIds: [clip.id] } : block.id === secondBlock.id ? { ...block, sequenceIds: [] } : block),
        };
        const summary = summarizeRoundDesk(populated);
        expect(summary.holes).toHaveLength(18);
        expect(summary.holes[0]).toMatchObject({ status: 'started', sequenceCount: 1, durationSeconds: 10 });
        expect(summary.holes[1].status).toBe('empty');
        expect(summary.completedHoles).toBe(0);
        expect(summary.sequenceCount).toBe(1);
    });

    it('summarizes a nine-hole project without inventing extra holes', () => {
        const base = project();
        const nineHoleProject = { ...base, settings: { ...base.settings, holes: 9 as const } };
        const summary = summarizeRoundDesk(nineHoleProject);
        expect(summary.holes).toHaveLength(9);
        expect(summary.progress).toBe(0);
        expect(summary.activeHoles).toBe(0);
    });

    it('opens the earliest valid sequence in the selected hole', () => {
        const base = project();
        const blocks = base.blocks.filter((block) => block.hole === 1).slice(0, 2);
        const populated = {
            ...base,
            sequences: [sequence('later', blocks[1].id), sequence('first', blocks[0].id)],
            blocks: base.blocks.map((block) => block.id === blocks[0].id ? { ...block, sequenceIds: ['missing', 'first'] } : block.id === blocks[1].id ? { ...block, sequenceIds: ['later'] } : block),
        };
        expect(firstSequenceForHole(populated, 1)).toBe('first');
        expect(firstSequenceForHole(populated, 18)).toBeUndefined();
    });

    it('prioritizes real render blockers and counts only fingerprint-matched reviews as checked', () => {
        const base = project();
        const block = base.blocks.find((item) => item.hole === 1)!;
        const clip = { ...sequence('shot', block.id), videoCuts: [{ id: 'cut', mediaId: 'media-1', startUs: 0, endUs: 10_000_000, origin: 'manual' as const }], audioPlan: { mediaId: null, mode: 'muted' as const, offsetUs: 0, gainDb: 0, muted: true } };
        const populated: GolfProject = {
            ...base,
            media: [{ id: 'media-1', name: 'shot.mp4', path: 'C:\\shot.mp4', kind: 'video', device: 'Camera', deviceKey: 'camera', recordedAt: '', durationSeconds: 30, width: 1920, height: 1080, fps: 60, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1 }],
            sequences: [clip],
            blocks: base.blocks.map((item) => item.id === block.id ? { ...item, sequenceIds: [clip.id] } : item),
        };
        const pending = summarizeRoundDesk(populated);
        expect(pending.holes[0]).toMatchObject({ productionStatus: 'needs-review', unreviewedSequenceCount: 1, blockingIssueCount: 0, nextSequenceId: 'shot' });
        expect(pending).toMatchObject({ productionProgress: 0, nextHole: 1, nextSequenceId: 'shot' });

        const fingerprint = compileRenderPlan(populated, ['shot']).renderFingerprint;
        expect(markSequenceReviewed(populated, 'shot', 'rp1-0000000000000000')).toBe(populated);
        const reviewed = markSequenceReviewed(populated, 'shot', fingerprint);
        const ready = summarizeRoundDesk(reviewed);
        expect(ready.holes[0]).toMatchObject({ productionStatus: 'ready', reviewedSequenceCount: 1 });
        expect(ready.productionProgress).toBe(100);
        expect(ready.nextSequenceId).toBeUndefined();

        const broken = { ...reviewed, media: [] };
        const blocked = summarizeRoundDesk(broken);
        expect(blocked.holes[0].productionStatus).toBe('blocked');
        expect(blocked.blockingIssueCount).toBeGreaterThan(0);
        expect(blocked.nextSequenceId).toBe('shot');
    });
});
