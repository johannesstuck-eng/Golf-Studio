import assert from 'node:assert/strict';
import test from 'node:test';
import { exportMediaForSequence, exportRangeForSequence } from './multicam-export.js';

test('multicam export uses the selected camera and its aligned local range', () => {
    const project = {
        media: [{ id: 'wide', kind: 'video' }, { id: 'close', kind: 'video' }],
        groups: [{ id: 'group', mediaIds: ['wide', 'close'] }],
    };
    const sequence = {
        sourceType: 'group', sourceId: 'group', activeMediaId: 'close',
        inFrame: 60, outFrame: 600, sourceFps: 60,
        multicamAngles: [
            { mediaId: 'wide', inFrame: 30, outFrame: 300, sourceFps: 30 },
            { mediaId: 'close', inFrame: 0, outFrame: 480, sourceFps: 60 },
        ],
    };
    const media = exportMediaForSequence(project, sequence);
    assert.equal(media.id, 'close');
    assert.deepEqual(exportRangeForSequence(sequence, media), { mediaId: 'close', inFrame: 0, outFrame: 480, sourceFps: 60 });
});

test('legacy multicam sequences still fall back to the first video', () => {
    const project = {
        media: [{ id: 'audio', kind: 'audio' }, { id: 'wide', kind: 'video' }],
        groups: [{ id: 'group', mediaIds: ['audio', 'wide'] }],
    };
    const sequence = { sourceType: 'group', sourceId: 'group', inFrame: 30, outFrame: 90, sourceFps: 30 };
    const media = exportMediaForSequence(project, sequence);
    assert.equal(media.id, 'wide');
    assert.deepEqual(exportRangeForSequence(sequence, media), { inFrame: 30, outFrame: 90, sourceFps: 30 });
});
