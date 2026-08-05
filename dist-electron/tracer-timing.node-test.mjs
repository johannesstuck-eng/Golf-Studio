import assert from 'node:assert/strict';
import test from 'node:test';
import { tracerFrameAtProgress } from './tracer-timing.js';

test('export timing ignores curve handles as timing anchors', () => {
    const points = [
        { frame: 10, x: .1, y: .8, kind: 'impact' },
        { frame: 20, x: .5, y: .1, kind: 'curve' },
        { frame: 50, x: .9, y: .7, kind: 'landing' },
    ];
    assert.equal(tracerFrameAtProgress(points, 0, 10, 50), 10);
    assert.equal(tracerFrameAtProgress(points, 1, 10, 50), 50);
    const handleFrame = tracerFrameAtProgress(points, .5, 10, 50);
    assert.ok(handleFrame > 20, `expected shape midpoint after frame 20, got ${handleFrame}`);
});

test('export timing honors real intermediate frame anchors', () => {
    const points = [
        { frame: 10, x: .1, y: .8, kind: 'impact' },
        { frame: 20, x: .5, y: .4, kind: 'intermediate' },
        { frame: 50, x: .9, y: .7, kind: 'landing' },
    ];
    assert.ok(Math.abs(tracerFrameAtProgress(points, .5, 10, 50) - 20) < .001);
});
