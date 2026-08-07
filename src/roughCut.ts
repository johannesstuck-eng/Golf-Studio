import type { GolfProject, MediaItem, MulticamAngle, VirtualSequence } from './types';
import { compileRenderPlan } from './renderPlan';
import type { RenderPlan } from './renderPlan';

export interface SequencePlaybackSource {
    media: MediaItem;
    range: MulticamAngle;
    cutId: string;
    momentStartSeconds: number;
    momentEndSeconds: number;
}

export interface SequencePlaybackAudioSource {
    media: MediaItem;
    audioCutId: string;
    sourceStartSeconds: number;
    sourceEndSeconds: number;
    momentStartSeconds: number;
    momentEndSeconds: number;
    gainDb: number;
}

/** Switch on the last valid frame so a coarse timeupdate cannot show frames beyond a camera cut. */
export function shouldAdvanceVideoCut(mediaTime: number, outFrame: number, sourceFps: number): boolean {
    if (!Number.isFinite(mediaTime) || !Number.isFinite(outFrame) || !Number.isFinite(sourceFps) || sourceFps <= 0) return false;
    const lastFrameStart = Math.max(0, (outFrame - 1) / sourceFps);
    return mediaTime >= lastFrameStart - .0005;
}

export function sequencePlaybackSource(project: GolfProject, sequence: VirtualSequence, momentSeconds = 0, renderPlan?: RenderPlan): SequencePlaybackSource | null {
    const plan = renderPlan ?? compileRenderPlan(project, [sequence.id]);
    const momentUs = Math.max(0, Math.round(momentSeconds * 1_000_000));
    const sequenceDurationUs = Math.round((sequence.outFrame - sequence.inFrame) / sequence.sourceFps * 1_000_000);
    const segment = plan.videoSegments.find((item) => item.sequenceId === sequence.id && momentUs >= item.startUs && momentUs < item.endUs)
        ?? (momentUs === sequenceDurationUs ? plan.videoSegments.filter((item) => item.sequenceId === sequence.id).at(-1) : undefined);
    if (!segment) return null;
    const media = project.media.find((item) => item.id === segment.mediaId);
    if (!media) return null;
    const sourceFps = segment.sourceFps ?? media.fps ?? sequence.sourceFps;
    return {
        media,
        cutId: segment.cutId,
        momentStartSeconds: segment.startUs / 1_000_000,
        momentEndSeconds: segment.endUs / 1_000_000,
        range: {
            mediaId: media.id,
            inFrame: segment.sourceStartUs / 1_000_000 * sourceFps,
            outFrame: segment.sourceEndUs / 1_000_000 * sourceFps,
            sourceFps,
        },
    };
}

export function sequencePlaybackAudioSource(project: GolfProject, sequence: VirtualSequence, momentSeconds = 0, renderPlan?: RenderPlan): SequencePlaybackAudioSource | null {
    const plan = renderPlan ?? compileRenderPlan(project, [sequence.id]);
    const momentUs = Math.max(0, Math.round(momentSeconds * 1_000_000));
    const sequenceDurationUs = Math.round((sequence.outFrame - sequence.inFrame) / sequence.sourceFps * 1_000_000);
    const segment = plan.audioSegments.find((item) => item.sequenceId === sequence.id && momentUs >= item.startUs && momentUs < item.endUs)
        ?? (momentUs === sequenceDurationUs ? plan.audioSegments.filter((item) => item.sequenceId === sequence.id).at(-1) : undefined);
    if (!segment) return null;
    const media = project.media.find((item) => item.id === segment.mediaId);
    return media ? {
        media,
        audioCutId: segment.audioCutId,
        sourceStartSeconds: segment.sourceStartUs / 1_000_000,
        sourceEndSeconds: segment.sourceEndUs / 1_000_000,
        momentStartSeconds: segment.startUs / 1_000_000,
        momentEndSeconds: segment.endUs / 1_000_000,
        gainDb: segment.gainDb,
    } : null;
}

export function sequencePreviewSource(project: GolfProject, sequence: VirtualSequence, mediaId: string): SequencePlaybackSource | null {
    if (sequence.sourceType !== 'group') return null;
    const group = project.groups.find((item) => item.id === sequence.sourceId);
    const angle = sequence.multicamAngles?.find((item) => item.mediaId === mediaId);
    const media = project.media.find((item) => item.id === mediaId && item.kind === 'video');
    if (!group?.mediaIds.includes(mediaId) || !angle || !media) return null;
    return {
        media,
        range: angle,
        cutId: `preview-${mediaId}`,
        momentStartSeconds: 0,
        momentEndSeconds: (sequence.outFrame - sequence.inFrame) / sequence.sourceFps,
    };
}
