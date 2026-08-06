import { compileRenderPlan } from '../shared/render-plan.mjs';

export class RenderPlanExportError extends Error {
    constructor(diagnostics) {
        const first = diagnostics.find((item) => item.severity === 'error');
        super(first?.message ?? 'Der kanonische Renderplan ist nicht exportierbar.');
        this.name = 'RenderPlanExportError';
        this.diagnostics = diagnostics;
    }
}

export function prepareRenderPlanExport(project, sequenceIds) {
    const plan = compileRenderPlan(project, sequenceIds);
    if (!plan.valid) throw new RenderPlanExportError(plan.diagnostics);
    const mediaById = new Map(project.media.map((media) => [media.id, media]));
    const sequenceById = new Map(project.sequences.map((sequence) => [sequence.id, sequence]));
    const blockById = new Map(project.blocks.map((block) => [block.id, block]));
    const videoSegments = plan.videoSegments.map((segment, inputIndex) => ({
        ...segment,
        inputIndex,
        media: mediaById.get(segment.mediaId),
        sequence: sequenceById.get(segment.sequenceId),
        block: blockById.get(segment.blockId),
        tracerPlacements: plan.tracerPlacements.filter((placement) => placement.cutId === segment.cutId && placement.sequenceId === segment.sequenceId),
    }));
    const audioSegments = plan.audioSegments.map((segment, audioIndex) => ({
        ...segment,
        inputIndex: videoSegments.length + audioIndex,
        media: mediaById.get(segment.mediaId),
    }));
    const videoById = new Map(videoSegments.map((segment) => [segment.id, segment]));
    const audioById = new Map(audioSegments.map((segment) => [segment.id, segment]));
    const moments = plan.moments.map((moment) => ({
        ...moment,
        sequence: sequenceById.get(moment.sequenceId),
        block: blockById.get(moment.blockId),
        videoSegments: moment.videoSegmentIds.map((id) => videoById.get(id)),
        audioSegments: moment.audioSegmentIds.map((id) => audioById.get(id)),
    }));
    return { plan, moments, videoSegments, audioSegments };
}
