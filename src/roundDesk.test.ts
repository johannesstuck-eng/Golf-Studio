import { describe, expect, it } from 'vitest';
import { createProject } from './model';
import { firstSequenceForHole, holeStoryStatus, summarizeRoundDesk } from './roundDesk';
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
});
