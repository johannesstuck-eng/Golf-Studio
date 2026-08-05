import type { GolfProject, MediaItem, MulticamAngle, VirtualSequence } from './types';

export interface SequencePlaybackSource {
    media: MediaItem;
    range: MulticamAngle;
}

export function sequencePlaybackSource(project: GolfProject, sequence: VirtualSequence): SequencePlaybackSource | null {
    if (sequence.sourceType === 'media') {
        const media = project.media.find((item) => item.id === sequence.sourceId);
        return media ? { media, range: { mediaId: media.id, inFrame: sequence.inFrame, outFrame: sequence.outFrame, sourceFps: sequence.sourceFps } } : null;
    }
    const group = project.groups.find((item) => item.id === sequence.sourceId);
    const angle = sequence.multicamAngles?.find((item) => item.mediaId === sequence.activeMediaId) ?? sequence.multicamAngles?.[0];
    const media = project.media.find((item) => item.id === (angle?.mediaId ?? sequence.activeMediaId) && group?.mediaIds.includes(item.id) && item.kind === 'video')
        ?? project.media.find((item) => group?.mediaIds.includes(item.id) && item.kind === 'video')
        ?? project.media.find((item) => group?.mediaIds.includes(item.id));
    return media ? { media, range: angle ?? { mediaId: media.id, inFrame: sequence.inFrame, outFrame: sequence.outFrame, sourceFps: sequence.sourceFps } } : null;
}
