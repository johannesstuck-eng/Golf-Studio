const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('@ffprobe-installer/ffprobe').path;

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-camera-lock-'));
const filterPath = path.join(directory, 'filter.txt');
const outputPath = path.join(directory, 'output.mp4');
const filters = ['[0:v]format=yuv420p'];

// A representative locked tracer: the scene pans 120 px while the short tail is visible.
// Small temporal slices exercise the same fixed-position drawbox strategy as the app export.
for (let sample = 0; sample < 90; sample += 1) {
    const progress = sample / 89;
    const worldX = 130 + progress * 350;
    const worldY = 285 - Math.sin(progress * Math.PI) * 210;
    const appears = .15 + progress * 1.85;
    const disappears = Math.min(2.35, appears + .24);
    for (let slice = 0; slice < 2; slice += 1) {
        const start = appears + (disappears - appears) * slice / 2;
        const end = appears + (disappears - appears) * (slice + 1) / 2;
        const midpoint = (start + end) / 2;
        const cameraX = 120 * Math.min(1, Math.max(0, (midpoint - .15) / 1.85));
        const x = Math.round(worldX + cameraX);
        const y = Math.round(worldY);
        const enable = `between(t\\,${start.toFixed(5)}\\,${end.toFixed(5)})`;
        filters.push(`drawbox=x=${x - 5}:y=${y - 5}:w=10:h=10:color=0xc8ff42@0.18:t=fill:enable='${enable}'`);
        filters.push(`drawbox=x=${x - 2}:y=${y - 2}:w=4:h=4:color=0xc8ff42@0.96:t=fill:enable='${enable}'`);
    }
}
filters.push('null[vout]');
fs.writeFileSync(filterPath, filters.join(','));

try {
    const encode = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=2.5', '-filter_complex_script', filterPath, '-map', '[vout]', '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', outputPath], { encoding: 'utf8', windowsHide: true });
    if (encode.status !== 0) throw new Error(encode.stderr || `FFmpeg failed with ${encode.status}`);
    const probe = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height', '-show_entries', 'format=duration', '-of', 'json', outputPath], { encoding: 'utf8', windowsHide: true });
    if (probe.status !== 0) throw new Error(probe.stderr || `ffprobe failed with ${probe.status}`);
    const metadata = JSON.parse(probe.stdout);
    if (Math.abs(Number(metadata.format.duration) - 2.5) > .08) throw new Error(`Unexpected duration ${metadata.format.duration}`);
    console.log(`CAMERA_LOCK_EXPORT_OK duration=${metadata.format.duration}s size=${fs.statSync(outputPath).size}`);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
