const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('@ffprobe-installer/ffprobe').path;

const directory = path.join(__dirname, 'fixed-editorial-smoke');
fs.rmSync(directory, { recursive: true, force: true });
fs.mkdirSync(directory, { recursive: true });

function run(program, args) {
    const result = spawnSync(program, args, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(result.stderr || `${program} failed`);
    return result.stdout;
}

try {
    for (let index = 0; index < 2; index += 1) {
        run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=30:duration=1`, '-f', 'lavfi', '-i', `sine=frequency=${660 + index * 220}:duration=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(directory, `input${index}.mp4`)]);
    }
    const font = 'C\\:/Windows/Fonts/segoeui.ttf';
    const graph = [
        `[0:v]scale=640:360,fps=30,setpts=PTS-STARTPTS,drawbox=x=22:y=18:w=182:h=34:color=0x0a100d@0.88:t=fill,drawtext=fontfile='${font}':text='GRANT':x=34:y=27:fontsize=14:fontcolor=white:expansion=none,fade=t=out:st=0.666667:d=0.333333,format=pix_fmts=yuv420p[v0]`,
        `[0:a]aresample=48000,apad,atrim=duration=1,asetpts=PTS-STARTPTS,afade=t=out:st=0.8:d=0.2,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a0]`,
        `color=c=0x030504:s=640x360:r=30:d=1.8,drawtext=fontfile='${font}':text='PINE HILLS':x=(w-text_w)/2:y=h*0.37:fontsize=14:fontcolor=0x89958d:expansion=none,drawtext=fontfile='${font}':text='HOLE 2':x=(w-text_w)/2:y=h*0.425:fontsize=42:fontcolor=white:expansion=none,drawtext=fontfile='${font}':text='PAR 4  385 M':x=(w-text_w)/2:y=h*0.56:fontsize=18:fontcolor=0xc8ff42:expansion=none,fade=t=in:st=0:d=0.25,fade=t=out:st=1.5:d=0.3,format=pix_fmts=yuv420p[vh0]`,
        `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=1.8,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[ah0]`,
        `[1:v]scale=640:360,fps=30,setpts=PTS-STARTPTS,drawbox=x=22:y=18:w=182:h=34:color=0x0a100d@0.88:t=fill,drawtext=fontfile='${font}':text='GRANT':x=34:y=27:fontsize=14:fontcolor=white:expansion=none,fade=t=in:st=0:d=0.333333,format=pix_fmts=yuv420p[v1]`,
        `[1:a]aresample=48000,apad,atrim=duration=1,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.2,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a1]`,
        `[v0][a0][vh0][ah0][v1][a1]concat=n=3:v=1:a=1[vout][aout]`,
    ].join(';\n');
    const filterPath = path.join(directory, 'filter.txt');
    fs.writeFileSync(filterPath, graph);
    const output = path.join(directory, 'output.mp4');
    run(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', path.join(directory, 'input0.mp4'), '-i', path.join(directory, 'input1.mp4'), '-filter_complex_script', filterPath, '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-crf', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', output]);
    const probe = JSON.parse(run(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,r_frame_rate', '-show_entries', 'format=duration', '-of', 'json', output]));
    if (Math.abs(Number(probe.format.duration) - 3.8) > .08) throw new Error(`Unexpected duration ${probe.format.duration}`);
    console.log(JSON.stringify(probe, null, 2));
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
