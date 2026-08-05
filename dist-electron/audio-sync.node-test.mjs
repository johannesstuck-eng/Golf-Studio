import assert from 'node:assert/strict';
import test from 'node:test';
import { compactWaveform, confidenceForScore, findAudioSyncOffset, pcm16Envelope } from './audio-sync.js';

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
