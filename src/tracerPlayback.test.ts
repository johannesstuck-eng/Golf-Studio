import { describe, expect, it } from 'vitest';
import { tracerProgressAtFrame, tracerVisualState } from './tracerPlayback';
import type { ShotTracerEffect } from './types';

const tracer: ShotTracerEffect = {
    id: 'tracer', sequenceId: 'sequence', enabled: true,
    impactFrame: 10, endFrame: 50, disappearFrame: 70,
    points: [], color: '#fff', thickness: 5, glow: 10, smoothing: .7,
    tailLength: .16, occlusionStartFrame: null, occlusionEndFrame: null,
    cameraLock: null,
};

describe('shot tracer playback state', () => {
    it('reveals continuously between impact and flight end', () => {
        expect(tracerVisualState(tracer, 9)).toEqual({ progress: 0, opacity: 0, occluded: false });
        expect(tracerVisualState(tracer, 10)).toEqual({ progress: 0, opacity: 1, occluded: false });
        expect(tracerVisualState(tracer, 20).progress).toBe(.25);
        expect(tracerVisualState(tracer, 30).progress).toBe(.5);
        expect(tracerVisualState(tracer, 50)).toEqual({ progress: 1, opacity: 1, occluded: false });
    });

    it('fades smoothly after flight end', () => {
        expect(tracerVisualState(tracer, 60)).toEqual({ progress: 1, opacity: .5, occluded: false });
        expect(tracerVisualState(tracer, 70)).toEqual({ progress: 1, opacity: 0, occluded: false });
        expect(tracerVisualState(tracer, 71)).toEqual({ progress: 1, opacity: 0, occluded: false });
    });

    it('uses the real frame of every manually tracked point', () => {
        const points = [
            { frame: 10, x: .1, y: .8 },
            { frame: 12, x: .3, y: .5 },
            { frame: 30, x: .8, y: .2 },
        ];
        expect(tracerProgressAtFrame(points, 11)).toBeGreaterThan(.1);
        const shortlyAfterSecondPoint = tracerProgressAtFrame(points, 13);
        const halfwayThroughSlowSegment = tracerProgressAtFrame(points, 21);
        expect(halfwayThroughSlowSegment - shortlyAfterSecondPoint).toBeGreaterThan(.1);
        expect(tracerVisualState({ ...tracer, points }, 12).progress).toBeCloseTo(tracerProgressAtFrame(points, 12));
        expect(tracerVisualState({ ...tracer, points }, 30).progress).toBe(1);
    });

    it('keeps the tracer overlay visible across foreground obstacles', () => {
        const legacyOcclusion = { ...tracer, occlusionStartFrame: 24, occlusionEndFrame: 45 };
        expect(tracerVisualState(legacyOcclusion, 30)).toMatchObject({ opacity: 1, occluded: false });
    });
});
