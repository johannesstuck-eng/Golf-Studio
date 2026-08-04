import type { ShotTracerPoint } from './types';

export function createTracerFlight(impactPoint: ShotTracerPoint, landingFrame: number, landingX: number, landingY: number): ShotTracerPoint[] {
    const frame = Math.max(impactPoint.frame + 1, Math.round(landingFrame));
    const curveFrame = Math.round(impactPoint.frame + (frame - impactPoint.frame) * .48);
    const horizontalDistance = Math.abs(landingX - impactPoint.x);
    const curvePoint: ShotTracerPoint = {
        frame: curveFrame,
        x: impactPoint.x + (landingX - impactPoint.x) * .5,
        y: Math.max(.04, Math.min(impactPoint.y, landingY) - Math.min(.34, Math.max(.14, horizontalDistance * .35))),
        kind: 'curve',
    };
    return [
        { ...impactPoint, kind: 'impact' },
        curvePoint,
        { frame, x: landingX, y: landingY, kind: 'landing' },
    ];
}

export function insertTracerIntermediate(points: ShotTracerPoint[], point: ShotTracerPoint): ShotTracerPoint[] {
    return [...points.filter((item) => item.frame !== point.frame || item.kind === 'impact' || item.kind === 'landing'), { ...point, kind: 'intermediate' as const }]
        .sort((left, right) => left.frame - right.frame);
}
