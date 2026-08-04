import { describe, expect, it } from 'vitest';
import { editorialTransition, scoreBeforeHole } from './editorialStyle';
import { createProject, upsertSequence, updatePlayerScore } from './model';
import type { GolfProject, MediaItem } from './types';

function fixture(): GolfProject {
    let project = createProject({ id: 'p', course: 'Pine Hills', holes: 9, players: [{ id: 'grant', name: 'Grant' }], name: 'Round', createdAt: new Date(0).toISOString(), frameRate: 60 });
    const media: MediaItem = { id: 'm', path: '/clips/a.mp4', name: 'a.mp4', kind: 'video', device: 'Cam', deviceKey: 'cam', recordedAt: new Date(0).toISOString(), durationSeconds: 30, width: 3840, height: 2160, fps: 60, codec: 'h264', audioCodec: 'aac', hasAudio: true, sizeBytes: 1 };
    project = { ...project, media: [media] };
    project = upsertSequence(project, { sourceType: 'media', sourceId: 'm', inFrame: 0, outFrame: 300, sourceFps: 60, hole: 1, playerId: 'grant', blockType: 'tee-shot' });
    project = upsertSequence(project, { sourceType: 'media', sourceId: 'm', inFrame: 300, outFrame: 600, sourceFps: 60, hole: 1, playerId: 'grant', blockType: 'approach' });
    return upsertSequence(project, { sourceType: 'media', sourceId: 'm', inFrame: 600, outFrame: 900, sourceFps: 60, hole: 2, playerId: 'grant', blockType: 'tee-shot' });
}

describe('fixed editorial style', () => {
    it('uses hard cuts within a hole', () => {
        const project = fixture();
        expect(editorialTransition(project, project.sequences[0].id, project.sequences[1].id)).toMatchObject({ kind: 'cut', dipSeconds: 0, cardSeconds: 0, audioFadeSeconds: 0.1 });
    });

    it('adds a fixed dip and card at a hole change', () => {
        const project = fixture();
        expect(editorialTransition(project, project.sequences[1].id, project.sequences[2].id)).toMatchObject({ kind: 'hole-change', nextHole: 2, cardSeconds: 1.8 });
    });

    it('shows the score entering the current hole', () => {
        let project = fixture();
        project = updatePlayerScore(project, 1, 'grant', 3);
        expect(scoreBeforeHole(project, 'grant', 2)).toBe('-1');
    });
});
