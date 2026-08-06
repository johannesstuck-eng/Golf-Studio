import { describe, expect, it } from 'vitest';
import { createProject } from './model';
import { sequencePlaybackAudioSource, sequencePlaybackSource, sequencePreviewSource } from './roughCut';
import type { GolfProject, MediaItem, ProjectSettings, VirtualSequence } from './types';

const settings: ProjectSettings = { id: 'round', course: 'Test Range', holes: 9, players: [{ id: 'joe', name: 'Joe' }], name: 'Test Range', createdAt: '' };
const media = (id: string): MediaItem => ({ id, name: `${id}.mp4`, path: `${id}.mp4`, kind: 'video', device: id, deviceKey: id, recordedAt: '', durationSeconds: 300, width: 3840, height: 2160, fps: 59.94, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1 });

describe('rough cut multicam playback', () => {
    it('uses the selected camera and its synchronized local range', () => {
        const base = createProject(settings);
        const sequence: VirtualSequence = { id: 'shot', sourceType: 'group', sourceId: 'multicam', inFrame: 6752, outFrame: 7128, sourceFps: 59.94, activeMediaId: 'camera-b', multicamAngles: [
            { mediaId: 'camera-a', inFrame: 6752, outFrame: 7128, sourceFps: 59.94 },
            { mediaId: 'camera-b', inFrame: 6125, outFrame: 6501, sourceFps: 59.94 },
        ], targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '' };
        const project: GolfProject = { ...base, media: [media('camera-a'), media('camera-b')], groups: [{ id: 'multicam', name: 'Multicam', mediaIds: ['camera-a', 'camera-b'], createdAt: '', syncStatus: 'audio' }], sequences: [sequence] };

        const playback = sequencePlaybackSource(project, sequence);
        expect(playback).toMatchObject({ media: { id: 'camera-b' }, momentStartSeconds: 0 });
        expect(playback!.range.inFrame).toBeCloseTo(6125, 4);
        expect(playback!.range.outFrame).toBeCloseTo(6501, 4);
    });

    it('previews another synchronized camera without changing the committed cut', () => {
        const base = createProject(settings);
        const sequence: VirtualSequence = { id: 'shot', sourceType: 'group', sourceId: 'multicam', inFrame: 0, outFrame: 300, sourceFps: 30, activeMediaId: 'camera-a', multicamAngles: [
            { mediaId: 'camera-a', inFrame: 0, outFrame: 300, sourceFps: 30 },
            { mediaId: 'camera-b', inFrame: 30, outFrame: 330, sourceFps: 30 },
        ], videoCuts: [{ id: 'a', mediaId: 'camera-a', startUs: 0, endUs: 10_000_000, origin: 'manual' }], targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '' };
        const project: GolfProject = { ...base, media: [media('camera-a'), media('camera-b')], groups: [{ id: 'multicam', name: 'Multicam', mediaIds: ['camera-a', 'camera-b'], createdAt: '', syncStatus: 'audio' }], sequences: [sequence] };

        expect(sequencePreviewSource(project, sequence, 'camera-b')).toMatchObject({ media: { id: 'camera-b' }, cutId: 'preview-camera-b', momentStartSeconds: 0, momentEndSeconds: 10 });
        expect(project.sequences[0].videoCuts?.map((cut) => cut.mediaId)).toEqual(['camera-a']);
    });

    it('uses the committed camera cut at the requested moment without falling back', () => {
        const base = createProject(settings);
        const sequence: VirtualSequence = { id: 'shot', sourceType: 'group', sourceId: 'multicam', inFrame: 0, outFrame: 300, sourceFps: 30, activeMediaId: 'camera-a', multicamAngles: [
            { mediaId: 'camera-a', inFrame: 0, outFrame: 300, sourceFps: 30 },
            { mediaId: 'camera-b', inFrame: 30, outFrame: 330, sourceFps: 30 },
        ], videoCuts: [
            { id: 'a', mediaId: 'camera-a', startUs: 0, endUs: 2_000_000, origin: 'manual' },
            { id: 'b', mediaId: 'camera-b', startUs: 2_000_000, endUs: 8_000_000, origin: 'manual' },
            { id: 'a2', mediaId: 'camera-a', startUs: 8_000_000, endUs: 10_000_000, origin: 'manual' },
        ], targetBlockId: base.blocks[0].id, createdAt: '', updatedAt: '' };
        const project: GolfProject = { ...base, media: [media('camera-a'), media('camera-b')], groups: [{ id: 'multicam', name: 'Multicam', mediaIds: ['camera-a', 'camera-b'], createdAt: '', syncStatus: 'audio' }], sequences: [sequence] };

        expect(sequencePlaybackSource(project, sequence, 1)?.media.id).toBe('camera-a');
        expect(sequencePlaybackSource(project, sequence, 4)).toMatchObject({ media: { id: 'camera-b' }, cutId: 'b', momentStartSeconds: 2, momentEndSeconds: 8 });
        const withMasterAudio: GolfProject = { ...project, sequences: [{ ...sequence, audioPlan: { mediaId: 'camera-a', mode: 'master', offsetUs: 0, gainDb: 0, muted: false } }] };
        expect(sequencePlaybackAudioSource(withMasterAudio, withMasterAudio.sequences[0], 4)).toMatchObject({ media: { id: 'camera-a' }, momentStartSeconds: 0, momentEndSeconds: 10 });
        expect(sequencePlaybackSource(project, sequence, 9)?.media.id).toBe('camera-a');
        const unresolved = { ...sequence, videoCuts: [{ ...sequence.videoCuts![0], mediaId: null, endUs: 10_000_000 }] };
        expect(sequencePlaybackSource({ ...project, sequences: [unresolved] }, unresolved, 1)).toBeNull();
    });
});
