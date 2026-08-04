import { describe, expect, it } from 'vitest';
import { cameraTransformAtFrame, lockTracerPointsToWorld, screenToWorld, worldToScreen } from './cameraLock';
import type { ShotTracerCameraLock } from './types';

const lock: ShotTracerCameraLock = {
    referenceFrame: 10,
    targetFrame: 50,
    referencePoints: [{ x: .2, y: .3 }, { x: .7, y: .3 }],
    targetPoints: [{ x: .1, y: .4 }, { x: .7, y: .4 }],
};

describe('shot tracer camera lock', () => {
    it('interpolates pan and zoom while preserving reference geometry', () => {
        const start = cameraTransformAtFrame(lock, 10);
        expect(start).toMatchObject({ a: 1, b: 0, tx: 0, ty: 0 });
        expect(worldToScreen(lock, 50, lock.referencePoints[0])).toEqual(lock.targetPoints[0]);
        expect(worldToScreen(lock, 50, lock.referencePoints[1])).toEqual(lock.targetPoints[1]);
    });

    it('round-trips screen and world coordinates and converts existing tracer points', () => {
        const world = { x: .46, y: .22 };
        const screen = worldToScreen(lock, 30, world);
        expect(screenToWorld(lock, 30, screen)).toMatchObject({ x: expect.closeTo(world.x, 8), y: expect.closeTo(world.y, 8) });
        const converted = lockTracerPointsToWorld([{ frame: 50, ...lock.targetPoints[0], kind: 'landing' }], lock);
        expect(converted[0]).toMatchObject({ x: expect.closeTo(.2, 8), y: expect.closeTo(.3, 8) });
    });
});
