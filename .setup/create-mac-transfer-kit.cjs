const { ZipArchive } = require('archiver');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const outputDirectory = path.join(root, 'transfer');
const outputPath = path.join(outputDirectory, 'CUT18-Mac-Apple-Silicon-Buildpaket.zip');
const prefix = 'CUT18 Mac Buildpaket';

fs.mkdirSync(outputDirectory, { recursive: true });
const output = fs.createWriteStream(outputPath);
const archive = new ZipArchive({ zlib: { level: 9 } });

output.on('close', () => {
    console.log(`${outputPath}\n${archive.pointer()} bytes`);
});
archive.on('warning', (error) => {
    if (error.code !== 'ENOENT') throw error;
});
archive.on('error', (error) => { throw error; });
archive.pipe(output);

const files = ['package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'README.md'];
for (const file of files) archive.file(path.join(root, file), { name: `${prefix}/${file}`, mode: 0o644 });
archive.directory(path.join(root, 'src'), `${prefix}/src`);
archive.directory(path.join(root, 'dist-electron'), `${prefix}/dist-electron`);
archive.file(path.join(root, 'mac-build', 'ZUERST-LESEN.html'), { name: `${prefix}/ZUERST-LESEN.html`, mode: 0o644 });
archive.file(path.join(root, 'mac-build', 'MAC-APP-ERSTELLEN.command'), { name: `${prefix}/MAC-APP-ERSTELLEN.command`, mode: 0o755 });

archive.finalize();
