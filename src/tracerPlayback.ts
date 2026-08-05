import type { ShotTracerEffect } from './types';

export interface TracerVisualState {
    progress: number;
    opacity: number;
    occluded: boolean;
}

export function tracerProgressAtFrame(points: ShotTracerEffect['points'], frame: number): number {
    const ordered = [...points].sort((left, right) => left.frame - right.frame);
    if (ordered.length < 2) return 0;
    const distances = ordered.slice(1).map((point, index) => Math.hypot(point.x - ordered[index].x, point.y - ordered[index].y));
    const totalDistance = distances.reduce((sum, distance) => sum + distance, 0);
    if (totalDistance <= 0) return 0;
    const cumulative = [0];
    distances.forEach((distance) => cumulative.push(cumulative.at(-1)! + distance));
    const timingAnchors = ordered.flatMap((point, index) => point.kind === 'curve'
        ? []
        : [{ frame: point.frame, progress: cumulative[index] / totalDistance }]);
    const anchors = timingAnchors.length >= 2
        ? timingAnchors
        : [{ frame: ordered[0].frame, progress: 0 }, { frame: ordered.at(-1)!.frame, progress: 1 }];
    if (frame <= anchors[0].frame) return anchors[0].progress;
    if (frame >= anchors.at(-1)!.frame) return anchors.at(-1)!.progress;
    for (let index = 0; index < anchors.length - 1; index += 1) {
        const start = anchors[index];
        const end = anchors[index + 1];
        if (frame <= end.frame) {
            const segmentProgress = Math.min(1, Math.max(0, (frame - start.frame) / Math.max(1, end.frame - start.frame)));
            return start.progress + (end.progress - start.progress) * segmentProgress;
        }
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
