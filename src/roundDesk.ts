import { compileRenderPlan } from './renderPlan';
import type { GolfProject, VirtualSequence } from './types';

export type HoleStoryStatus = 'empty' | 'started' | 'story-ready';
export type ProductionStatus = 'empty' | 'blocked' | 'needs-review' | 'ready';

export interface HoleStorySummary {
    hole: number;
    par: number;
    lengthMeters: number | null;
    blockCount: number;
    coveredBlockCount: number;
    sequenceCount: number;
    durationSeconds: number;
    status: HoleStoryStatus;
    productionStatus: ProductionStatus;
    blockingIssueCount: number;
    warningCount: number;
    unreviewedSequenceCount: number;
    reviewedSequenceCount: number;
    nextSequenceId?: string;
    nextLabel?: string;
    progress: number;
}

export interface RoundDeskSummary {
    holes: HoleStorySummary[];
    completedHoles: number;
    activeHoles: number;
    sequenceCount: number;
    durationSeconds: number;
    progress: number;
    productionProgress: number;
    readyHoles: number;
    blockedHoles: number;
    unreviewedSequenceCount: number;
    blockingIssueCount: number;
    nextSequenceId?: string;
    nextHole?: number;
    nextLabel?: string;
}

export function holeStoryStatus(blockCount: number, coveredBlockCount: number): HoleStoryStatus {
    if (blockCount > 0 && coveredBlockCount >= blockCount) return 'story-ready';
    if (coveredBlockCount > 0) return 'started';
    return 'empty';
}

export function sequenceProductionStatus(project: GolfProject, sequence: VirtualSequence): Exclude<ProductionStatus, 'empty'> {
    const plan = compileRenderPlan(project, [sequence.id]);
    if (plan.diagnostics.some((item) => item.severity === 'error')) return 'blocked';
    const reviewed = sequence.review?.status === 'approved' && sequence.review.reviewedFingerprint === plan.renderFingerprint;
    return reviewed ? 'ready' : 'needs-review';
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
        const plan = sequenceCount ? compileRenderPlan(project, [...sequenceIds]) : undefined;
        const blockingIssueCount = plan?.diagnostics.filter((item) => item.severity === 'error').length ?? 0;
        const warningCount = plan?.diagnostics.filter((item) => item.severity === 'warning').length ?? 0;
        const sequenceStates = sequences.map((sequence) => ({ sequence, status: sequenceProductionStatus(project, sequence) }));
        const reviewedSequenceCount = sequenceStates.filter((item) => item.status === 'ready').length;
        const unreviewedSequenceCount = sequenceCount - reviewedSequenceCount;
        const productionStatus: ProductionStatus = !sequenceCount
            ? 'empty'
            : blockingIssueCount
                ? 'blocked'
                : unreviewedSequenceCount
                    ? 'needs-review'
                    : 'ready';
        const nextSequenceId = sequenceStates.find((item) => item.status === 'blocked')?.sequence.id
            ?? sequenceStates.find((item) => item.status === 'needs-review')?.sequence.id
            ?? sequences[0]?.id;
        const nextLabel = plan?.diagnostics.find((item) => item.severity === 'error')?.message
            ?? (unreviewedSequenceCount ? `${unreviewedSequenceCount} ${unreviewedSequenceCount === 1 ? 'Moment' : 'Momente'} prüfen` : undefined);
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
            productionStatus,
            blockingIssueCount,
            warningCount,
            unreviewedSequenceCount,
            reviewedSequenceCount,
            nextSequenceId,
            nextLabel,
            progress: blockCount ? Math.round(coveredBlockCount / blockCount * 100) : 0,
        };
    });
    const completedHoles = holes.filter((hole) => hole.status === 'story-ready').length;
    const activeHoles = holes.filter((hole) => hole.status !== 'empty').length;
    const readyHoles = holes.filter((hole) => hole.productionStatus === 'ready').length;
    const blockedHoles = holes.filter((hole) => hole.productionStatus === 'blocked').length;
    const sequenceCount = holes.reduce((sum, hole) => sum + hole.sequenceCount, 0);
    const reviewedSequenceCount = holes.reduce((sum, hole) => sum + hole.reviewedSequenceCount, 0);
    const nextHole = holes.find((hole) => hole.productionStatus === 'blocked')
        ?? holes.find((hole) => hole.productionStatus === 'needs-review');
    return {
        holes,
        completedHoles,
        activeHoles,
        readyHoles,
        blockedHoles,
        sequenceCount,
        unreviewedSequenceCount: holes.reduce((sum, hole) => sum + hole.unreviewedSequenceCount, 0),
        blockingIssueCount: holes.reduce((sum, hole) => sum + hole.blockingIssueCount, 0),
        nextSequenceId: nextHole?.nextSequenceId,
        nextHole: nextHole?.hole,
        nextLabel: nextHole?.nextLabel,
        durationSeconds: holes.reduce((sum, hole) => sum + hole.durationSeconds, 0),
        progress: holes.length ? Math.round(holes.reduce((sum, hole) => sum + hole.progress, 0) / holes.length) : 0,
        productionProgress: sequenceCount ? Math.round(reviewedSequenceCount / sequenceCount * 100) : 0,
    };
}

export function firstSequenceForHole(project: GolfProject, hole: number): string | undefined {
    const sequenceIds = project.blocks
        .filter((block) => block.hole === hole)
        .sort((left, right) => left.order - right.order)
        .flatMap((block) => block.sequenceIds);
    return sequenceIds.find((sequenceId) => project.sequences.some((sequence) => sequence.id === sequenceId));
}
