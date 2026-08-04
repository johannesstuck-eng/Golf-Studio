import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const binaryLabels = { ffmpeg: 'FFmpeg', ffprobe: 'FFprobe' };

export class MediaEngineError extends Error {
    constructor(diagnostic) {
        super(diagnostic.message);
        this.name = 'MediaEngineError';
        this.code = diagnostic.state;
        this.component = diagnostic.kind;
    }
}

export function packagedDependencyPath(packagePath, resourcesPath) {
    if (typeof packagePath !== 'string' || !packagePath) {
        throw new Error('Paketpfad fehlt.');
    }
    const marker = `${path.sep}node_modules${path.sep}`;
    const markerIndex = packagePath.toLowerCase().lastIndexOf(marker.toLowerCase());
    if (markerIndex < 0) {
        throw new Error('Paketpfad enthält kein node_modules-Segment.');
    }
    const dependencyPath = packagePath.slice(markerIndex + path.sep.length);
    return path.join(resourcesPath, 'app.asar.unpacked', dependencyPath);
}

function developmentPath(kind, environment, packagePath) {
    const override = environment[kind === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
    return override ? { path: override, source: 'environment' } : { path: packagePath, source: 'bundled' };
}

export function resolveMediaEnginePaths({ isPackaged, resourcesPath, environment = {}, ffmpegPackagePath, ffprobePackagePath }) {
    if (!isPackaged) {
        return {
            ffmpeg: developmentPath('ffmpeg', environment, ffmpegPackagePath),
            ffprobe: developmentPath('ffprobe', environment, ffprobePackagePath),
        };
    }
    return {
        ffmpeg: { path: packagedDependencyPath(ffmpegPackagePath, resourcesPath), source: 'bundled' },
        ffprobe: { path: packagedDependencyPath(ffprobePackagePath, resourcesPath), source: 'bundled' },
    };
}

function failure(kind, binaryPath, source, state, detail) {
    const label = binaryLabels[kind];
    const messages = {
        missing: `${label} fehlt. Installiere Golf Studio erneut.`,
        'not-executable': `${label} kann nicht gestartet werden. Prüfe die Quarantäne deines Virenschutzes und installiere Golf Studio erneut.`,
        'wrong-binary': `Die gefundene ${label}-Datei ist nicht die erwartete Komponente. Installiere Golf Studio erneut.`,
        incompatible: `${label} ist mit diesem Golf-Studio-Build nicht kompatibel. Installiere die aktuelle Golf-Studio-Version erneut.`,
        'timed-out': `${label} antwortet nicht. Starte Golf Studio neu und prüfe anschließend den Virenschutz.`,
        failed: `${label} konnte nicht geprüft werden. Starte Golf Studio neu oder installiere die App erneut.`,
    };
    return { kind, state, ready: false, path: binaryPath, source, message: messages[state], detail };
}

export function validLocalBinaryPath(binaryPath) {
    const separatorNormalized = typeof binaryPath === 'string' ? binaryPath.replaceAll('/', '\\') : '';
    const pathNormalized = separatorNormalized ? path.normalize(separatorNormalized).replaceAll('/', '\\') : '';
    return typeof binaryPath === 'string'
        && path.isAbsolute(binaryPath)
        && !separatorNormalized.startsWith('\\\\')
        && !pathNormalized.startsWith('\\\\')
        && !binaryPath.includes('\0');
}

export function validateDiagnosticsForce(value) {
    if (value === undefined) return false;
    if (typeof value !== 'boolean') throw new TypeError('force muss ein Boolean sein.');
    return value;
}

export function createMediaChooseHandler({ ensureFfprobe, chooseFiles, probeFiles }) {
    return async () => {
        await ensureFfprobe();
        const result = await chooseFiles();
        return result.canceled ? [] : probeFiles(result.filePaths);
    };
}

function executionFailure(kind, binaryPath, source, error) {
    if (error?.code === 'ENOENT') return failure(kind, binaryPath, source, 'missing', 'Datei wurde beim Start nicht gefunden.');
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return failure(kind, binaryPath, source, 'not-executable', 'Betriebssystem verweigert die Ausführung.');
    if (error?.killed || error?.code === 'ETIMEDOUT') return failure(kind, binaryPath, source, 'timed-out', 'Versionsprüfung hat das Zeitlimit überschritten.');
    return failure(kind, binaryPath, source, 'failed', `Versionsprüfung endete mit ${String(error?.code ?? 'unbekanntem Fehler')}.`);
}

export async function diagnoseBinary(kind, candidate, dependencies = {}) {
    const stat = dependencies.stat ?? ((filePath) => fs.stat(filePath));
    const run = dependencies.run ?? ((filePath, args, options) => execFileAsync(filePath, args, options));
    const binaryPath = candidate?.path;
    const source = candidate?.source ?? 'bundled';
    if (!validLocalBinaryPath(binaryPath)) {
        return failure(kind, binaryPath, source, 'missing', 'Kein absoluter lokaler Binärpfad vorhanden.');
    }
    try {
        const info = await stat(binaryPath);
        if (!info.isFile()) return failure(kind, binaryPath, source, 'missing', 'Pfad verweist nicht auf eine reguläre Datei.');
    } catch (error) {
        if (error?.code === 'EACCES' || error?.code === 'EPERM') {
            return failure(kind, binaryPath, source, 'not-executable', 'Datei kann nicht gelesen werden.');
        }
        return failure(kind, binaryPath, source, 'missing', 'Datei wurde nicht gefunden.');
    }

    let output;
    try {
        output = await run(binaryPath, ['-version'], {
            windowsHide: true,
            timeout: 5000,
            maxBuffer: 1024 * 1024,
            shell: false,
        });
    } catch (error) {
        return executionFailure(kind, binaryPath, source, error);
    }
    const stdout = String(output?.stdout ?? '');
    const identity = new RegExp(`^${kind} version\\s+([^\\s]+)`, 'i').exec(stdout.trim());
    if (!identity) return failure(kind, binaryPath, source, 'wrong-binary', 'Versionsausgabe hat eine unerwartete Identität.');

    if (kind === 'ffmpeg') {
        try {
            const encoders = await run(binaryPath, ['-hide_banner', '-encoders'], {
                windowsHide: true,
                timeout: 5000,
                maxBuffer: 4 * 1024 * 1024,
                shell: false,
            });
            if (!/(^|\s)libx264(\s|$)/m.test(String(encoders?.stdout ?? ''))) {
                return failure(kind, binaryPath, source, 'incompatible', 'Der für den MVP erforderliche libx264-Encoder fehlt.');
            }
        } catch (error) {
            return executionFailure(kind, binaryPath, source, error);
        }
    }
    return {
        kind,
        state: 'ready',
        ready: true,
        path: binaryPath,
        source,
        version: identity[1],
        message: `${binaryLabels[kind]} ${identity[1]} ist bereit.`,
    };
}

export function createMediaEngineDiagnostics(paths, dependencies = {}) {
    let cachedStatus;
    const status = async (force = false) => {
        if (!cachedStatus || force) {
            cachedStatus = Promise.all([
                diagnoseBinary('ffmpeg', paths.ffmpeg, dependencies),
                diagnoseBinary('ffprobe', paths.ffprobe, dependencies),
            ]).then(([ffmpeg, ffprobe]) => ({ ready: ffmpeg.ready && ffprobe.ready, ffmpeg, ffprobe }));
        }
        return cachedStatus;
    };
    return {
        status,
        async require(kind) {
            const diagnostic = (await status())[kind];
            if (!diagnostic.ready) throw new MediaEngineError(diagnostic);
            return diagnostic.path;
        },
    };
}

function publicBinaryStatus(diagnostic) {
    return {
        state: diagnostic.state,
        ready: diagnostic.ready,
        source: diagnostic.source,
        version: diagnostic.version,
        message: diagnostic.message,
    };
}

export function publicMediaEngineStatus(status) {
    return {
        ready: status.ready,
        ffmpeg: publicBinaryStatus(status.ffmpeg),
        ffprobe: publicBinaryStatus(status.ffprobe),
    };
}
