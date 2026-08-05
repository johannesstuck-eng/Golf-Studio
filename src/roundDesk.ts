import type { GolfProject } from './types';

export type HoleStoryStatus = 'empty' | 'started' | 'story-ready';

export interface HoleStorySummary {
    hole: number;
    par: number;
    lengthMeters: number | null;
    blockCount: number;
    coveredBlockCount: number;
    sequenceCount: number;
    durationSeconds: number;
    status: HoleStoryStatus;
    progress: number;
}

export interface RoundDeskSummary {
    holes: HoleStorySummary[];
    completedHoles: number;
    activeHoles: number;
    sequenceCount: number;
    durationSeconds: number;
    progress: number;
}

export function holeStoryStatus(blockCount: number, coveredBlockCount: number): HoleStoryStatus {
    if (blockCount > 0 && coveredBlockCount >= blockCount) return 'story-ready';
    if (coveredBlockCount > 0) return 'started';
    return 'empty';
}

export function summarizeRoundDesk(project: GolfProject): RoundDeskSummary {
    const holes = Array.from({ length: project.settings.holes }, (_, index): HoleStorySummary => {
        const hole = index + 1;
        const blocks = project.blocks.filter((block) => block.hole === hole);
        const sequenceIds = new Set(blocks.flatMap((block) => block.sequenceIds));
        const sequences = project.sequences.filter((sequence) => sequenceIds.has(sequence.id));
        const sequenceCount = sequences.length;
        const blockCount = blocks.length;
        const coveredBlockCount = blocks.filter((block) => block.sequenceIds.some((sequenceId) => project.sequences.some((sequence) => sequence.id === sequenceId))).length;
        const status = holeStoryStatus(blockCount, coveredBlockCount);
        const holeData = project.courseData.holes.find((item) => item.number === hole);
        return {
            hole,
            par: holeData?.par ?? 4,
            lengthMeters: holeData?.lengthMeters ?? null,
            blockCount,
            coveredBlockCount,
            sequenceCount,
            durationSeconds: sequences.reduce((sum, sequence) => sum + Math.max(0, sequence.outFrame - sequence.inFrame) / Math.max(1, sequence.sourceFps), 0),
            status,
            progress: blockCount ? Math.round(coveredBlockCount / blockCount * 100) : 0,
        };
    });
    const completedHoles = holes.filter((hole) => hole.status === 'story-ready').length;
    const activeHoles = holes.filter((hole) => hole.status !== 'empty').length;
    return {
        holes,
        completedHoles,
        activeHoles,
        sequenceCount: holes.reduce((sum, hole) => sum + hole.sequenceCount, 0),
        durationSeconds: holes.reduce((sum, hole) => sum + hole.durationSeconds, 0),
        progress: holes.length ? Math.round(holes.reduce((sum, hole) => sum + hole.progress, 0) / holes.length) : 0,
    };
}

export function firstSequenceForHole(project: GolfProject, hole: number): string | undefined {
    const sequenceIds = project.blocks
        .filter((block) => block.hole === hole)
        .sort((left, right) => left.order - right.order)
        .flatMap((block) => block.sequenceIds);
    return sequenceIds.find((sequenceId) => project.sequences.some((sequence) => sequence.id === sequenceId));
}
