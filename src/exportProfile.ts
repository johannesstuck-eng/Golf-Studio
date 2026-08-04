import type { ExportProfileId, GolfProject, MediaItem, VirtualSequence } from './types';

export interface ExportSummary {
    sequenceCount: number;
    durationSeconds: number;
    width: number;
    height: number;
    fps: number;
    sourceCodecs: string[];
    bitDepth: number;
    container: 'MP4' | 'MOV' | 'MKV';
    videoCodec: 'H.264' | 'H.265/HEVC' | 'ProRes 422 HQ' | 'FFV1 Lossless';
    qualityLabel: string;
}

function mediaForSequence(project: GolfProject, sequence: VirtualSequence): MediaItem | undefined {
    if (sequence.sourceType === 'media') return project.media.find((media) => media.id === sequence.sourceId);
    const group = project.groups.find((candidate) => candidate.id === sequence.sourceId);
    return project.media.find((media) => group?.mediaIds.includes(media.id) && media.kind === 'video')
        ?? project.media.find((media) => group?.mediaIds.includes(media.id));
}

export function buildExportSummary(project: GolfProject, sequenceIds: string[], profile: ExportProfileId): ExportSummary {
    const sequences = sequenceIds
        .map((id) => project.sequences.find((sequence) => sequence.id === id))
        .filter((sequence): sequence is VirtualSequence => Boolean(sequence));
    const media = sequences.map((sequence) => mediaForSequence(project, sequence)).filter((item): item is MediaItem => Boolean(item));
    const video = media.filter((item) => item.kind === 'video');
    const codecs = [...new Set(video.map((item) => item.codec.toLowerCase()))];
    const width = Math.max(2, ...video.map((item) => item.width ?? 0));
    const height = Math.max(2, ...video.map((item) => item.height ?? 0));
    const fps = Math.max(1, ...video.map((item) => item.fps ?? project.settings.frameRate ?? 30));
    const bitDepth = Math.max(8, ...video.map((item) => item.bitDepth ?? 8));
    const firstExtension = video[0]?.path.split('.').at(-1)?.toLowerCase();
    let container: ExportSummary['container'] = 'MOV';
    let videoCodec: ExportSummary['videoCodec'] = 'ProRes 422 HQ';
    let qualityLabel = 'Quellauflösung · schnittfester Master';

    if (profile === 'lossless-master' || bitDepth > 10) {
        container = 'MKV';
        videoCodec = 'FFV1 Lossless';
        qualityLabel = profile === 'lossless-master' ? 'Mathematisch verlustfrei · sehr große Datei' : 'Automatisch verlustfrei · Quellmaterial über 10 Bit';
    } else if (codecs.length === 1 && codecs[0] === 'h264') {
        container = firstExtension === 'mov' ? 'MOV' : firstExtension === 'mkv' ? 'MKV' : 'MP4';
        videoCodec = 'H.264';
        qualityLabel = 'Quellauflösung · visuell verlustfrei (CRF 10)';
    } else if (codecs.length === 1 && ['hevc', 'h265'].includes(codecs[0])) {
        container = firstExtension === 'mov' ? 'MOV' : 'MP4';
        videoCodec = 'H.265/HEVC';
        qualityLabel = 'Quellauflösung · visuell verlustfrei (CRF 12)';
    }

    return {
        sequenceCount: sequences.length,
        durationSeconds: sequences.reduce((total, sequence) => total + Math.max(0, sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0),
        width,
        height,
        fps,
        sourceCodecs: codecs,
        bitDepth,
        container,
        videoCodec,
        qualityLabel,
    };
}
