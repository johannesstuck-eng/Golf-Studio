import type { ShotTracerEffect } from './types';

export interface TracerVisualState {
    progress: number;
    opacity: number;
    occluded: boolean;
}

export function tracerProgressAtFrame(points: ShotTracerEffect['points'], frame: number): number {
    const ordered = [...points].sort((left, right) => left.frame - right.frame);
    if (ordered.length < 2) return 0;
    if (frame <= ordered[0].frame) return 0;
    if (frame >= ordered.at(-1)!.frame) return 1;
    const distances = ordered.slice(1).map((point, index) => Math.hypot(point.x - ordered[index].x, point.y - ordered[index].y));
    const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
    if (totalDistance <= 0) return 0;
    let covered = 0;
    for (let index = 0; index < ordered.length - 1; index += 1) {
        const start = ordered[index];
        const end = ordered[index + 1];
        if (frame <= end.frame) {
            const duration = Math.max(1, end.frame - start.frame);
            const segmentProgress = Math.min(1, Math.max(0, (frame - start.frame) / duration));
            return Math.min(1, Math.max(0, (covered + distances[index] * segmentProgress) / totalDistance));
        }
        covered += distances[index];
    }
    return 1;
}

export function tracerVisualState(tracer: ShotTracerEffect, frame: number): TracerVisualState {
    const ordered = [...tracer.points].sort((left, right) => left.frame - right.frame);
    const impact = ordered[0]?.frame ?? tracer.impactFrame ?? 0;
    const end = Math.max(impact + 1, ordered.at(-1)?.frame ?? tracer.endFrame ?? impact + 1);
    const disappear = Math.max(end, tracer.disappearFrame ?? end);
    const progress = ordered.length >= 2
        ? tracerProgressAtFrame(ordered, frame)
        : frame <= impact ? 0 : frame >= end ? 1 : (frame - impact) / (end - impact);
    const occluded = false;
    const opacity = frame < impact || frame > disappear
        ? 0
        : frame <= end || disappear === end
            ? 1
            : 1 - (frame - end) / (disappear - end);
    return { progress, opacity, occluded };
}
