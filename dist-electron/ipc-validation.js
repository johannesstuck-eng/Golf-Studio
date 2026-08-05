import path from 'node:path';

export class IpcValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'IpcValidationError';
    }
}

const limits = {
    media: 1000,
    sequences: 1000,
    blocks: 1000,
    overlays: 2000,
    tracers: 1000,
    tracerPoints: 256,
    groups: 250,
    players: 16,
    sequenceIds: 1000,
    text: 500,
};

const mediaExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.wav', '.mp3', '.m4a', '.aac', '.flac']);
const blockTypes = new Set(['tee-shot', 'approach', 'greenside', 'bunker', 'putt', 'extra-shot', 'penalty', 'hole-intro', 'course', 'cart-cam', 'banter', 'pre-shot', 'post-shot', 'reaction', 'hole-outro', 'score-update']);
const overlayTypes = new Set(['player-card', 'hole-info', 'score-card']);
const overlayPositions = new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']);

function fail(location, message) {
    throw new IpcValidationError(`${location}: ${message}`);
}

function record(value, location) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(location, 'Objekt erwartet.');
    return value;
}

function array(value, location, maximum) {
    if (!Array.isArray(value)) fail(location, 'Liste erwartet.');
    if (value.length > maximum) fail(location, `Höchstens ${maximum} Einträge erlaubt.`);
    return value;
}

function string(value, location, maximum = limits.text, allowEmpty = false) {
    if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > maximum || value.includes('\0')) {
        fail(location, `Ungültiger Text (maximal ${maximum} Zeichen).`);
    }
    return value;
}

function finite(value, location, minimum, maximum, integer = false) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
        fail(location, `Zahl zwischen ${minimum} und ${maximum} erwartet.`);
    }
    return value;
}

function nullableFinite(value, location, minimum, maximum, integer = false) {
    if (value === null || value === undefined) return;
    finite(value, location, minimum, maximum, integer);
}

function boolean(value, location) {
    if (typeof value !== 'boolean') fail(location, 'Boolean erwartet.');
}

function enumeration(value, location, allowed) {
    if (!allowed.has(value)) fail(location, 'Nicht unterstützter Wert.');
}

function uniqueStrings(values, location, maximum) {
    const items = array(values, location, maximum);
    const result = items.map((value, index) => string(value, `${location}[${index}]`, 128));
    if (new Set(result).size !== result.length) fail(location, 'Doppelte IDs sind nicht erlaubt.');
    return result;
}

export function validateLocalMediaPath(value, location = 'Medienpfad') {
    const filePath = string(value, location, 32767);
    if (!path.isAbsolute(filePath) || filePath.startsWith('\\\\')) {
        fail(location, 'Absoluter lokaler Dateipfad erwartet.');
    }
    const extension = path.extname(filePath).toLowerCase();
    if (!mediaExtensions.has(extension)) fail(location, `Nicht unterstütztes Medienformat ${extension || '(ohne Endung)'}.`);
    return path.normalize(filePath);
}

export function validateMulticamSyncRequest(value) {
    const request = record(value, 'multicamSync');
    string(request.groupId, 'multicamSync.groupId', 128);
    const media = array(request.media, 'multicamSync.media', limits.media);
    if (media.length < 2) fail('multicamSync.media', 'Mindestens zwei Medien erwartet.');
    const ids = new Set();
    media.forEach((value, index) => {
        const item = record(value, `multicamSync.media[${index}]`);
        const id = string(item.id, `multicamSync.media[${index}].id`, 128);
        if (ids.has(id)) fail('multicamSync.media', 'Doppelte Medien-IDs sind nicht erlaubt.');
        ids.add(id);
        validateLocalMediaPath(item.path, `multicamSync.media[${index}].path`);
        const recordedAt = string(item.recordedAt, `multicamSync.media[${index}].recordedAt`, 64);
        if (!Number.isFinite(Date.parse(recordedAt))) fail(`multicamSync.media[${index}].recordedAt`, 'Ungültiger Aufnahmezeitpunkt.');
        finite(item.durationSeconds, `multicamSync.media[${index}].durationSeconds`, 0, 24 * 60 * 60);
        boolean(item.hasAudio, `multicamSync.media[${index}].hasAudio`);
    });
    return request;
}

function validateMedia(value, index) {
    const item = record(value, `project.media[${index}]`);
    string(item.id, `project.media[${index}].id`, 128);
    validateLocalMediaPath(item.path, `project.media[${index}].path`);
    string(item.name, `project.media[${index}].name`, 260);
    enumeration(item.kind, `project.media[${index}].kind`, new Set(['video', 'audio']));
    finite(item.durationSeconds, `project.media[${index}].durationSeconds`, 0, 24 * 60 * 60);
    nullableFinite(item.width, `project.media[${index}].width`, 1, 16384, true);
    nullableFinite(item.height, `project.media[${index}].height`, 1, 16384, true);
    nullableFinite(item.fps, `project.media[${index}].fps`, 1, 240);
    string(item.codec, `project.media[${index}].codec`, 64);
    boolean(item.hasAudio, `project.media[${index}].hasAudio`);
    finite(item.sizeBytes, `project.media[${index}].sizeBytes`, 0, Number.MAX_SAFE_INTEGER, true);
    nullableFinite(item.bitDepth, `project.media[${index}].bitDepth`, 1, 32, true);
}

function validatePoint(value, location) {
    const point = record(value, location);
    finite(point.frame, `${location}.frame`, 0, 1_000_000_000, true);
    finite(point.x, `${location}.x`, 0, 1);
    finite(point.y, `${location}.y`, 0, 1);
}

export function validateProject(projectValue) {
    const project = record(projectValue, 'project');
    finite(project.schemaVersion, 'project.schemaVersion', 1, 100, true);
    const settings = record(project.settings, 'project.settings');
    string(settings.course, 'project.settings.course', 200, true);
    finite(settings.holes, 'project.settings.holes', 1, 18, true);
    if (![9, 18].includes(settings.holes)) fail('project.settings.holes', 'Nur 9 oder 18 Löcher sind erlaubt.');
    if (settings.frameRate !== undefined && ![30, 60].includes(settings.frameRate)) fail('project.settings.frameRate', 'Nur 30 oder 60 fps sind erlaubt.');
    const players = array(settings.players, 'project.settings.players', limits.players);
    const playerIds = new Set(players.map((value, index) => {
        const player = record(value, `project.settings.players[${index}]`);
        string(player.name, `project.settings.players[${index}].name`, 100);
        return string(player.id, `project.settings.players[${index}].id`, 128);
    }));
    if (playerIds.size !== players.length) fail('project.settings.players', 'Doppelte Spieler-IDs sind nicht erlaubt.');

    const media = array(project.media, 'project.media', limits.media);
    media.forEach(validateMedia);
    const mediaIds = new Set(media.map((item) => item.id));
    if (mediaIds.size !== media.length) fail('project.media', 'Doppelte Medien-IDs sind nicht erlaubt.');

    const groups = array(project.groups, 'project.groups', limits.groups);
    const groupMediaIds = new Map();
    const groupIds = new Set(groups.map((value, index) => {
        const group = record(value, `project.groups[${index}]`);
        const id = string(group.id, `project.groups[${index}].id`, 128);
        const ids = uniqueStrings(group.mediaIds, `project.groups[${index}].mediaIds`, limits.media);
        if (ids.some((mediaId) => !mediaIds.has(mediaId))) fail(`project.groups[${index}].mediaIds`, 'Unbekannte Medien-ID.');
        if (group.syncStatus !== undefined) enumeration(group.syncStatus, `project.groups[${index}].syncStatus`, new Set(['timestamp-only', 'manual', 'audio']));
        if (group.syncOffsetsSeconds !== undefined) {
            const offsets = record(group.syncOffsetsSeconds, `project.groups[${index}].syncOffsetsSeconds`);
            const entries = Object.entries(offsets);
            entries.forEach(([mediaId, seconds]) => {
                string(mediaId, `project.groups[${index}].syncOffsetsSeconds`, 128);
                if (!ids.includes(mediaId)) fail(`project.groups[${index}].syncOffsetsSeconds.${mediaId}`, 'Kamera gehört nicht zur Multicam-Gruppe.');
                finite(seconds, `project.groups[${index}].syncOffsetsSeconds.${mediaId}`, -3600, 3600);
            });
            if (entries.length > ids.length) fail(`project.groups[${index}].syncOffsetsSeconds`, 'Zu viele Kamera-Versätze.');
        }
        groupMediaIds.set(id, new Set(ids));
        return id;
    }));
    if (groupIds.size !== groups.length) fail('project.groups', 'Doppelte Gruppen-IDs sind nicht erlaubt.');

    const blocks = array(project.blocks, 'project.blocks', limits.blocks);
    const blockIds = new Set(blocks.map((value, index) => {
        const block = record(value, `project.blocks[${index}]`);
        const id = string(block.id, `project.blocks[${index}].id`, 128);
        finite(block.hole, `project.blocks[${index}].hole`, 1, settings.holes, true);
        if (!playerIds.has(block.playerId)) fail(`project.blocks[${index}].playerId`, 'Unbekannte Spieler-ID.');
        enumeration(block.type, `project.blocks[${index}].type`, blockTypes);
        string(block.label, `project.blocks[${index}].label`, 200, true);
        finite(block.order, `project.blocks[${index}].order`, 0, limits.blocks, true);
        uniqueStrings(block.sequenceIds, `project.blocks[${index}].sequenceIds`, limits.sequences);
        const details = record(block.details, `project.blocks[${index}].details`);
        nullableFinite(details.shotNumber, `project.blocks[${index}].details.shotNumber`, 1, 100, true);
        string(details.club, `project.blocks[${index}].details.club`, 100, true);
        nullableFinite(details.distanceMeters, `project.blocks[${index}].details.distanceMeters`, 0, 1000);
        string(details.result, `project.blocks[${index}].details.result`, 200, true);
        return id;
    }));
    if (blockIds.size !== blocks.length) fail('project.blocks', 'Doppelte Block-IDs sind nicht erlaubt.');

    const sequences = array(project.sequences, 'project.sequences', limits.sequences);
    const sequenceIds = new Set(sequences.map((value, index) => {
        const sequence = record(value, `project.sequences[${index}]`);
        const id = string(sequence.id, `project.sequences[${index}].id`, 128);
        enumeration(sequence.sourceType, `project.sequences[${index}].sourceType`, new Set(['media', 'group']));
        string(sequence.sourceId, `project.sequences[${index}].sourceId`, 128);
        const sources = sequence.sourceType === 'media' ? mediaIds : groupIds;
        if (!sources.has(sequence.sourceId)) fail(`project.sequences[${index}].sourceId`, 'Unbekannte Quelle.');
        finite(sequence.inFrame, `project.sequences[${index}].inFrame`, 0, 1_000_000_000, true);
        finite(sequence.outFrame, `project.sequences[${index}].outFrame`, 1, 1_000_000_000, true);
        if (sequence.outFrame <= sequence.inFrame) fail(`project.sequences[${index}]`, 'outFrame muss hinter inFrame liegen.');
        finite(sequence.sourceFps, `project.sequences[${index}].sourceFps`, 1, 240);
        if ((sequence.outFrame - sequence.inFrame) / sequence.sourceFps > 6 * 60 * 60) fail(`project.sequences[${index}]`, 'Sequenz ist länger als sechs Stunden.');
        if (sequence.sourceType === 'group') {
            const allowedMediaIds = groupMediaIds.get(sequence.sourceId) ?? new Set();
            if (sequence.activeMediaId !== undefined) {
                const activeMediaId = string(sequence.activeMediaId, `project.sequences[${index}].activeMediaId`, 128);
                if (!allowedMediaIds.has(activeMediaId)) fail(`project.sequences[${index}].activeMediaId`, 'Kamera gehört nicht zur Multicam-Gruppe.');
            }
            if (sequence.multicamAngles !== undefined) {
                const angles = array(sequence.multicamAngles, `project.sequences[${index}].multicamAngles`, limits.media);
                const angleMediaIds = new Set();
                angles.forEach((value, angleIndex) => {
                    const angle = record(value, `project.sequences[${index}].multicamAngles[${angleIndex}]`);
                    const mediaId = string(angle.mediaId, `project.sequences[${index}].multicamAngles[${angleIndex}].mediaId`, 128);
                    if (!allowedMediaIds.has(mediaId)) fail(`project.sequences[${index}].multicamAngles[${angleIndex}].mediaId`, 'Kamera gehört nicht zur Multicam-Gruppe.');
                    if (angleMediaIds.has(mediaId)) fail(`project.sequences[${index}].multicamAngles`, 'Doppelte Kamera-Winkel sind nicht erlaubt.');
                    angleMediaIds.add(mediaId);
                    finite(angle.inFrame, `project.sequences[${index}].multicamAngles[${angleIndex}].inFrame`, 0, 1_000_000_000, true);
                    finite(angle.outFrame, `project.sequences[${index}].multicamAngles[${angleIndex}].outFrame`, 1, 1_000_000_000, true);
                    if (angle.outFrame <= angle.inFrame) fail(`project.sequences[${index}].multicamAngles[${angleIndex}]`, 'outFrame muss hinter inFrame liegen.');
                    finite(angle.sourceFps, `project.sequences[${index}].multicamAngles[${angleIndex}].sourceFps`, 1, 240);
                });
            }
        }
        if (!blockIds.has(sequence.targetBlockId)) fail(`project.sequences[${index}].targetBlockId`, 'Unbekannte Block-ID.');
        return id;
    }));
    if (sequenceIds.size !== sequences.length) fail('project.sequences', 'Doppelte Sequenz-IDs sind nicht erlaubt.');
    blocks.forEach((block, index) => {
        if (block.sequenceIds.some((id) => !sequenceIds.has(id))) fail(`project.blocks[${index}].sequenceIds`, 'Unbekannte Sequenz-ID.');
    });

    array(project.overlays, 'project.overlays', limits.overlays).forEach((value, index) => {
        const overlay = record(value, `project.overlays[${index}]`);
        if (!sequenceIds.has(overlay.sequenceId)) fail(`project.overlays[${index}].sequenceId`, 'Unbekannte Sequenz-ID.');
        enumeration(overlay.type, `project.overlays[${index}].type`, overlayTypes);
        enumeration(overlay.position, `project.overlays[${index}].position`, overlayPositions);
        boolean(overlay.enabled, `project.overlays[${index}].enabled`);
        finite(overlay.startFrame, `project.overlays[${index}].startFrame`, 0, 1_000_000_000, true);
        finite(overlay.endFrame, `project.overlays[${index}].endFrame`, 0, 1_000_000_000, true);
        if (overlay.endFrame < overlay.startFrame) fail(`project.overlays[${index}]`, 'endFrame darf nicht vor startFrame liegen.');
    });

    array(project.shotTracers, 'project.shotTracers', limits.tracers).forEach((value, index) => {
        const tracer = record(value, `project.shotTracers[${index}]`);
        if (!sequenceIds.has(tracer.sequenceId)) fail(`project.shotTracers[${index}].sequenceId`, 'Unbekannte Sequenz-ID.');
        boolean(tracer.enabled, `project.shotTracers[${index}].enabled`);
        string(tracer.color, `project.shotTracers[${index}].color`, 16);
        finite(tracer.thickness, `project.shotTracers[${index}].thickness`, 0, 32);
        finite(tracer.glow, `project.shotTracers[${index}].glow`, 0, 100);
        finite(tracer.smoothing, `project.shotTracers[${index}].smoothing`, 0, 1);
        finite(tracer.tailLength, `project.shotTracers[${index}].tailLength`, 0, 1);
        nullableFinite(tracer.impactFrame, `project.shotTracers[${index}].impactFrame`, 0, 1_000_000_000, true);
        nullableFinite(tracer.endFrame, `project.shotTracers[${index}].endFrame`, 0, 1_000_000_000, true);
        nullableFinite(tracer.disappearFrame, `project.shotTracers[${index}].disappearFrame`, 0, 1_000_000_000, true);
        nullableFinite(tracer.occlusionStartFrame, `project.shotTracers[${index}].occlusionStartFrame`, 0, 1_000_000_000, true);
        nullableFinite(tracer.occlusionEndFrame, `project.shotTracers[${index}].occlusionEndFrame`, 0, 1_000_000_000, true);
        array(tracer.points, `project.shotTracers[${index}].points`, limits.tracerPoints).forEach((point, pointIndex) => validatePoint(point, `project.shotTracers[${index}].points[${pointIndex}]`));
        if (tracer.cameraLock !== null && tracer.cameraLock !== undefined) {
            const lock = record(tracer.cameraLock, `project.shotTracers[${index}].cameraLock`);
            finite(lock.referenceFrame, `project.shotTracers[${index}].cameraLock.referenceFrame`, 0, 1_000_000_000, true);
            finite(lock.targetFrame, `project.shotTracers[${index}].cameraLock.targetFrame`, 0, 1_000_000_000, true);
            const referencePoints = array(lock.referencePoints, `project.shotTracers[${index}].cameraLock.referencePoints`, 2);
            const targetPoints = array(lock.targetPoints, `project.shotTracers[${index}].cameraLock.targetPoints`, 2);
            if (referencePoints.length !== 2 || targetPoints.length !== 2) fail(`project.shotTracers[${index}].cameraLock`, 'Je zwei Referenz- und Zielpunkte erwartet.');
            referencePoints.forEach((point, pointIndex) => validatePoint({ ...point, frame: 0 }, `project.shotTracers[${index}].cameraLock.referencePoints[${pointIndex}]`));
            targetPoints.forEach((point, pointIndex) => validatePoint({ ...point, frame: 0 }, `project.shotTracers[${index}].cameraLock.targetPoints[${pointIndex}]`));
        }
    });

    const courseData = record(project.courseData, 'project.courseData');
    array(courseData.holes, 'project.courseData.holes', 18).forEach((value, index) => {
        const hole = record(value, `project.courseData.holes[${index}]`);
        finite(hole.number, `project.courseData.holes[${index}].number`, 1, settings.holes, true);
        finite(hole.par, `project.courseData.holes[${index}].par`, 1, 10, true);
        nullableFinite(hole.lengthMeters, `project.courseData.holes[${index}].lengthMeters`, 0, 2000);
    });
    array(project.playerScores, 'project.playerScores', settings.holes * limits.players).forEach((value, index) => {
        const score = record(value, `project.playerScores[${index}]`);
        finite(score.hole, `project.playerScores[${index}].hole`, 1, settings.holes, true);
        if (!playerIds.has(score.playerId)) fail(`project.playerScores[${index}].playerId`, 'Unbekannte Spieler-ID.');
        nullableFinite(score.strokes, `project.playerScores[${index}].strokes`, 1, 50, true);
    });
    return project;
}

export function validateExportRequest(requestValue) {
    const request = record(requestValue, 'request');
    const project = validateProject(request.project);
    enumeration(request.profile, 'request.profile', new Set(['source-matched', 'lossless-master']));
    const sequenceIds = uniqueStrings(request.sequenceIds, 'request.sequenceIds', limits.sequenceIds);
    const knownSequenceIds = new Set(project.sequences.map((sequence) => sequence.id));
    if (!sequenceIds.length) fail('request.sequenceIds', 'Mindestens eine Sequenz ist erforderlich.');
    if (sequenceIds.some((id) => !knownSequenceIds.has(id))) fail('request.sequenceIds', 'Unbekannte Sequenz-ID.');
    const totalDuration = project.sequences
        .filter((sequence) => sequenceIds.includes(sequence.id))
        .reduce((sum, sequence) => sum + (sequence.outFrame - sequence.inFrame) / sequence.sourceFps, 0);
    if (totalDuration > 24 * 60 * 60) fail('request.sequenceIds', 'Gesamtexport ist länger als 24 Stunden.');
    return request;
}

export function validateProbePaths(pathsValue) {
    return uniqueStrings(pathsValue, 'paths', 100).map((filePath, index) => validateLocalMediaPath(filePath, `paths[${index}]`));
}

export async function assertMediaFilesAreReadable(project, stat = async (filePath) => (await import('node:fs/promises')).stat(filePath)) {
    const paths = [...new Set(project.media.map((media) => validateLocalMediaPath(media.path)))];
    await Promise.all(paths.map(async (filePath) => {
        let info;
        try {
            info = await stat(filePath);
        } catch {
            fail('project.media', `Mediendatei ist nicht lesbar: ${path.basename(filePath)}`);
        }
        if (!info?.isFile()) fail('project.media', `Medienpfad ist keine Datei: ${path.basename(filePath)}`);
    }));
}

export function isTrustedAppUrl(candidate, productionUrl, developmentUrl) {
    try {
        const url = new URL(candidate);
        const production = new URL(productionUrl);
        if (url.protocol === 'file:' && url.href.split(/[?#]/, 1)[0] === production.href.split(/[?#]/, 1)[0]) return true;
        if (!developmentUrl) return false;
        const development = new URL(developmentUrl);
        const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
        return localHosts.has(development.hostname)
            && ['http:', 'https:'].includes(development.protocol)
            && url.origin === development.origin;
    } catch {
        return false;
    }
}
