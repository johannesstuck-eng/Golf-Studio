import assert from 'node:assert/strict';
import test from 'node:test';
import { alignAudioTracks, compactWaveform, confidenceForScore, findAudioSyncOffset, pcm16Envelope } from './audio-sync.js';

test('audio correlation recovers a delayed camera offset', () => {
    let state = 42;
    const reference = Array.from({ length: 1500 }, (_, index) => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0xffffffff - .5 + ([137, 421, 988, 1203].includes(index) ? 4 : 0);
    });
    const candidate = [...new Array(24).fill(0), ...reference, ...new Array(24).fill(0)];
    const result = findAudioSyncOffset(reference, candidate, 0, 50, 2);
    assert.equal(result.offsetSeconds, 0.48);
    assert.ok(result.score > .9);
    assert.equal(confidenceForScore(result.score, result.overlapSeconds), 'high');
});

test('PCM envelope and compact waveform stay bounded', () => {
    const pcm = Buffer.alloc(4000);
    for (let index = 0; index < 2000; index += 1) pcm.writeInt16LE(index % 200 < 20 ? 30000 : 1000, index * 2);
    const envelope = pcm16Envelope(pcm, 2000, 50);
    const compact = compactWaveform(envelope, 20);
    assert.ok(compact.length <= 20);
    assert.ok(compact.every((value) => value >= 0 && value <= 1));
});

test('audio alignment follows a chain of overlapping clips', () => {
    let state = 9;
    const global = Array.from({ length: 3000 }, () => {
        state = (1103515245 * state + 12345) >>> 0;
        return state / 0xffffffff - .5;
    });
    const tracks = [
        { id: 'a', recordedAt: '2026-08-05T10:00:00.000Z', durationSeconds: 30, envelope: global.slice(0, 1500) },
        { id: 'b', recordedAt: '2026-08-05T10:00:25.000Z', durationSeconds: 25, envelope: global.slice(1250, 2500) },
        { id: 'c', recordedAt: '2026-08-05T10:00:45.000Z', durationSeconds: 15, envelope: global.slice(2250, 3000) },
    ];
    const result = alignAudioTracks(tracks, 50, 2);
    assert.deepEqual(result.offsetsSeconds, { a: 0, b: 0, c: 0 });
    assert.equal(result.referenceByMediaId.c, 'b');
    assert.deepEqual(result.unmatchedIds, []);
});
