import type { CameraLockPoint, ShotTracerCameraLock, ShotTracerPoint } from './types';

export interface SimilarityTransform {
    a: number;
    b: number;
    tx: number;
    ty: number;
}

function interpolate(left: CameraLockPoint, right: CameraLockPoint, progress: number): CameraLockPoint {
    return { x: left.x + (right.x - left.x) * progress, y: left.y + (right.y - left.y) * progress };
}

export function cameraTransformAtFrame(lock: ShotTracerCameraLock, frame: number): SimilarityTransform {
    const duration = Math.max(1, lock.targetFrame - lock.referenceFrame);
    const progress = Math.min(1, Math.max(0, (frame - lock.referenceFrame) / duration));
    const [referenceA, referenceB] = lock.referencePoints;
    const currentA = interpolate(referenceA, lock.targetPoints[0], progress);
    const currentB = interpolate(referenceB, lock.targetPoints[1], progress);
    const referenceX = referenceB.x - referenceA.x;
    const referenceY = referenceB.y - referenceA.y;
    const currentX = currentB.x - currentA.x;
    const currentY = currentB.y - currentA.y;
    const denominator = referenceX * referenceX + referenceY * referenceY;
    if (denominator < 1e-8) return { a: 1, b: 0, tx: currentA.x - referenceA.x, ty: currentA.y - referenceA.y };
    const a = (currentX * referenceX + currentY * referenceY) / denominator;
    const b = (currentY * referenceX - currentX * referenceY) / denominator;
    return { a, b, tx: currentA.x - a * referenceA.x + b * referenceA.y, ty: currentA.y - b * referenceA.x - a * referenceA.y };
}

export function worldToScreen(lock: ShotTracerCameraLock | null | undefined, frame: number, point: CameraLockPoint): CameraLockPoint {
    if (!lock) return point;
    const transform = cameraTransformAtFrame(lock, frame);
    return { x: transform.a * point.x - transform.b * point.y + transform.tx, y: transform.b * point.x + transform.a * point.y + transform.ty };
}

export function screenToWorld(lock: ShotTracerCameraLock | null | undefined, frame: number, point: CameraLockPoint): CameraLockPoint {
    if (!lock) return point;
    const transform = cameraTransformAtFrame(lock, frame);
    const denominator = transform.a * transform.a + transform.b * transform.b;
    if (denominator < 1e-8) return point;
    const x = point.x - transform.tx;
    const y = point.y - transform.ty;
    return { x: (transform.a * x + transform.b * y) / denominator, y: (-transform.b * x + transform.a * y) / denominator };
}

export function lockTracerPointsToWorld(points: ShotTracerPoint[], lock: ShotTracerCameraLock): ShotTracerPoint[] {
    return points.map((point) => ({ ...point, ...screenToWorld(lock, point.frame, point) }));
}

export function svgCameraMatrix(lock: ShotTracerCameraLock | null | undefined, frame: number): string | undefined {
    if (!lock) return undefined;
    const transform = cameraTransformAtFrame(lock, frame);
    return `matrix(${transform.a} ${transform.b} ${-transform.b} ${transform.a} ${transform.tx * 1000} ${transform.ty * 1000})`;
}
