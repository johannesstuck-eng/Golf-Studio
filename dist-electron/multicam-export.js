export function exportMediaForSequence(project, sequence) {
    if (sequence.sourceType === 'media')
        return project.media.find((media) => media.id === sequence.sourceId) ?? null;
    const group = project.groups.find((item) => item.id === sequence.sourceId);
    return project.media.find((media) => media.id === sequence.activeMediaId && group?.mediaIds.includes(media.id) && media.kind === 'video')
        ?? project.media.find((media) => group?.mediaIds.includes(media.id) && media.kind === 'video')
        ?? project.media.find((media) => group?.mediaIds.includes(media.id)) ?? null;
}

export function exportRangeForSequence(sequence, media) {
    const angle = sequence.sourceType === 'group'
        ? sequence.multicamAngles?.find((item) => item.mediaId === media.id)
        : null;
    return angle ?? { inFrame: sequence.inFrame, outFrame: sequence.outFrame, sourceFps: sequence.sourceFps };
}
