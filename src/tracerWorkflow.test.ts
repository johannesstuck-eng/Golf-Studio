import { describe, expect, it } from 'vitest';
import { createTracerFlight, insertTracerIntermediate } from './tracerWorkflow';

describe('manual tracer workflow', () => {
    it('uses the manually chosen landing frame as the exact final point', () => {
        const points = createTracerFlight({ frame: 12, x: .2, y: .78, kind: 'impact' }, 83, .76, .62);
        expect(points.map((point) => point.kind)).toEqual(['impact', 'curve', 'landing']);
        expect(points[2]).toMatchObject({ frame: 83, x: .76, y: .62, kind: 'landing' });
        expect(points[1].frame).toBeGreaterThan(12);
        expect(points[1].frame).toBeLessThan(83);
        expect(points[1].y).toBeLessThan(points[0].y);
    });

    it('inserts optional intermediate points without changing impact or landing', () => {
        const flight = createTracerFlight({ frame: 10, x: .1, y: .8 }, 70, .8, .7);
        const updated = insertTracerIntermediate(flight, { frame: 26, x: .34, y: .42 });
        expect(updated.find((point) => point.kind === 'impact')?.frame).toBe(10);
        expect(updated.find((point) => point.kind === 'landing')?.frame).toBe(70);
        expect(updated.find((point) => point.kind === 'intermediate')).toMatchObject({ frame: 26, x: .34, y: .42 });
    });
});
