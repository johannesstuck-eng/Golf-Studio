import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import { prepareRenderPlanExport } from '../dist-electron/render-plan-export.js';
import { buildRenderPlanGraph, renderPlanInputArguments } from '../dist-electron/render-plan-graph.js';

const directory = mkdtempSync(path.join(tmpdir(), 'cut18-render-plan-smoke-'));
try {
    const source = (name, color, frequency) => {
        const output = path.join(directory, `${name}.mp4`);
        execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=30:d=3`, '-f', 'lavfi', '-i', `sine=frequency=${frequency}:sample_rate=48000:duration=3`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', output], { windowsHide: true });
        return { id: name, path: output, name, kind: 'video', durationSeconds: 3, width: 320, height: 180, fps: 30, codec: 'h264', hasAudio: true, bitDepth: 8 };
    };
    const a = source('a', 'red', 440);
    const b = source('b', 'blue', 880);
    const project = {
        settings: { frameRate: 30 }, media: [a, b], groups: [{ id: 'g', mediaIds: ['a', 'b'] }],
        blocks: [{ id: 'block', hole: 1, playerId: 'p' }], shotTracers: [],
        sequences: [{
            id: 'moment', sourceType: 'group', sourceId: 'g', targetBlockId: 'block', inFrame: 0, outFrame: 90, sourceFps: 30,
            multicamAngles: [{ mediaId: 'a', inFrame: 0, outFrame: 90, sourceFps: 30 }, { mediaId: 'b', inFrame: 0, outFrame: 90, sourceFps: 30 }],
            videoCuts: [{ id: 'a1', mediaId: 'a', startUs: 0, endUs: 1_000_000 }, { id: 'b1', mediaId: 'b', startUs: 1_000_000, endUs: 2_000_000 }, { id: 'a2', mediaId: 'a', startUs: 2_000_000, endUs: 3_000_000 }],
            audioPlan: { mode: 'master', mediaId: 'a', offsetUs: 0, gainDb: 0 },
        }],
    };
    const prepared = prepareRenderPlanExport(project, ['moment']);
    const graph = buildRenderPlanGraph(prepared, { width: 320, height: 180, fps: 30, pixelFormat: 'yuv420p' });
    const filterPath = path.join(directory, 'filter.txt');
    const outputPath = path.join(directory, 'rendered.mp4');
    writeFileSync(filterPath, graph.join(';\n'), 'utf8');
    execFileSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', ...renderPlanInputArguments(prepared), '-filter_complex_script', filterPath, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', outputPath], { windowsHide: true });
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', outputPath, '-f', 'null', '-'], { windowsHide: true });
    process.stdout.write('Canonical A-B-A render plan smoke test passed.\n');
} finally {
    rmSync(directory, { recursive: true, force: true });
}
