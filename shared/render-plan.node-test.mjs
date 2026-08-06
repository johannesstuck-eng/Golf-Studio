import assert from 'node:assert/strict';
import test from 'node:test';
import { compileRenderPlan } from './render-plan.mjs';

const second = 1_000_000;

function media(id, overrides = {}) {
    return { id, kind: 'video', durationSeconds: 30, hasAudio: true, ...overrides };
}

function angle(mediaId, durationUs = 9 * second, overrides = {}) {
    return {
        mediaId,
        momentStartUs: 0,
        momentEndUs: durationUs,
        sourceStartUs: 0,
        sourceEndUs: durationUs,
        sourceFps: 60,
        ...overrides,
    };
}

function multicamProject(overrides = {}) {
    const sequence = {
        id: 'moment-1',
        sourceType: 'group',
        sourceId: 'group-1',
        targetBlockId: 'block-1',
        durationUs: 9 * second,
        multicamAngles: [angle('camera-a'), angle('camera-b')],
        videoCuts: [
            { id: 'cut-a1', startUs: 0, endUs: 3 * second, mediaId: 'camera-a' },
            { id: 'cut-b', startUs: 3 * second, endUs: 6 * second, mediaId: 'camera-b' },
            { id: 'cut-a2', startUs: 6 * second, endUs: 9 * second, mediaId: 'camera-a' },
        ],
        audioPlan: { mediaId: 'camera-a', status: 'ready' },
        review: { status: 'approved', reviewedFingerprint: 'previous-plan' },
        ...overrides.sequence,
    };
    return {
        media: [media('camera-a'), media('camera-b')],
        groups: [{ id: 'group-1', mediaIds: ['camera-a', 'camera-b'] }],
        blocks: [{ id: 'block-1', hole: 1, playerId: 'player-1' }],
        sequences: [sequence],
        shotTracers: [],
        ...overrides.project,
    };
}

test('compiles an A to B to A camera cut in deterministic film order', () => {
    const project = multicamProject();
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, true);
    assert.equal(plan.totalDurationUs, 9 * second);
    assert.deepEqual(plan.videoSegments.map((segment) => ({
        cutId: segment.cutId,
        mediaId: segment.mediaId,
        film: [segment.filmStartUs, segment.filmEndUs],
        source: [segment.sourceStartUs, segment.sourceEndUs],
    })), [
        { cutId: 'cut-a1', mediaId: 'camera-a', film: [0, 3 * second], source: [0, 3 * second] },
        { cutId: 'cut-b', mediaId: 'camera-b', film: [3 * second, 6 * second], source: [3 * second, 6 * second] },
        { cutId: 'cut-a2', mediaId: 'camera-a', film: [6 * second, 9 * second], source: [6 * second, 9 * second] },
    ]);
    assert.deepEqual(plan.audioSegments.map((segment) => [segment.mediaId, segment.filmStartUs, segment.filmEndUs]), [
        ['camera-a', 0, 9 * second],
    ]);
});

test('produces byte-for-byte deterministic preview and export plans from unordered cuts', () => {
    const project = multicamProject();
    project.sequences[0].videoCuts = [...project.sequences[0].videoCuts].reverse();
    const previewPlan = compileRenderPlan(project, ['moment-1']);
    const exportPlan = compileRenderPlan(project, ['moment-1']);
    assert.deepEqual(previewPlan, exportPlan);
    assert.match(previewPlan.renderFingerprint, /^rp1-[0-9a-f]{16}$/);
    assert.deepEqual(previewPlan.videoSegments.map((segment) => segment.cutId), ['cut-a1', 'cut-b', 'cut-a2']);
});

test('reads sequence review without making approval metadata part of the render fingerprint', () => {
    const project = multicamProject();
    const approved = compileRenderPlan(project, ['moment-1']);
    project.sequences[0].review = { status: 'needs-review', reviewedFingerprint: null };
    const needsReview = compileRenderPlan(project, ['moment-1']);
    assert.deepEqual(approved.moments[0].review, { status: 'approved', reviewedFingerprint: 'previous-plan' });
    assert.deepEqual(needsReview.moments[0].review, { status: 'needs-review', reviewedFingerprint: null });
    assert.equal(approved.renderFingerprint, needsReview.renderFingerprint);
});

test('changes the render fingerprint when a final camera decision changes', () => {
    const project = multicamProject();
    const before = compileRenderPlan(project, ['moment-1']);
    project.sequences[0].videoCuts[1].mediaId = 'camera-a';
    const after = compileRenderPlan(project, ['moment-1']);
    assert.notEqual(before.renderFingerprint, after.renderFingerprint);
});

test('reports a missing selected source and never substitutes another group camera', () => {
    const project = multicamProject();
    project.sequences[0].videoCuts[1].mediaId = 'offline-camera';
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, false);
    assert.equal(plan.videoSegments.some((segment) => segment.cutId === 'cut-b'), false);
    assert.equal(plan.videoSegments.some((segment) => segment.mediaId === 'camera-a' && segment.startUs === 3 * second), false);
    assert.ok(plan.diagnostics.some((item) => item.code === 'MEDIA_MISSING' && item.cutId === 'cut-b'));
});

test('reports gaps and overlaps in final camera coverage', async (t) => {
    await t.test('gap', () => {
        const project = multicamProject();
        project.sequences[0].videoCuts[1].startUs = 4 * second;
        const plan = compileRenderPlan(project, ['moment-1']);
        assert.equal(plan.valid, false);
        assert.ok(plan.diagnostics.some((item) => item.code === 'VIDEO_CUT_GAP'));
    });
    await t.test('overlap', () => {
        const project = multicamProject();
        project.sequences[0].videoCuts[1].startUs = 2 * second;
        const plan = compileRenderPlan(project, ['moment-1']);
        assert.equal(plan.valid, false);
        assert.ok(plan.diagnostics.some((item) => item.code === 'VIDEO_CUT_OVERLAP'));
    });
});

test('places an angle-bound tracer only on cuts using that camera', () => {
    const project = multicamProject();
    project.shotTracers = [{
        id: 'tracer-b', sequenceId: 'moment-1', enabled: true,
        startUs: 0, endUs: 9 * second,
        binding: { mediaId: 'camera-b' },
        points: [],
    }];
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.tracerPlacements.map((placement) => [placement.cutId, placement.mediaId]), [['cut-b', 'camera-b']]);
});

test('supports a deterministic v8 activeMediaId fallback without selecting another camera', () => {
    const project = multicamProject({ sequence: {
        durationUs: undefined,
        inFrame: 0,
        outFrame: 300,
        sourceFps: 30,
        activeMediaId: 'camera-b',
        videoCuts: undefined,
        audioPlan: undefined,
        multicamAngles: [
            { mediaId: 'camera-a', inFrame: 0, outFrame: 300, sourceFps: 30 },
            { mediaId: 'camera-b', inFrame: 150, outFrame: 450, sourceFps: 30 },
        ],
    } });
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.videoSegments.map((segment) => [segment.mediaId, segment.sourceStartUs, segment.sourceEndUs]), [
        ['camera-b', 5 * second, 15 * second],
    ]);
    assert.deepEqual(plan.audioSegments.map((segment) => segment.mediaId), ['camera-b']);
    assert.ok(plan.diagnostics.some((item) => item.code === 'LEGACY_AUDIO_FOLLOWS_VIDEO'));
});

test('supports an independent audio source with an explicit local range', () => {
    const project = multicamProject();
    project.media.push(media('recorder', { kind: 'audio', hasAudio: true }));
    project.sequences[0].audioPlan = { sourceMediaId: 'recorder', sourceStartUs: 2 * second, sourceEndUs: 11 * second, status: 'ready' };
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.audioSegments.map((segment) => [segment.mediaId, segment.sourceStartUs, segment.sourceEndUs]), [
        ['recorder', 2 * second, 11 * second],
    ]);
});

test('treats muted audio mode as intentional valid silence', () => {
    const project = multicamProject();
    project.sequences[0].audioPlan = { mediaId: null, mode: 'muted', offsetUs: 0, gainDb: 0, muted: true };
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, true);
    assert.deepEqual(plan.audioSegments, []);
    assert.equal(plan.diagnostics.some((item) => item.code === 'AUDIO_PLAN_MISSING'), false);
});

test('applies a master audio offset to the local source range and diagnoses bounds', async (t) => {
    await t.test('valid offset', () => {
        const project = multicamProject();
        project.sequences[0].multicamAngles[0] = angle('camera-a', 9 * second, { sourceStartUs: second, sourceEndUs: 11 * second });
        project.sequences[0].audioPlan = { mediaId: 'camera-a', mode: 'master', offsetUs: 500_000, gainDb: -3, muted: false };
        const plan = compileRenderPlan(project, ['moment-1']);
        assert.equal(plan.valid, true);
        assert.deepEqual(plan.audioSegments.map((segment) => [segment.sourceStartUs, segment.sourceEndUs, segment.offsetUs, segment.gainDb]), [
            [1_500_000, 10_500_000, 500_000, -3],
        ]);
    });
    await t.test('out of bounds', () => {
        const project = multicamProject();
        project.sequences[0].audioPlan = { mediaId: 'camera-a', mode: 'master', offsetUs: 25 * second, gainDb: 0, muted: false };
        const plan = compileRenderPlan(project, ['moment-1']);
        assert.equal(plan.valid, false);
        assert.ok(plan.diagnostics.some((item) => item.code === 'AUDIO_OFFSET_OUT_OF_BOUNDS'));
    });
});

test('reports a null unresolved camera without substituting another angle', () => {
    const project = multicamProject();
    project.sequences[0].videoCuts[1].mediaId = null;
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, false);
    assert.equal(plan.videoSegments.some((segment) => segment.cutId === 'cut-b'), false);
    assert.ok(plan.diagnostics.some((item) => item.code === 'VIDEO_CUT_MEDIA_MISSING' && item.cutId === 'cut-b'));
});

test('rejects a camera whose synchronized angle does not cover the complete cut', () => {
    const project = multicamProject();
    project.sequences[0].multicamAngles[1] = angle('camera-b', 9 * second, {
        momentStartUs: 4 * second,
        momentEndUs: 9 * second,
        sourceStartUs: 0,
        sourceEndUs: 5 * second,
    });
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, false);
    assert.ok(plan.diagnostics.some((item) => item.code === 'ANGLE_COVERAGE_INCOMPLETE' && item.cutId === 'cut-b'));
});

test('reports a missing golf block as a structured error', () => {
    const project = multicamProject({ project: { blocks: [] } });
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, false);
    assert.ok(plan.diagnostics.some((item) => item.code === 'BLOCK_MISSING' && item.sequenceId === 'moment-1'));
});

test('requires a binding when a tracer crosses more than one final camera cut', () => {
    const project = multicamProject();
    project.shotTracers = [{ id: 'legacy-tracer', sequenceId: 'moment-1', enabled: true, startUs: 0, endUs: 9 * second, points: [] }];
    const plan = compileRenderPlan(project, ['moment-1']);
    assert.equal(plan.valid, false);
    assert.ok(plan.diagnostics.some((item) => item.code === 'TRACER_BINDING_REQUIRED'));
    assert.deepEqual(plan.tracerPlacements, []);
});
