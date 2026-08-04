import { playerScoreToPar } from './model';
import type { GolfProject } from './types';

export const EDITORIAL_STYLE = {
    audioFadeFrames: 6,
    holeDipFrames: 10,
    holeCardSeconds: 1.8,
    shotInfoSeconds: 2.6,
} as const;

export interface EditorialTransition {
    kind: 'cut' | 'hole-change';
    audioFadeSeconds: number;
    dipSeconds: number;
    cardSeconds: number;
    nextHole: number | null;
}

export function editorialTransition(project: GolfProject, fromSequenceId: string, toSequenceId?: string): EditorialTransition {
    const from = project.sequences.find((sequence) => sequence.id === fromSequenceId);
    const to = project.sequences.find((sequence) => sequence.id === toSequenceId);
    const fromBlock = project.blocks.find((block) => block.id === from?.targetBlockId);
    const toBlock = project.blocks.find((block) => block.id === to?.targetBlockId);
    const fps = Math.max(1, from?.sourceFps ?? to?.sourceFps ?? project.settings.frameRate ?? 30);
    const holeChange = Boolean(fromBlock && toBlock && fromBlock.hole !== toBlock.hole);
    return {
        kind: holeChange ? 'hole-change' : 'cut',
        audioFadeSeconds: EDITORIAL_STYLE.audioFadeFrames / fps,
        dipSeconds: holeChange ? EDITORIAL_STYLE.holeDipFrames / fps : 0,
        cardSeconds: holeChange ? EDITORIAL_STYLE.holeCardSeconds : 0,
        nextHole: holeChange ? toBlock?.hole ?? null : null,
    };
}

export function scoreBeforeHole(project: GolfProject, playerId: string, hole: number): string {
    const score = playerScoreToPar(project, playerId, Math.max(0, hole - 1));
    if (score === null || score === 0) return 'E';
    return score > 0 ? `+${score}` : String(score);
}
