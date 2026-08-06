import { describe, expect, it } from 'vitest';
import { createProject, roughCutSequenceIds, upsertSequence } from './model';
import { buildExportSummary } from './exportProfile';
import type { GolfProject, MediaItem } from './types';

function projectWith(codec: string, extension: string, bitDepth = 8): GolfProject {
    let project = createProject({ id: 'project', course: 'Testplatz', holes: 9, players: [{ id: 'p1', name: 'Jo' }], name: 'Test', createdAt: new Date(0).toISOString() });
    const media: MediaItem = {
        id: 'm1', path: `C:\\Clips\\shot.${extension}`, name: `shot.${extension}`, kind: 'video', device: 'Kamera', deviceKey: 'cam', recordedAt: new Date(0).toISOString(),
        durationSeconds: 10, width: 3840, height: 2160, fps: 60, codec, audioCodec: 'aac', hasAudio: true, sizeBytes: 1, bitDepth,
    };
    project = { ...project, media: [media] };
    return upsertSequence(project, { sourceType: 'media', sourceId: media.id, inFrame: 0, outFrame: 600, sourceFps: 60, hole: 1, playerId: 'p1', blockType: 'tee-shot' });
}

describe('buildExportSummary', () => {
    it('keeps H.264 source dimensions, frame rate and MP4 container', () => {
        const project = projectWith('h264', 'mp4');
        expect(buildExportSummary(project, roughCutSequenceIds(project), 'source-matched')).toMatchObject({ width: 3840, height: 2160, fps: 60, container: 'MP4', videoCodec: 'H.264', bitDepth: 8 });
    });

    it('offers a genuinely lossless FFV1 master', () => {
        const project = projectWith('hevc', 'mov', 10);
        expect(buildExportSummary(project, roughCutSequenceIds(project), 'lossless-master')).toMatchObject({ container: 'MKV', videoCodec: 'FFV1 Lossless', bitDepth: 10 });
    });

    it('uses ProRes for mixed source codecs', () => {
        const project = projectWith('h264', 'mp4');
        project.media.push({ ...project.media[0], id: 'm2', path: 'C:\\Clips\\shot2.mov', codec: 'hevc' });
        const second = upsertSequence(project, { sourceType: 'media', sourceId: 'm2', inFrame: 0, outFrame: 60, sourceFps: 60, hole: 1, playerId: 'p1', blockType: 'approach' });
        expect(buildExportSummary(second, roughCutSequenceIds(second), 'source-matched')).toMatchObject({ container: 'MOV', videoCodec: 'ProRes 422 HQ' });
    });

    it('does not reduce sources above 10-bit', () => {
        const project = projectWith('hevc', 'mov', 12);
        expect(buildExportSummary(project, roughCutSequenceIds(project), 'source-matched')).toMatchObject({ container: 'MKV', videoCodec: 'FFV1 Lossless', bitDepth: 12 });
    });

    it('summarizes only cameras committed to the canonical render plan', () => {
        const project = projectWith('h264', 'mp4');
        project.media.push({ ...project.media[0], id: 'm2', path: 'C:\\Clips\\unused.mov', codec: 'hevc' });
        const summary = buildExportSummary(project, roughCutSequenceIds(project), 'source-matched');
        expect(summary).toMatchObject({ valid: true, sourceCodecs: ['h264'], durationSeconds: 10 });
        expect(summary.renderFingerprint).toMatch(/^rp1-/);
    });

    it('exposes blocking render diagnostics instead of pretending export is ready', () => {
        const project = projectWith('h264', 'mp4');
        project.sequences[0].videoCuts = [];
        const summary = buildExportSummary(project, roughCutSequenceIds(project), 'source-matched');
        expect(summary.valid).toBe(false);
        expect(summary.diagnostics.some((item) => item.code === 'VIDEO_CUTS_EMPTY')).toBe(true);
    });
});
