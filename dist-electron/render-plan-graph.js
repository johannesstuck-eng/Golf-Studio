export function renderPlanInputArguments(prepared) {
    return [...prepared.videoSegments, ...prepared.audioSegments].flatMap((segment) => [
        '-ss', (segment.sourceStartUs / 1_000_000).toFixed(6),
        '-t', ((segment.sourceEndUs - segment.sourceStartUs) / 1_000_000).toFixed(6),
        '-i', segment.media.path,
    ]);
}

export function buildRenderPlanGraph(prepared, settings, hooks = {}) {
    const graph = [];
    const concatLabels = [];
    prepared.moments.forEach((moment, momentIndex) => {
        const previousBlock = prepared.moments[momentIndex - 1]?.block;
        const nextBlock = prepared.moments[momentIndex + 1]?.block;
        const startsHole = Boolean(previousBlock && previousBlock.hole !== moment.block.hole);
        const endsHole = Boolean(nextBlock && nextBlock.hole !== moment.block.hole);
        const momentVideoLabels = [];
        moment.videoSegments.forEach((segment, segmentIndex) => {
            const duration = (segment.endUs - segment.startUs) / 1_000_000;
            const label = `vs${momentIndex}_${segmentIndex}`;
            const customFilters = hooks.videoFilters?.({ segment, moment, momentIndex, segmentIndex, startsHole, endsHole, duration }) ?? [];
            graph.push([
                `[${segment.inputIndex}:v]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease:flags=lanczos`,
                `pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
                `fps=${settings.fps}`, 'setsar=1', 'setpts=PTS-STARTPTS', ...customFilters,
                `format=pix_fmts=${settings.pixelFormat}`,
            ].join(',') + `[${label}]`);
            momentVideoLabels.push(`[${label}]`);
        });
        if (momentVideoLabels.length === 1) graph.push(`${momentVideoLabels[0]}null[mv${momentIndex}]`);
        else graph.push(`${momentVideoLabels.join('')}concat=n=${momentVideoLabels.length}:v=1:a=0[mv${momentIndex}]`);

        const momentAudioLabels = [];
        moment.audioSegments.forEach((segment, segmentIndex) => {
            const duration = (segment.endUs - segment.startUs) / 1_000_000;
            const fade = Math.min(duration / 3, 6 / settings.fps);
            const label = `as${momentIndex}_${segmentIndex}`;
            const gain = Number.isFinite(segment.gainDb) ? `volume=${segment.gainDb.toFixed(2)}dB` : 'anull';
            graph.push(`[${segment.inputIndex}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS,${gain},afade=t=in:st=0:d=${fade.toFixed(6)},afade=t=out:st=${Math.max(0, duration - fade).toFixed(6)}:d=${fade.toFixed(6)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${label}]`);
            momentAudioLabels.push(`[${label}]`);
        });
        if (!momentAudioLabels.length) graph.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${(moment.durationUs / 1_000_000).toFixed(6)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ma${momentIndex}]`);
        else if (momentAudioLabels.length === 1) graph.push(`${momentAudioLabels[0]}anull[ma${momentIndex}]`);
        else graph.push(`${momentAudioLabels.join('')}concat=n=${momentAudioLabels.length}:v=0:a=1[ma${momentIndex}]`);
        concatLabels.push(`[mv${momentIndex}][ma${momentIndex}]`);
        if (endsHole && nextBlock && hooks.holeCard) {
            const videoLabel = `vh${momentIndex}`;
            const audioLabel = `ah${momentIndex}`;
            const card = hooks.holeCard({ nextBlock, videoLabel, audioLabel });
            graph.push(card.video, card.audio);
            concatLabels.push(`[${videoLabel}][${audioLabel}]`);
        }
    });
    graph.push(`${concatLabels.join('')}concat=n=${concatLabels.length}:v=1:a=1[vout][aout]`);
    return graph;
}
