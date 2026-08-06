import type { ExportProfileId, GolfProject, MediaItem } from './types';
import { compileRenderPlan } from './renderPlan';
import type { RenderDiagnostic } from './renderPlan';

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
    renderFingerprint: string;
    valid: boolean;
    diagnostics: RenderDiagnostic[];
}

export function buildExportSummary(project: GolfProject, sequenceIds: string[], profile: ExportProfileId): ExportSummary {
    const plan = compileRenderPlan(project, sequenceIds);
    const selectedMediaIds = new Set(plan.videoSegments.map((segment) => segment.mediaId));
    const media = project.media.filter((item): item is MediaItem => selectedMediaIds.has(item.id));
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
        sequenceCount: plan.moments.length,
        durationSeconds: plan.totalDurationUs / 1_000_000,
        width,
        height,
        fps,
        sourceCodecs: codecs,
        bitDepth,
        container,
        videoCodec,
        qualityLabel,
        renderFingerprint: plan.renderFingerprint,
        valid: plan.valid,
        diagnostics: plan.diagnostics,
    };
}
