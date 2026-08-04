const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'golf-fast-export-'));
const filterPath = path.join(directory, 'filter.txt');
const outputPath = path.join(directory, 'output.mp4');
const filters = ['[0:v]format=yuv420p'];

for (let index = 0; index < 140; index += 1) {
    const progress = index / 139;
    const x = Math.round(180 + progress * 1040);
    const y = Math.round(850 - Math.sin(progress * Math.PI) * 650);
    const visibleAt = .2 + progress * 1.8;
    const tailEnd = index === 139 ? 2.8 : .2 + Math.min(1, progress + .16) * 1.8;
    const enable = `between(t\\,${visibleAt.toFixed(5)}\\,${tailEnd.toFixed(5)})`;
    filters.push(`drawbox=x=${x - 6}:y=${y - 6}:w=12:h=12:color=0xc8ff42@0.12:t=fill:enable='${enable}'`);
    filters.push(`drawbox=x=${x - 3}:y=${y - 3}:w=6:h=6:color=0xc8ff42@0.96:t=fill:enable='${enable}'`);
}
filters.push('null[vout]');
fs.writeFileSync(filterPath, filters.join(','));

try {
    const started = performance.now();
    const result = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3', '-filter_complex_script', filterPath, '-map', '[vout]', '-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '12', '-b:v', '0', '-pix_fmt', 'yuv420p', outputPath], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0)
        throw new Error(result.stderr || `FFmpeg failed with ${result.status}`);
    const elapsed = (performance.now() - started) / 1000;
    console.log(`FAST_EXPORT_OK elapsed=${elapsed.toFixed(2)}s media=3.00s factor=${(3 / elapsed).toFixed(2)}x size=${fs.statSync(outputPath).size}`);
}
finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
