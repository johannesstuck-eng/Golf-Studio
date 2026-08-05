import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import ffprobeInstaller from '@ffprobe-installer/ffprobe';
import ffmpegStatic from 'ffmpeg-static';
import { assertMediaFilesAreReadable, IpcValidationError, isTrustedAppUrl, validateExportRequest, validateMulticamSyncRequest, validateProbePaths, validateProject } from './ipc-validation.js';
import { exportMediaForSequence, exportRangeForSequence } from './multicam-export.js';
import { compactWaveform, confidenceForScore, findAudioSyncOffset, pcm16Envelope } from './audio-sync.js';
const execFileAsync = promisify(execFile);
const mediaExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.wav', '.mp3', '.m4a', '.aac', '.flac']);
const audioExtensions = new Set(['.wav', '.mp3', '.m4a', '.aac', '.flac']);
function frameRate(value) {
    if (!value || value === '0/0')
        return null;
    const [numerator, denominator = 1] = value.split('/').map(Number);
    const result = numerator / denominator;
    return Number.isFinite(result) && result > 0 ? Math.round(result * 1000) / 1000 : null;
}
function firstTag(tags, keys) {
    for (const source of tags) {
        if (!source)
            continue;
        for (const key of keys) {
            if (source[key])
                return source[key];
            const found = Object.entries(source).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
            if (found?.[1])
                return found[1];
        }
    }
    return null;
}
function deviceDetails(filePath, data) {
    const tags = [data.format?.tags, ...(data.streams ?? []).map((stream) => stream.tags)];
    const make = firstTag(tags, ['com.apple.quicktime.make', 'make']);
    const model = firstTag(tags, ['com.apple.quicktime.model', 'model']);
    const encoder = firstTag(tags, ['encoder', 'encoded_by']);
    const upper = `${make ?? ''} ${model ?? ''} ${encoder ?? ''} ${path.basename(filePath)}`.toUpperCase();
    let device = [make, model].filter(Boolean).join(' ').trim();
    if (!device && upper.includes('DJI'))
        device = 'DJI Osmo Pocket';
    if (!device && /IPHONE|APPLE/.test(upper))
        device = model || 'Apple iPhone';
    if (!device && audioExtensions.has(path.extname(filePath).toLowerCase()))
        device = 'Externer Recorder';
    if (!device)
        device = 'Unbekanntes Gerät';
    const stem = path.basename(filePath, path.extname(filePath)).toLowerCase();
    const sequenceHint = stem.replace(/[\s_-]*\d+$/, '').replace(/[^a-z0-9]+/g, '-');
    const normalizedDevice = device.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const cardHint = path.basename(path.dirname(filePath)).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { device, deviceKey: `${normalizedDevice}:${cardHint || sequenceHint || 'media'}` };
}
function ffprobePath() {
    if (process.env.FFPROBE_PATH)
        return process.env.FFPROBE_PATH;
    return app.isPackaged ? ffprobeInstaller.path.replace('app.asar', 'app.asar.unpacked') : ffprobeInstaller.path;
}
async function probeMedia(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (!mediaExtensions.has(extension))
        throw new Error(`Nicht unterstütztes Format: ${extension}`);
    const info = await fs.stat(filePath);
    if (!info.isFile())
        throw new Error('Kein gültiger Medienpfad');
    const ffprobe = ffprobePath();
    const { stdout } = await execFileAsync(ffprobe, [
        '-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath,
    ], { maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    const data = JSON.parse(stdout);
    const video = data.streams?.find((stream) => stream.codec_type === 'video');
    const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
    const tagSources = [data.format?.tags, ...(data.streams ?? []).map((stream) => stream.tags)];
    const rawDate = firstTag(tagSources, ['creation_time', 'date', 'com.apple.quicktime.creationdate']);
    const parsedDate = rawDate ? new Date(rawDate) : null;
    const fallbackDate = info.birthtimeMs > 0 ? info.birthtime : info.mtime;
    const recordedAt = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : fallbackDate;
    const duration = Number(data.format?.duration ?? video?.duration ?? audio?.duration ?? 0);
    const { device, deviceKey } = deviceDetails(filePath, data);
    return {
        id: randomUUID(),
        path: filePath,
        name: path.basename(filePath),
        kind: video ? 'video' : 'audio',
        device,
        deviceKey,
        recordedAt: recordedAt.toISOString(),
        durationSeconds: Number.isFinite(duration) ? duration : 0,
        width: video?.width ?? null,
        height: video?.height ?? null,
        fps: frameRate(video?.avg_frame_rate || video?.r_frame_rate),
        codec: video?.codec_name ?? audio?.codec_name ?? 'unknown',
        audioCodec: audio?.codec_name ?? null,
        hasAudio: Boolean(audio),
        sizeBytes: info.size,
        containerFormat: data.format?.format_name ?? extension.slice(1),
        bitRate: Number(video?.bit_rate ?? data.format?.bit_rate) || null,
        pixelFormat: video?.pix_fmt ?? null,
        bitDepth: Number(video?.bits_per_raw_sample || video?.bits_per_sample) || (video?.pix_fmt?.includes('10') ? 10 : video ? 8 : null),
        colorSpace: video?.color_space ?? null,
        colorTransfer: video?.color_transfer ?? null,
        colorPrimaries: video?.color_primaries ?? null,
        audioSampleRate: Number(audio?.sample_rate) || null,
        audioChannels: Number(audio?.channels) || null,
    };
}
async function probePaths(paths) {
    const unique = validateProbePaths(paths);
    const results = await Promise.allSettled(unique.map(probeMedia));
    return results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
}

const audioEnvelopeCache = new Map();
async function audioEnvelope(media) {
    const info = await fs.stat(media.path);
    if (!info.isFile()) throw new Error('Audiodatei ist nicht mehr verfügbar.');
    const key = `${media.path}:${info.size}:${info.mtimeMs}`;
    const cached = audioEnvelopeCache.get(key);
    if (cached) return cached;
    const seconds = Math.max(5, Math.min(600, media.durationSeconds || 600));
    const { stdout } = await execFileAsync(ffmpegPath(), [
        '-nostdin', '-v', 'error', '-i', media.path, '-map', '0:a:0', '-vn',
        '-ac', '1', '-ar', '2000', '-t', String(seconds), '-f', 's16le', 'pipe:1',
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    const envelope = pcm16Envelope(stdout, 2000, 50);
    if (envelope.length < 250) throw new Error('Tonspur ist für eine Synchronisierung zu kurz.');
    audioEnvelopeCache.set(key, envelope);
    if (audioEnvelopeCache.size > 150) audioEnvelopeCache.delete(audioEnvelopeCache.keys().next().value);
    return envelope;
}

async function syncMulticamAudio(event, requestValue) {
    const request = validateMulticamSyncRequest(requestValue);
    const audioMedia = request.media.filter((media) => media.hasAudio);
    const result = { groupId: request.groupId, referenceMediaId: null, offsetsSeconds: {}, confidenceByMediaId: {}, waveforms: {}, failures: [] };
    if (audioMedia.length < 2) {
        result.failures.push('Für die automatische Synchronisierung werden mindestens zwei Tonspuren benötigt.');
        return result;
    }
    const reference = [...audioMedia].sort((left, right) => right.durationSeconds - left.durationSeconds)[0];
    result.referenceMediaId = reference.id;
    const total = audioMedia.length;
    let completed = 0;
    const report = (message) => event.sender.send('multicam:sync-progress', { groupId: request.groupId, completed, total, message });
    report(`Referenzton wird analysiert: ${path.basename(reference.path)}`);
    let referenceEnvelope;
    try {
        referenceEnvelope = await audioEnvelope(reference);
        result.offsetsSeconds[reference.id] = 0;
        result.confidenceByMediaId[reference.id] = 'high';
        result.waveforms[reference.id] = compactWaveform(referenceEnvelope, 6000);
        completed += 1;
    } catch (error) {
        result.failures.push(`${reference.id}: ${error instanceof Error ? error.message : 'Tonspur konnte nicht gelesen werden.'}`);
        return result;
    }
    for (const media of audioMedia) {
        if (media.id === reference.id) continue;
        report(`Tonspuren werden abgeglichen (${completed + 1}/${total})`);
        try {
            const envelope = await audioEnvelope(media);
            const rawDifference = (Date.parse(media.recordedAt) - Date.parse(reference.recordedAt)) / 1000;
            const match = findAudioSyncOffset(referenceEnvelope, envelope, rawDifference, 50, 15);
            const confidence = confidenceForScore(match.score, match.overlapSeconds);
            result.waveforms[media.id] = compactWaveform(envelope, 6000);
            result.confidenceByMediaId[media.id] = confidence;
            if (confidence !== 'low') result.offsetsSeconds[media.id] = match.offsetSeconds;
            else result.failures.push(`${media.id}: Keine eindeutige Übereinstimmung der Tonspuren.`);
        } catch (error) {
            result.failures.push(`${media.id}: ${error instanceof Error ? error.message : 'Tonspur konnte nicht gelesen werden.'}`);
        }
        completed += 1;
    }
    report('Tonspuren wurden analysiert.');
    return result;
}

function ffmpegPath() {
    if (process.env.FFMPEG_PATH)
        return process.env.FFMPEG_PATH;
    return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
}

function even(value) {
    const rounded = Math.max(2, Math.round(value));
    return rounded % 2 ? rounded + 1 : rounded;
}

function sourceExportSettings(request, segments) {
    const media = segments.map((segment) => segment.media);
    const width = even(Math.max(2, ...media.map((item) => item.width ?? 0)));
    const height = even(Math.max(2, ...media.map((item) => item.height ?? 0)));
    const fps = Math.max(1, ...media.map((item) => item.fps ?? request.project.settings.frameRate ?? 30));
    const bitDepth = Math.max(8, ...media.map((item) => item.bitDepth ?? 8));
    if (request.profile === 'lossless-master' || bitDepth > 10) {
        const pixelFormat = bitDepth > 12 ? 'yuv444p16le' : bitDepth > 10 ? 'yuv444p12le' : bitDepth > 8 ? 'yuv444p10le' : 'yuv444p';
        return { width, height, fps, extension: 'mkv', videoCodec: 'ffv1', pixelFormat, videoArgs: ['-level', '3'], audioCodec: 'flac', audioArgs: [] };
    }
    const codecs = [...new Set(media.filter((item) => item.kind === 'video').map((item) => item.codec.toLowerCase()))];
    const firstExtension = path.extname(media.find((item) => item.kind === 'video')?.path ?? '').toLowerCase().slice(1);
    if (codecs.length === 1 && codecs[0] === 'h264') {
        return { width, height, fps, bitDepth, extension: firstExtension === 'mov' ? 'mov' : firstExtension === 'mkv' ? 'mkv' : 'mp4', videoCodec: 'libx264', pixelFormat: bitDepth > 8 ? 'yuv420p10le' : 'yuv420p', videoArgs: ['-preset', 'veryfast', '-crf', '10'], audioCodec: firstExtension === 'mov' ? 'pcm_s24le' : 'aac', audioArgs: firstExtension === 'mov' ? [] : ['-b:a', '320k'] };
    }
    if (codecs.length === 1 && ['hevc', 'h265'].includes(codecs[0])) {
        return { width, height, fps, bitDepth, extension: firstExtension === 'mov' ? 'mov' : 'mp4', videoCodec: 'libx265', pixelFormat: bitDepth > 8 ? 'yuv420p10le' : 'yuv420p', videoArgs: ['-preset', 'fast', '-crf', '12'], audioCodec: firstExtension === 'mov' ? 'pcm_s24le' : 'aac', audioArgs: firstExtension === 'mov' ? [] : ['-b:a', '320k'] };
    }
    return { width, height, fps, extension: 'mov', videoCodec: 'prores_ks', pixelFormat: 'yuv422p10le', videoArgs: ['-profile:v', '3', '-vendor', 'apl0'], audioCodec: 'pcm_s24le', audioArgs: [] };
}

const encoderAvailability = new Map();
async function encoderWorks(codec, pixelFormat, videoArgs) {
    const cacheKey = `${codec}:${pixelFormat}`;
    if (encoderAvailability.has(cacheKey))
        return encoderAvailability.get(cacheKey);
    try {
        await execFileAsync(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=30:d=0.05', '-frames:v', '1', '-c:v', codec, ...videoArgs, '-pix_fmt', pixelFormat, '-f', 'null', '-'], { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
        encoderAvailability.set(cacheKey, true);
        return true;
    }
    catch {
        encoderAvailability.set(cacheKey, false);
        return false;
    }
}

async function acceleratedExportSettings(settings) {
    if (settings.videoCodec === 'libx264' && settings.bitDepth <= 8) {
        if (process.platform === 'win32') {
            const videoArgs = ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '12', '-b:v', '0'];
            if (await encoderWorks('h264_nvenc', 'yuv420p', videoArgs))
                return { ...settings, videoCodec: 'h264_nvenc', videoArgs, accelerated: true };
        }
        if (process.platform === 'darwin') {
            const videoArgs = ['-q:v', '85', '-allow_sw', '1'];
            if (await encoderWorks('h264_videotoolbox', 'yuv420p', videoArgs))
                return { ...settings, videoCodec: 'h264_videotoolbox', videoArgs, accelerated: true };
        }
    }
    if (settings.videoCodec === 'libx265') {
        const hardwarePixelFormat = settings.bitDepth > 8 ? 'p010le' : 'yuv420p';
        if (process.platform === 'win32') {
            const videoArgs = ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '14', '-b:v', '0'];
            if (await encoderWorks('hevc_nvenc', hardwarePixelFormat, videoArgs))
                return { ...settings, videoCodec: 'hevc_nvenc', pixelFormat: hardwarePixelFormat, videoArgs, accelerated: true };
        }
        if (process.platform === 'darwin') {
            const videoArgs = ['-q:v', '85', '-allow_sw', '1'];
            if (await encoderWorks('hevc_videotoolbox', hardwarePixelFormat, videoArgs))
                return { ...settings, videoCodec: 'hevc_videotoolbox', pixelFormat: hardwarePixelFormat, videoArgs, accelerated: true };
        }
    }
    return { ...settings, accelerated: false };
}

function escapedText(value) {
    return String(value ?? '').replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll(':', '\\:').replaceAll('%', '\\%').replaceAll(',', '\\,');
}

function overlayFontPath() {
    if (process.platform === 'win32')
        return "C\\:/Windows/Fonts/segoeui.ttf";
    if (process.platform === 'darwin')
        return '/System/Library/Fonts/Helvetica.ttc';
    return '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
}

function catmullPoint(points, progress, smoothing) {
    if (!points.length)
        return { x: 0, y: 0 };
    if (points.length === 1)
        return points[0];
    const scaled = progress * (points.length - 1);
    const index = Math.min(points.length - 2, Math.floor(scaled));
    const t = scaled - index;
    const before = points[Math.max(0, index - 1)];
    const start = points[index];
    const end = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const tangentStart = { x: (end.x - before.x) * smoothing, y: (end.y - before.y) * smoothing };
    const tangentEnd = { x: (after.x - start.x) * smoothing, y: (after.y - start.y) * smoothing };
    const t2 = t * t;
    const t3 = t2 * t;
    return {
        x: (2 * t3 - 3 * t2 + 1) * start.x + (t3 - 2 * t2 + t) * tangentStart.x + (-2 * t3 + 3 * t2) * end.x + (t3 - t2) * tangentEnd.x,
        y: (2 * t3 - 3 * t2 + 1) * start.y + (t3 - 2 * t2 + t) * tangentStart.y + (-2 * t3 + 3 * t2) * end.y + (t3 - t2) * tangentEnd.y,
    };
}

function tracerFrameAtProgress(points, progress, fallbackStart, fallbackEnd) {
    const ordered = [...points].sort((left, right) => left.frame - right.frame);
    if (ordered.length < 2)
        return fallbackStart + (fallbackEnd - fallbackStart) * progress;
    const scaled = progress * (ordered.length - 1);
    const index = Math.min(ordered.length - 2, Math.floor(scaled));
    const segmentProgress = scaled - index;
    return ordered[index].frame + (ordered[index + 1].frame - ordered[index].frame) * segmentProgress;
}

function cameraLockTargetPoint(lock, point) {
    if (!lock?.referencePoints?.[1] || !lock?.targetPoints?.[1])
        return point;
    const [referenceA, referenceB] = lock.referencePoints;
    const [targetA, targetB] = lock.targetPoints;
    const referenceX = referenceB.x - referenceA.x;
    const referenceY = referenceB.y - referenceA.y;
    const targetX = targetB.x - targetA.x;
    const targetY = targetB.y - targetA.y;
    const denominator = referenceX * referenceX + referenceY * referenceY;
    if (denominator < 1e-8)
        return { x: point.x + targetA.x - referenceA.x, y: point.y + targetA.y - referenceA.y };
    const a = (targetX * referenceX + targetY * referenceY) / denominator;
    const b = (targetY * referenceX - targetX * referenceY) / denominator;
    return {
        x: targetA.x + a * (point.x - referenceA.x) - b * (point.y - referenceA.y),
        y: targetA.y + b * (point.x - referenceA.x) + a * (point.y - referenceA.y),
    };
}

function cameraLockPointAtFrame(lock, point, frame) {
    if (!lock)
        return point;
    const target = cameraLockTargetPoint(lock, point);
    const progress = Math.min(1, Math.max(0, (frame - lock.referenceFrame) / Math.max(1, lock.targetFrame - lock.referenceFrame)));
    return { x: point.x + (target.x - point.x) * progress, y: point.y + (target.y - point.y) * progress };
}

function tracerFilters(tracer, settings, sourceFps) {
    if (!tracer?.enabled || tracer.points.length < 2)
        return [];
    const count = settings.width >= 3000 ? 180 : 140;
    const impact = (tracer.impactFrame ?? 0) / sourceFps;
    const end = Math.max(impact, (tracer.endFrame ?? tracer.points.at(-1)?.frame ?? 0) / sourceFps);
    const disappear = Math.max(end, (tracer.disappearFrame ?? tracer.endFrame ?? 0) / sourceFps);
    const thickness = Math.max(2, Math.round(tracer.thickness * settings.width / 1920));
    const glow = Math.max(thickness + 2, Math.round((tracer.thickness + tracer.glow * .45) * settings.width / 1920));
    const color = String(tracer.color ?? '#c8ff42').replace('#', '').replace(/[^0-9a-f]/gi, '').slice(0, 6).padEnd(6, 'f');
    const tailLength = Math.min(.5, Math.max(.04, tracer.tailLength ?? .16));
    const occlusionStart = tracer.occlusionStartFrame === null || tracer.occlusionStartFrame === undefined ? null : tracer.occlusionStartFrame / sourceFps;
    const occlusionEnd = tracer.occlusionEndFrame === null || tracer.occlusionEndFrame === undefined ? null : tracer.occlusionEndFrame / sourceFps;
    const hasOcclusion = false;
    const filters = [];
    for (let index = 0; index < count; index += 1) {
        const progress = index / (count - 1);
        const point = catmullPoint(tracer.points, progress, tracer.smoothing ?? .72);
        const visibleAt = tracerFrameAtProgress(tracer.points, progress, impact * sourceFps, end * sourceFps) / sourceFps;
        const tailEnd = index === count - 1 ? disappear : Math.min(disappear, tracerFrameAtProgress(tracer.points, Math.min(1, progress + tailLength), impact * sourceFps, end * sourceFps) / sourceFps);
        const intervalEnd = Math.max(visibleAt, tailEnd);
        const intervalCount = tracer.cameraLock && intervalEnd - visibleAt > 2 / sourceFps ? 2 : 1;
        for (let interval = 0; interval < intervalCount; interval += 1) {
            const intervalStart = visibleAt + (intervalEnd - visibleAt) * interval / intervalCount;
            const intervalStop = visibleAt + (intervalEnd - visibleAt) * (interval + 1) / intervalCount;
            const sampleFrame = (intervalStart + intervalStop) * .5 * sourceFps;
            const screenPoint = cameraLockPointAtFrame(tracer.cameraLock, point, sampleFrame);
            const visible = `between(t\\,${intervalStart.toFixed(5)}\\,${intervalStop.toFixed(5)})`;
            const occlusionCut = index === count - 1 ? occlusionEnd - .5 / sourceFps : occlusionEnd + .5 / sourceFps;
            const occlusion = hasOcclusion ? `*not(between(t\\,${(occlusionStart + .5 / sourceFps).toFixed(5)}\\,${occlusionCut.toFixed(5)}))` : '';
            const enable = `${visible}${occlusion}`;
            const x = Math.round(screenPoint.x * settings.width);
            const y = Math.round(screenPoint.y * settings.height);
            filters.push(`drawbox=x=${x - Math.round(glow / 2)}:y=${y - Math.round(glow / 2)}:w=${glow}:h=${glow}:color=0x${color}@0.12:t=fill:enable='${enable}'`);
            filters.push(`drawbox=x=${x - Math.round(thickness / 2)}:y=${y - Math.round(thickness / 2)}:w=${thickness}:h=${thickness}:color=0x${color}@0.96:t=fill:enable='${enable}'`);
        }
    }
    return filters;
}

function overlayFilters(project, sequence, block, settings) {
    const overlays = project.overlays.filter((overlay) => overlay.sequenceId === sequence.id && overlay.enabled);
    const player = project.settings.players.find((item) => item.id === block.playerId);
    const hole = project.courseData?.holes?.find((item) => item.number === block.hole);
    const font = overlayFontPath();
    return overlays.flatMap((overlay) => {
        const start = overlay.startFrame / sequence.sourceFps;
        const end = overlay.endFrame / sequence.sourceFps;
        const enable = `between(t\\,${start.toFixed(5)}\\,${end.toFixed(5)})`;
        const boxWidth = Math.round(settings.width * (overlay.type === 'player-card' ? .34 : .25));
        const boxHeight = Math.round(settings.height * .105);
        const marginX = Math.round(settings.width * .04);
        const marginY = Math.round(settings.height * .06);
        const x = overlay.position.endsWith('right') ? settings.width - marginX - boxWidth : marginX;
        const y = overlay.position.startsWith('bottom') ? settings.height - marginY - boxHeight : marginY;
        const title = overlay.type === 'player-card' ? player?.name ?? '' : overlay.type === 'hole-info' ? project.settings.course : player?.name ?? '';
        const detail = overlay.type === 'player-card'
            ? `LOCH ${block.hole}  SCHLAG ${block.details?.shotNumber ?? '-'}  ${block.details?.club ?? ''}`
            : overlay.type === 'hole-info'
                ? `LOCH ${block.hole}  PAR ${hole?.par ?? '-'}  ${hole?.lengthMeters ? `${hole.lengthMeters} M` : ''}`
                : `SCORE NACH LOCH ${block.hole}`;
        const titleSize = Math.max(18, Math.round(settings.height * .028));
        const detailSize = Math.max(12, Math.round(settings.height * .014));
        return [
            `drawbox=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:color=0x0c120f@0.90:t=fill:enable='${enable}'`,
            `drawbox=x=${x}:y=${y}:w=${Math.max(4, Math.round(settings.width * .003))}:h=${boxHeight}:color=0xc8ff42@1:t=fill:enable='${enable}'`,
            `drawtext=fontfile='${font}':text='${escapedText(title)}':x=${x + Math.round(boxWidth * .09)}:y=${y + Math.round(boxHeight * .22)}:fontsize=${titleSize}:fontcolor=white:expansion=none:enable='${enable}'`,
            `drawtext=fontfile='${font}':text='${escapedText(detail)}':x=${x + Math.round(boxWidth * .09)}:y=${y + Math.round(boxHeight * .62)}:fontsize=${detailSize}:fontcolor=0xb7c1bb:expansion=none:enable='${enable}'`,
        ];
    });
}

function playerScoreBeforeHole(project, playerId, hole) {
    const scores = (project.playerScores ?? []).filter((score) => score.playerId === playerId && score.hole < hole && score.strokes !== null);
    if (!scores.length)
        return 'E';
    const total = scores.reduce((sum, score) => {
        const par = project.courseData?.holes?.find((item) => item.number === score.hole)?.par ?? 4;
        return sum + score.strokes - par;
    }, 0);
    return total === 0 ? 'E' : total > 0 ? `+${total}` : String(total);
}

function fixedEditorialFilters(project, sequence, block, settings) {
    const player = project.settings.players.find((item) => item.id === block.playerId);
    const hole = project.courseData?.holes?.find((item) => item.number === block.hole);
    const font = overlayFontPath();
    const score = playerScoreBeforeHole(project, block.playerId, block.hole);
    const boxWidth = Math.round(settings.width * .285);
    const boxHeight = Math.round(settings.height * .095);
    const x = Math.round(settings.width * .035);
    const y = Math.round(settings.height * .05);
    const accent = Math.max(4, Math.round(settings.width * .003));
    const scoreWidth = Math.round(boxWidth * .22);
    const titleSize = Math.max(18, Math.round(settings.height * .027));
    const detailSize = Math.max(12, Math.round(settings.height * .014));
    const detail = `H${block.hole}  PAR ${hole?.par ?? '-'}${hole?.lengthMeters ? `  ${hole.lengthMeters} M` : ''}`;
    const filters = [
        `drawbox=x=${x}:y=${y}:w=${boxWidth}:h=${boxHeight}:color=0x0a100d@0.88:t=fill`,
        `drawbox=x=${x}:y=${y}:w=${accent}:h=${boxHeight}:color=0xc8ff42@1:t=fill`,
        `drawbox=x=${x + boxWidth - scoreWidth}:y=${y}:w=${scoreWidth}:h=${boxHeight}:color=0x050806@0.72:t=fill`,
        `drawtext=fontfile='${font}':text='${escapedText((player?.name ?? '').toUpperCase())}':x=${x + Math.round(boxWidth * .07)}:y=${y + Math.round(boxHeight * .19)}:fontsize=${titleSize}:fontcolor=white:expansion=none`,
        `drawtext=fontfile='${font}':text='${escapedText(detail)}':x=${x + Math.round(boxWidth * .07)}:y=${y + Math.round(boxHeight * .61)}:fontsize=${detailSize}:fontcolor=0xabb6af:expansion=none`,
        `drawtext=fontfile='${font}':text='${escapedText(score)}':x=${x + boxWidth - Math.round(scoreWidth * .5)}-text_w/2:y=${y + Math.round(boxHeight * .5)}-text_h/2:fontsize=${Math.max(22, Math.round(settings.height * .04))}:fontcolor=0xc8ff42:expansion=none`,
    ];
    const shot = block.details ?? {};
    if (shot.club || shot.distanceMeters) {
        const shotWidth = Math.round(settings.width * .225);
        const shotHeight = Math.round(settings.height * .075);
        const shotX = settings.width - Math.round(settings.width * .035) - shotWidth;
        const shotY = settings.height - Math.round(settings.height * .06) - shotHeight;
        const visibleEnd = Math.min(2.6, (sequence.outFrame - sequence.inFrame) / sequence.sourceFps).toFixed(4);
        const enable = `between(t\\,0\\,${visibleEnd})`;
        filters.push(
            `drawbox=x=${shotX}:y=${shotY}:w=${shotWidth}:h=${shotHeight}:color=0x0b100d@0.88:t=fill:enable='${enable}'`,
            `drawbox=x=${shotX + shotWidth - accent}:y=${shotY}:w=${accent}:h=${shotHeight}:color=0xc8ff42@1:t=fill:enable='${enable}'`,
            `drawtext=fontfile='${font}':text='SCHLAG ${shot.shotNumber ?? '-'}':x=${shotX + Math.round(shotWidth * .07)}:y=${shotY + Math.round(shotHeight * .16)}:fontsize=${detailSize}:fontcolor=0x88958d:expansion=none:enable='${enable}'`,
            `drawtext=fontfile='${font}':text='${escapedText(shot.club || block.label)}':x=${shotX + Math.round(shotWidth * .07)}:y=${shotY + Math.round(shotHeight * .50)}:fontsize=${Math.max(16, Math.round(settings.height * .022))}:fontcolor=white:expansion=none:enable='${enable}'`,
            ...(shot.distanceMeters ? [`drawtext=fontfile='${font}':text='${shot.distanceMeters} M':x=${shotX + Math.round(shotWidth * .91)}-text_w:y=${shotY + Math.round(shotHeight * .51)}:fontsize=${Math.max(14, Math.round(settings.height * .019))}:fontcolor=0xc8ff42:expansion=none:enable='${enable}'`] : []),
        );
    }
    return filters;
}

function holeCardFilters(project, block, settings, videoLabel, audioLabel) {
    const font = overlayFontPath();
    const hole = project.courseData?.holes?.find((item) => item.number === block.hole);
    const duration = 1.8;
    const course = escapedText((project.settings.course || 'GOLF ROUND').toUpperCase());
    const detail = `PAR ${hole?.par ?? '-'}${hole?.lengthMeters ? `  ${hole.lengthMeters} M` : ''}`;
    const video = `color=c=0x030504:s=${settings.width}x${settings.height}:r=${settings.fps}:d=${duration},drawtext=fontfile='${font}':text='${course}':x=(w-text_w)/2:y=h*0.37:fontsize=${Math.max(16, Math.round(settings.height * .018))}:fontcolor=0x89958d:expansion=none,drawtext=fontfile='${font}':text='HOLE ${block.hole}':x=(w-text_w)/2:y=h*0.425:fontsize=${Math.max(44, Math.round(settings.height * .072))}:fontcolor=white:expansion=none,drawtext=fontfile='${font}':text='${escapedText(detail)}':x=(w-text_w)/2:y=h*0.56:fontsize=${Math.max(18, Math.round(settings.height * .024))}:fontcolor=0xc8ff42:expansion=none,fade=t=in:st=0:d=0.25,fade=t=out:st=1.5:d=0.3,format=pix_fmts=${settings.pixelFormat}[${videoLabel}]`;
    const audio = `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[${audioLabel}]`;
    return { video, audio, duration };
}

async function exportVideo(event, request) {
    const sequences = request.sequenceIds.map((id) => request.project.sequences.find((sequence) => sequence.id === id)).filter(Boolean);
    const segments = sequences.map((sequence) => {
        const media = exportMediaForSequence(request.project, sequence);
        return { sequence, media, range: media ? exportRangeForSequence(sequence, media) : null, block: request.project.blocks.find((block) => block.id === sequence.targetBlockId) };
    }).filter((item) => item.media && item.range && item.block);
    if (!segments.length)
        return { canceled: false, error: 'Keine exportierbaren Sequenzen vorhanden.' };
    await assertMediaFilesAreReadable({ media: segments.map((segment) => segment.media) });
    const settings = await acceleratedExportSettings(sourceExportSettings(request, segments));
    const result = await dialog.showSaveDialog({ title: 'Golfrunde exportieren', defaultPath: `${request.project.settings.course || 'Golfrunde'}.${settings.extension}`, filters: [{ name: request.profile === 'lossless-master' ? 'Verlustfreier Master' : 'Quellgetreuer Videoexport', extensions: [settings.extension] }] });
    if (result.canceled || !result.filePath)
        return { canceled: true };
    const outputPath = path.extname(result.filePath) ? result.filePath : `${result.filePath}.${settings.extension}`;
    const temporaryDirectory = await fs.mkdtemp(path.join(app.getPath('temp'), 'golf-round-export-'));
    const holeChangeCount = segments.slice(0, -1).filter((item, index) => item.block.hole !== segments[index + 1].block.hole).length;
    const totalDuration = segments.reduce((total, item) => total + (item.range.outFrame - item.range.inFrame) / item.range.sourceFps, 0) + holeChangeCount * 1.8;
    event.sender.send('export:progress', { phase: 'preparing', percent: 0, message: `${settings.width}×${settings.height} · ${settings.fps} fps · ${settings.videoCodec}${settings.accelerated ? ' (GPU)' : ''}` });
    try {
        const args = ['-y', '-hide_banner'];
        segments.forEach(({ range, media }) => {
            args.push('-ss', (range.inFrame / range.sourceFps).toFixed(6), '-t', ((range.outFrame - range.inFrame) / range.sourceFps).toFixed(6), '-i', media.path);
        });
        const graph = [];
        const concatLabels = [];
        segments.forEach(({ sequence, media, range, block }, index) => {
            const duration = (range.outFrame - range.inFrame) / range.sourceFps;
            const previousBlock = segments[index - 1]?.block;
            const nextBlock = segments[index + 1]?.block;
            const startsHole = Boolean(previousBlock && previousBlock.hole !== block.hole);
            const endsHole = Boolean(nextBlock && nextBlock.hole !== block.hole);
            const dip = Math.min(duration / 2, 10 / settings.fps);
            const videoFilters = [
                ...tracerFilters(request.project.shotTracers.find((tracer) => tracer.sequenceId === sequence.id), settings, sequence.sourceFps),
                ...fixedEditorialFilters(request.project, sequence, block, settings),
                ...(startsHole ? [`fade=t=in:st=0:d=${dip.toFixed(6)}`] : []),
                ...(endsHole ? [`fade=t=out:st=${Math.max(0, duration - dip).toFixed(6)}:d=${dip.toFixed(6)}`] : []),
                `format=pix_fmts=${settings.pixelFormat}`,
            ];
            const visual = media.kind === 'video'
                ? [`[${index}:v]scale=${settings.width}:${settings.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${settings.width}:${settings.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${settings.fps},setsar=1,setpts=PTS-STARTPTS`, ...videoFilters].join(',') + `[v${index}]`
                : [`color=c=black:s=${settings.width}x${settings.height}:r=${settings.fps}:d=${duration.toFixed(6)}`, ...fixedEditorialFilters(request.project, sequence, block, settings), ...(startsHole ? [`fade=t=in:st=0:d=${dip.toFixed(6)}`] : []), ...(endsHole ? [`fade=t=out:st=${Math.max(0, duration - dip).toFixed(6)}:d=${dip.toFixed(6)}`] : []), `format=pix_fmts=${settings.pixelFormat}`].join(',') + `[v${index}]`;
            graph.push(visual);
            const audioFade = Math.min(duration / 3, 6 / settings.fps);
            const audioFilters = [
                ...(index > 0 ? [`afade=t=in:st=0:d=${audioFade.toFixed(6)}`] : []),
                ...(index < segments.length - 1 ? [`afade=t=out:st=${Math.max(0, duration - audioFade).toFixed(6)}:d=${audioFade.toFixed(6)}`] : []),
                'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
            ];
            graph.push(media.hasAudio || media.kind === 'audio'
                ? [`[${index}:a]aresample=48000,apad,atrim=duration=${duration.toFixed(6)},asetpts=PTS-STARTPTS`, ...audioFilters].join(',') + `[a${index}]`
                : [`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${duration.toFixed(6)}`, ...audioFilters].join(',') + `[a${index}]`);
            concatLabels.push(`[v${index}][a${index}]`);
            if (endsHole && nextBlock) {
                const card = holeCardFilters(request.project, nextBlock, settings, `vh${index}`, `ah${index}`);
                graph.push(card.video, card.audio);
                concatLabels.push(`[vh${index}][ah${index}]`);
            }
        });
        graph.push(`${concatLabels.join('')}concat=n=${concatLabels.length}:v=1:a=1[vout][aout]`);
        const filterPath = path.join(temporaryDirectory, 'filter.txt');
        await fs.writeFile(filterPath, graph.join(';\n'), 'utf8');
        args.push('-filter_complex_script', filterPath, '-map', '[vout]', '-map', '[aout]', '-c:v', settings.videoCodec, ...settings.videoArgs, '-pix_fmt', settings.pixelFormat, '-c:a', settings.audioCodec, ...settings.audioArgs);
        if (settings.extension === 'mp4' || settings.extension === 'mov')
            args.push('-movflags', '+faststart');
        args.push('-progress', 'pipe:1', '-nostats', outputPath);
        await new Promise((resolve, reject) => {
            const child = spawn(ffmpegPath(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
            activeExportProcess = child;
            let stderr = '';
            let progressBuffer = '';
            child.stdout.on('data', (chunk) => {
                progressBuffer += chunk.toString();
                const lines = progressBuffer.split(/\r?\n/);
                progressBuffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (!line.startsWith('out_time_ms=')) continue;
                    const seconds = Number(line.slice(12)) / 1_000_000;
                    const percent = Math.min(99, Math.max(0, seconds / totalDuration * 100));
                    event.sender.send('export:progress', { phase: 'encoding', percent, message: `Video wird in ${settings.videoCodec} gerendert …` });
                }
            });
            child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-12000); });
            child.on('error', reject);
            child.on('close', (code) => {
                activeExportProcess = null;
                if (exportWasCanceled) resolve();
                else if (code === 0) resolve();
                else reject(new Error(stderr || `FFmpeg wurde mit Code ${code} beendet.`));
            });
        });
        if (exportWasCanceled) {
            exportWasCanceled = false;
            event.sender.send('export:progress', { phase: 'canceled', percent: 0, message: 'Export abgebrochen.' });
            return { canceled: true };
        }
        event.sender.send('export:progress', { phase: 'complete', percent: 100, message: 'Export abgeschlossen.', outputPath });
        return { canceled: false, path: outputPath };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        event.sender.send('export:progress', { phase: 'error', percent: 0, message });
        return { canceled: false, error: message };
    } finally {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
}

let activeExportProcess = null;
let exportWasCanceled = false;
const productionUrl = pathToFileURL(path.join(import.meta.dirname, '../dist/index.html')).href;
const developmentUrl = process.env.VITE_DEV_SERVER_URL;
function registerTrustedHandler(channel, listener) {
    ipcMain.handle(channel, (event, ...args) => {
        if (!isTrustedAppUrl(event.senderFrame?.url ?? '', productionUrl, developmentUrl)) {
            throw new IpcValidationError('IPC-Aufruf von einer nicht vertrauenswürdigen Seite blockiert.');
        }
        return listener(event, ...args);
    });
}
function registerIpc() {
    registerTrustedHandler('external:open', async (_event, value) => {
        const url = new URL(String(value));
        if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith('/johannesstuck-eng/Golf-Studio/'))
            throw new IpcValidationError('Externer Link wurde blockiert.');
        await shell.openExternal(url.href);
        return { opened: true };
    });
    registerTrustedHandler('media:choose', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Golf-Aufnahmen importieren',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Video und Audio', extensions: [...mediaExtensions].map((ext) => ext.slice(1)) }],
        });
        return result.canceled ? [] : probePaths(result.filePaths);
    });
    registerTrustedHandler('media:probe-paths', (_event, paths) => probePaths(paths));
    registerTrustedHandler('multicam:sync-audio', (event, request) => syncMulticamAudio(event, request));
    registerTrustedHandler('project:save', async (_event, projectValue) => {
        const project = validateProject(projectValue);
        const result = await dialog.showSaveDialog({
            title: 'Golfprojekt speichern',
            defaultPath: 'Neue Golfrunde.golfcut',
            filters: [{ name: 'CUT18 Projekt', extensions: ['golfcut'] }],
        });
        if (result.canceled || !result.filePath)
            return { canceled: true };
        await fs.writeFile(result.filePath, JSON.stringify(project, null, 2), 'utf8');
        return { canceled: false, path: result.filePath };
    });
    registerTrustedHandler('project:open', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Golfprojekt öffnen', properties: ['openFile'],
            filters: [{ name: 'CUT18 Projekt', extensions: ['golfcut'] }],
        });
        if (result.canceled || !result.filePaths[0])
            return { canceled: true };
        const filePath = result.filePaths[0];
        const info = await fs.stat(filePath);
        if (!info.isFile() || info.size > 10 * 1024 * 1024)
            throw new IpcValidationError('Projektdatei ist ungültig oder größer als 10 MB.');
        const project = JSON.parse(await fs.readFile(filePath, 'utf8'));
        if (project === null || typeof project !== 'object' || Array.isArray(project))
            throw new IpcValidationError('Projektdatei enthält kein gültiges Projektobjekt.');
        return { canceled: false, path: filePath, project };
    });
    registerTrustedHandler('scorecard:choose', async () => {
        const result = await dialog.showOpenDialog({
            title: 'Scorecard auswählen',
            properties: ['openFile'],
            filters: [
                { name: 'Scorecard (Bild oder PDF)', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp'] },
            ],
        });
        return result.canceled || !result.filePaths[0]
            ? { canceled: true }
            : { canceled: false, path: result.filePaths[0] };
    });
    registerTrustedHandler('export:start', async (event, requestValue) => {
        if (activeExportProcess)
            return { canceled: false, error: 'Es läuft bereits ein Export.' };
        try {
            const request = validateExportRequest(requestValue);
            exportWasCanceled = false;
            return await exportVideo(event, request);
        }
        catch (error) {
            const message = error instanceof IpcValidationError ? error.message : 'Exportanfrage konnte nicht validiert werden.';
            return { canceled: false, error: message };
        }
    });
    registerTrustedHandler('export:cancel', () => {
        if (!activeExportProcess)
            return { canceled: false };
        exportWasCanceled = true;
        activeExportProcess.kill();
        return { canceled: true };
    });
}
function createWindow() {
    const window = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1080,
        minHeight: 700,
        backgroundColor: '#0a0d0c',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        webPreferences: {
            // Sandboxed preload scripts do not support ESM. Use an explicit
            // CommonJS extension even though the application itself is ESM.
            preload: path.join(import.meta.dirname, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    let displayingLoadError = false;
    const showLoadError = (message) => {
        if (displayingLoadError || window.isDestroyed())
            return;
        displayingLoadError = true;
        const safeMessage = message.replace(/[&<>"']/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
        })[character] ?? character);
        const html = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Startfehler</title>
      <body style="margin:0;background:#0a0d0c;color:#f1f5f2;font:16px/1.5 system-ui;padding:48px">
      <h1 style="color:#79e66d">CUT18 konnte die Oberfläche nicht laden.</h1>
      <p>${safeMessage}</p><p>Bitte die App schließen und das aktuelle Programmpaket erneut entpacken.</p></body></html>`;
        void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    };
    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame && errorCode !== -3) {
            showLoadError(`${errorDescription} (${errorCode}) – ${validatedUrl}`);
        }
    });
    window.webContents.on('render-process-gone', (_event, details) => {
        showLoadError(`Der Darstellungsprozess wurde beendet: ${details.reason}.`);
    });
    window.webContents.on('did-finish-load', () => {
        if (!window.webContents.getURL().startsWith('file:'))
            return;
        setTimeout(() => {
            if (window.isDestroyed() || displayingLoadError)
                return;
            void window.webContents.executeJavaScript('Boolean(document.querySelector("#root")?.childElementCount)')
                .then((hasInterface) => {
                if (!hasInterface)
                    showLoadError('Die Programmdateien wurden gefunden, aber die Benutzeroberfläche blieb leer.');
            })
                .catch((error) => {
                showLoadError(error instanceof Error ? error.message : String(error));
            });
        }, 1000);
    });
    const loadPromise = developmentUrl
        ? window.loadURL(developmentUrl)
        : window.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
    void loadPromise.catch((error) => {
        showLoadError(error instanceof Error ? error.message : String(error));
    });
}
app.whenReady().then(() => {
    registerIpc();
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        app.quit();
});
