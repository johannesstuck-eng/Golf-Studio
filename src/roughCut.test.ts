import { describe, expect, it } from 'vitest';
import { createProject } from './model';
import { sequencePlaybackSource } from './roughCut';
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

        expect(sequencePlaybackSource(project, sequence)).toMatchObject({ media: { id: 'camera-b' }, range: { inFrame: 6125, outFrame: 6501 } });
    });
});
