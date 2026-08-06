import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { prepareRenderPlanExport, RenderPlanExportError } from './render-plan-export.js';
import { buildRenderPlanGraph, renderPlanInputArguments } from './render-plan-graph.js';

function fixture() {
    const media = (id) => ({ id, path: `C:\\video\\${id}.mp4`, name: id, kind: 'video', durationSeconds: 20, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, bitDepth: 8 });
    return {
        schemaVersion: 9,
        settings: { frameRate: 30 },
        media: [media('a'), media('b')],
        groups: [{ id: 'g', mediaIds: ['a', 'b'] }],
        blocks: [{ id: 'block', hole: 1, playerId: 'p' }],
        sequences: [{
            id: 'moment', sourceType: 'group', sourceId: 'g', targetBlockId: 'block', inFrame: 0, outFrame: 300, sourceFps: 30,
            multicamAngles: [{ mediaId: 'a', inFrame: 0, outFrame: 300, sourceFps: 30 }, { mediaId: 'b', inFrame: 30, outFrame: 330, sourceFps: 30 }],
            videoCuts: [
                { id: 'a1', mediaId: 'a', startUs: 0, endUs: 2_000_000 },
                { id: 'b1', mediaId: 'b', startUs: 2_000_000, endUs: 8_000_000 },
                { id: 'a2', mediaId: 'a', startUs: 8_000_000, endUs: 10_000_000 },
            ],
            audioPlan: { mode: 'master', mediaId: 'a', offsetUs: 100_000, gainDb: -2 },
        }],
        shotTracers: [{ id: 'tracer', sequenceId: 'moment', enabled: true, binding: { cutId: 'b1', mediaId: 'b' }, impactFrame: 90, endFrame: 180, disappearFrame: 210, points: [] }],
    };
}

describe('render-plan export adapter', () => {
    it('preserves A to B to A picture cuts, stable master audio and bound effects', () => {
        const prepared = prepareRenderPlanExport(fixture(), ['moment']);
        assert.deepEqual(prepared.videoSegments.map((item) => item.media.id), ['a', 'b', 'a']);
        assert.deepEqual(prepared.videoSegments.map((item) => item.inputIndex), [0, 1, 2]);
        assert.equal(prepared.audioSegments.length, 1);
        assert.equal(prepared.audioSegments[0].media.id, 'a');
        assert.equal(prepared.audioSegments[0].inputIndex, 3);
        assert.equal(prepared.videoSegments[0].tracerPlacements.length, 0);
        assert.equal(prepared.videoSegments[1].tracerPlacements[0].tracerId, 'tracer');
        assert.equal(prepared.videoSegments[2].tracerPlacements.length, 0);
    });

    it('blocks an invalid final camera plan instead of dropping it', () => {
        const project = fixture();
        project.sequences[0].videoCuts = [];
        assert.throws(() => prepareRenderPlanExport(project, ['moment']), RenderPlanExportError);
    });

    it('builds separate picture and master-audio inputs with deterministic concat order', () => {
        const prepared = prepareRenderPlanExport(fixture(), ['moment']);
        const args = renderPlanInputArguments(prepared);
        assert.equal(args.filter((item) => item === '-i').length, 4);
        assert.deepEqual(args.filter((item) => String(item).endsWith('.mp4')), [
            'C:\\video\\a.mp4', 'C:\\video\\b.mp4', 'C:\\video\\a.mp4', 'C:\\video\\a.mp4',
        ]);
        const filteredCuts = [];
        const graph = buildRenderPlanGraph(prepared, { width: 1920, height: 1080, fps: 30, pixelFormat: 'yuv420p' }, {
            videoFilters: ({ segment }) => { filteredCuts.push(segment.cutId); return []; },
        });
        assert.deepEqual(filteredCuts, ['a1', 'b1', 'a2']);
        assert.ok(graph.some((line) => line.includes('[vs0_0][vs0_1][vs0_2]concat=n=3:v=1:a=0[mv0]')));
        assert.ok(graph.at(-1).includes('[mv0][ma0]concat=n=1:v=1:a=1[vout][aout]'));
    });
});
