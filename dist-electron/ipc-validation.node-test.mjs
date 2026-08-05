import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { assertMediaFilesAreReadable, isTrustedAppUrl, validateExportRequest, validateProbePaths } from './ipc-validation.js';

const fixturePath = process.platform === 'win32' ? 'C:\\video\\round.mp4' : '/video/round.mp4';

function projectFixture() {
    return {
        schemaVersion: 7,
        settings: { course: 'Testplatz', holes: 9, frameRate: 30, players: [{ id: 'player-1', name: 'Alex' }] },
        media: [{ id: 'media-1', path: fixturePath, name: 'round.mp4', kind: 'video', durationSeconds: 10, width: 1920, height: 1080, fps: 30, codec: 'h264', hasAudio: true, sizeBytes: 1024, bitDepth: 8 }],
        groups: [],
        blocks: [{ id: 'block-1', hole: 1, playerId: 'player-1', type: 'tee-shot', label: 'Tee Shot', order: 0, sequenceIds: ['sequence-1'], details: { shotNumber: 1, club: 'Driver', distanceMeters: 200, result: 'Fairway' } }],
        sequences: [{ id: 'sequence-1', sourceType: 'media', sourceId: 'media-1', inFrame: 0, outFrame: 300, sourceFps: 30, targetBlockId: 'block-1' }],
        overlays: [],
        shotTracers: [],
        courseData: { holes: [{ number: 1, par: 4, lengthMeters: 350 }] },
        playerScores: [],
    };
}

describe('IPC validation', () => {
    it('accepts a bounded, internally consistent export request', () => {
        const request = { project: projectFixture(), sequenceIds: ['sequence-1'], profile: 'source-matched' };
        assert.equal(validateExportRequest(request), request);
    });

    it('rejects non-local media paths and unsupported extensions', () => {
        assert.throws(() => validateProbePaths(['https://example.test/video.mp4']), /lokaler Dateipfad/);
        const badPath = process.platform === 'win32' ? 'C:\\video\\payload.txt' : '/video/payload.txt';
        assert.throws(() => validateProbePaths([badPath]), /Medienformat/);
        if (process.platform === 'win32') assert.throws(() => validateProbePaths(['\\\\server\\share\\video.mp4']), /lokaler Dateipfad/);
    });

    it('rejects malformed numeric data before it can reach FFmpeg', () => {
        const project = projectFixture();
        project.sequences[0].sourceFps = Number.NaN;
        assert.throws(() => validateExportRequest({ project, sequenceIds: ['sequence-1'], profile: 'source-matched' }), /sourceFps/);
    });

    it('rejects broken project references', () => {
        const project = projectFixture();
        project.sequences[0].sourceId = 'missing-media';
        assert.throws(() => validateExportRequest({ project, sequenceIds: ['sequence-1'], profile: 'source-matched' }), /Unbekannte Quelle/);
    });

    it('validates multicam angles against their group', () => {
        const project = projectFixture();
        project.groups = [{ id: 'group-1', mediaIds: ['media-1'] }];
        project.sequences[0] = { ...project.sequences[0], sourceType: 'group', sourceId: 'group-1', activeMediaId: 'media-1', multicamAngles: [{ mediaId: 'media-1', inFrame: 0, outFrame: 300, sourceFps: 30 }] };
        assert.doesNotThrow(() => validateExportRequest({ project, sequenceIds: ['sequence-1'], profile: 'source-matched' }));
        project.sequences[0].multicamAngles[0].mediaId = 'foreign-camera';
        assert.throws(() => validateExportRequest({ project, sequenceIds: ['sequence-1'], profile: 'source-matched' }), /Multicam-Gruppe/);
    });

    it('checks that selected input paths resolve to regular files', async () => {
        const stat = mock.fn(async () => ({ isFile: () => false }));
        await assert.rejects(assertMediaFilesAreReadable(projectFixture(), stat), /keine Datei/);
    });

    it('allows only the packaged page or the configured local development origin', () => {
        const production = 'file:///C:/app/dist/index.html';
        assert.equal(isTrustedAppUrl(production, production), true);
        assert.equal(isTrustedAppUrl('https://evil.example/', production, 'http://localhost:5173'), false);
        assert.equal(isTrustedAppUrl('http://localhost:5173/editor', production, 'http://localhost:5173'), true);
        assert.equal(isTrustedAppUrl('https://attacker.example/', production, 'https://attacker.example'), false);
    });
});
