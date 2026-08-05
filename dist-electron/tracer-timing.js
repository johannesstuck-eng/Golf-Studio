export function tracerFrameAtProgress(points, progress, fallbackStart, fallbackEnd) {
    const ordered = [...points].sort((left, right) => left.frame - right.frame);
    if (ordered.length < 2)
        return fallbackStart + (fallbackEnd - fallbackStart) * progress;
    const scaled = progress * (ordered.length - 1);
    const geometryIndex = Math.min(ordered.length - 2, Math.floor(scaled));
    const geometryProgress = scaled - geometryIndex;
    const distances = ordered.slice(1).map((point, index) => Math.hypot(point.x - ordered[index].x, point.y - ordered[index].y));
    const cumulative = [0];
    distances.forEach((distance) => cumulative.push(cumulative.at(-1) + distance));
    const totalDistance = cumulative.at(-1);
    if (totalDistance <= 0)
        return fallbackStart + (fallbackEnd - fallbackStart) * progress;
    const pathProgress = (cumulative[geometryIndex] + distances[geometryIndex] * geometryProgress) / totalDistance;
    const timingAnchors = ordered.flatMap((point, index) => point.kind === 'curve'
        ? []
        : [{ frame: point.frame, progress: cumulative[index] / totalDistance }]);
    const anchors = timingAnchors.length >= 2
        ? timingAnchors
        : [{ frame: fallbackStart, progress: 0 }, { frame: fallbackEnd, progress: 1 }];
    if (pathProgress <= anchors[0].progress)
        return anchors[0].frame;
    if (pathProgress >= anchors.at(-1).progress)
        return anchors.at(-1).frame;
    for (let index = 0; index < anchors.length - 1; index += 1) {
        const start = anchors[index];
        const end = anchors[index + 1];
        if (pathProgress <= end.progress) {
            const segmentProgress = (pathProgress - start.progress) / Math.max(1e-8, end.progress - start.progress);
            return start.frame + (end.frame - start.frame) * segmentProgress;
        }
    }
    return fallbackEnd;
}
