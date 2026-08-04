import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it, mock } from 'node:test';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import {
    createMediaChooseHandler,
    createMediaEngineDiagnostics,
    diagnoseBinary,
    packagedDependencyPath,
    publicMediaEngineStatus,
    resolveMediaEnginePaths,
    validLocalBinaryPath,
    validateDiagnosticsForce,
} from './media-engine.js';

const ffmpegPath = path.resolve('fixtures', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const ffprobePath = path.resolve('fixtures', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
const regularFile = async () => ({ isFile: () => true });

function successfulRun(filePath, args) {
    const kind = filePath.toLowerCase().includes('ffprobe') ? 'ffprobe' : 'ffmpeg';
    if (args.includes('-encoders')) return Promise.resolve({ stdout: ' V..... libx264 H.264 encoder\n' });
    return Promise.resolve({ stdout: `${kind} version 6.1.1-test Copyright\n` });
}

describe('media engine path resolution', () => {
    it('uses explicit overrides only during development', () => {
        const development = resolveMediaEnginePaths({
            isPackaged: false,
            resourcesPath: path.resolve('resources'),
            environment: { FFMPEG_PATH: ffmpegPath },
            ffmpegPackagePath: path.resolve('node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
            ffprobePackagePath: ffprobePath,
        });
        assert.equal(development.ffmpeg.path, ffmpegPath);
        assert.equal(development.ffmpeg.source, 'environment');

        const packaged = resolveMediaEnginePaths({
            isPackaged: true,
            resourcesPath: path.resolve('resources'),
            environment: { FFMPEG_PATH: path.resolve('untrusted-ffmpeg.exe'), FFPROBE_PATH: path.resolve('untrusted-ffprobe.exe') },
            ffmpegPackagePath: path.resolve('app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
            ffprobePackagePath: path.resolve('app.asar', 'node_modules', '@ffprobe-installer', 'win32-x64', 'ffprobe.exe'),
        });
        assert.match(packaged.ffmpeg.path, /app\.asar\.unpacked[\\/]node_modules[\\/]ffmpeg-static/);
        assert.match(packaged.ffprobe.path, /app\.asar\.unpacked[\\/]node_modules[\\/]@ffprobe-installer/);
        assert.doesNotMatch(packaged.ffmpeg.path, /untrusted/);
        assert.doesNotMatch(packaged.ffprobe.path, /untrusted/);
    });

    it('derives a deterministic unpacked dependency path', () => {
        const result = packagedDependencyPath(
            path.resolve('resources', 'app.asar', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe'),
            path.resolve('resources'),
        );
        assert.match(result, /app\.asar\.unpacked[\\/]node_modules[\\/]ffmpeg-static[\\/]ffmpeg\.exe$/);
    });

    it('rejects UNC and device namespaces in slash and backslash notation', () => {
        assert.equal(validLocalBinaryPath(ffmpegPath), true);
        const unsafePaths = [
            '\\\\server\\share\\ffmpeg.exe',
            '//server/share/ffmpeg.exe',
            '\\\\?\\C:\\tools\\ffmpeg.exe',
            '//?/C:/tools/ffmpeg.exe',
            '\\\\.\\C:\\tools\\ffmpeg.exe',
            '//./C:/tools/ffmpeg.exe',
            '\\/server/share/ffmpeg.exe',
            '/\\server\\share\\ffmpeg.exe',
        ];
        unsafePaths.forEach((unsafePath) => assert.equal(validLocalBinaryPath(unsafePath), false, unsafePath));
    });

    it('validates the retry flag narrowly', () => {
        assert.equal(validateDiagnosticsForce(undefined), false);
        assert.equal(validateDiagnosticsForce(false), false);
        assert.equal(validateDiagnosticsForce(true), true);
        for (const invalid of [null, 1, 0, 'true', {}, []]) {
            assert.throws(() => validateDiagnosticsForce(invalid), /Boolean/);
        }
    });
});

describe('media choose preflight', () => {
    it('checks FFprobe before opening the file dialog', async () => {
        const order = [];
        const choose = createMediaChooseHandler({
            ensureFfprobe: async () => { order.push('preflight'); },
            chooseFiles: async () => { order.push('dialog'); return { canceled: false, filePaths: [ffprobePath] }; },
            probeFiles: async () => { order.push('probe'); return ['media']; },
        });
        assert.deepEqual(await choose(), ['media']);
        assert.deepEqual(order, ['preflight', 'dialog', 'probe']);
    });

    it('never opens the file dialog when the FFprobe preflight fails', async () => {
        const chooseFiles = mock.fn(async () => ({ canceled: true, filePaths: [] }));
        const choose = createMediaChooseHandler({
            ensureFfprobe: async () => { throw new Error('FFprobe fehlt'); },
            chooseFiles,
            probeFiles: async () => [],
        });
        await assert.rejects(() => choose(), /FFprobe fehlt/);
        assert.equal(chooseFiles.mock.callCount(), 0);
    });
});

describe('media engine diagnostics', () => {
    it('recognizes the binaries installed with the application', async () => {
        const ffmpeg = await diagnoseBinary('ffmpeg', { path: ffmpegStatic, source: 'bundled' });
        const ffprobe = await diagnoseBinary('ffprobe', { path: ffprobeInstaller.path, source: 'bundled' });
        assert.equal(ffmpeg.state, 'ready', ffmpeg.detail);
        assert.equal(ffprobe.state, 'ready', ffprobe.detail);
    });

    it('detects versions and the required H.264 encoder', async () => {
        const ffmpeg = await diagnoseBinary('ffmpeg', { path: ffmpegPath, source: 'bundled' }, { stat: regularFile, run: successfulRun });
        const ffprobe = await diagnoseBinary('ffprobe', { path: ffprobePath, source: 'bundled' }, { stat: regularFile, run: successfulRun });
        assert.equal(ffmpeg.state, 'ready');
        assert.equal(ffmpeg.version, '6.1.1-test');
        assert.equal(ffprobe.state, 'ready');
    });

    it('uses fixed argument arrays and never enables a shell', async () => {
        const calls = [];
        const run = async (filePath, args, options) => {
            calls.push({ filePath, args, options });
            return successfulRun(filePath, args);
        };
        await diagnoseBinary('ffmpeg', { path: ffmpegPath, source: 'bundled' }, { stat: regularFile, run });
        assert.deepEqual(calls.map((call) => call.args), [['-version'], ['-hide_banner', '-encoders']]);
        assert.ok(calls.every((call) => Array.isArray(call.args) && call.options.shell === false));
    });

    it('classifies missing and non-executable files', async () => {
        const missing = await diagnoseBinary('ffmpeg', { path: ffmpegPath, source: 'bundled' }, { stat: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } });
        const blocked = await diagnoseBinary('ffprobe', { path: ffprobePath, source: 'bundled' }, { stat: async () => { const error = new Error('blocked'); error.code = 'EACCES'; throw error; } });
        assert.equal(missing.state, 'missing');
        assert.equal(blocked.state, 'not-executable');
        assert.match(blocked.message, /Virenschutz/);
    });

    it('rejects the wrong binary and incompatible FFmpeg builds', async () => {
        const wrong = await diagnoseBinary('ffprobe', { path: ffprobePath, source: 'bundled' }, { stat: regularFile, run: async () => ({ stdout: 'not ffprobe' }) });
        const incompatible = await diagnoseBinary('ffmpeg', { path: ffmpegPath, source: 'bundled' }, {
            stat: regularFile,
            run: async (_filePath, args) => ({ stdout: args.includes('-encoders') ? ' V..... mpeg4 encoder\n' : 'ffmpeg version 6.1.1\n' }),
        });
        assert.equal(wrong.state, 'wrong-binary');
        assert.equal(incompatible.state, 'incompatible');
    });

    it('classifies timeouts and execution errors', async () => {
        const timedOut = await diagnoseBinary('ffprobe', { path: ffprobePath, source: 'bundled' }, { stat: regularFile, run: async () => { const error = new Error('timeout'); error.killed = true; throw error; } });
        const failed = await diagnoseBinary('ffprobe', { path: ffprobePath, source: 'bundled' }, { stat: regularFile, run: async () => { const error = new Error('failed'); error.code = 2; throw error; } });
        assert.equal(timedOut.state, 'timed-out');
        assert.equal(failed.state, 'failed');
    });

    it('caches successful checks and throws an actionable preflight error', async () => {
        const run = mock.fn(successfulRun);
        const engine = createMediaEngineDiagnostics({
            ffmpeg: { path: ffmpegPath, source: 'bundled' },
            ffprobe: { path: ffprobePath, source: 'bundled' },
        }, { stat: regularFile, run });
        await engine.status();
        await engine.status();
        assert.equal(run.mock.callCount(), 3);

        const broken = createMediaEngineDiagnostics({
            ffmpeg: { path: ffmpegPath, source: 'bundled' },
            ffprobe: { path: ffprobePath, source: 'bundled' },
        }, { stat: async () => { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } });
        await assert.rejects(() => broken.require('ffprobe'), /Installiere Golf Studio erneut/);
    });

    it('keeps a cached failure until a forced retry recovers', async () => {
        let filesAvailable = false;
        const stat = async () => {
            if (!filesAvailable) {
                const error = new Error('missing');
                error.code = 'ENOENT';
                throw error;
            }
            return { isFile: () => true };
        };
        const engine = createMediaEngineDiagnostics({
            ffmpeg: { path: ffmpegPath, source: 'bundled' },
            ffprobe: { path: ffprobePath, source: 'bundled' },
        }, { stat, run: successfulRun });
        assert.equal((await engine.status()).ready, false);
        filesAvailable = true;
        assert.equal((await engine.status()).ready, false);
        const recovered = await engine.status(true);
        assert.equal(recovered.ready, true);
        assert.equal(recovered.ffmpeg.state, 'ready');
        assert.equal(recovered.ffprobe.state, 'ready');
    });

    it('does not expose internal binary paths to the renderer', async () => {
        const engine = createMediaEngineDiagnostics({
            ffmpeg: { path: ffmpegPath, source: 'bundled' },
            ffprobe: { path: ffprobePath, source: 'bundled' },
        }, { stat: regularFile, run: successfulRun });
        const status = publicMediaEngineStatus(await engine.status());
        assert.equal(status.ready, true);
        assert.equal('path' in status.ffmpeg, false);
        assert.equal('path' in status.ffprobe, false);
        assert.doesNotMatch(JSON.stringify(status), new RegExp(ffmpegPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        assert.doesNotMatch(JSON.stringify(status), new RegExp(ffprobePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
        assert.equal(status.ffmpeg.version, '6.1.1-test');
    });
});
