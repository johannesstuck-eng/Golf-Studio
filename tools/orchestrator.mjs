import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './orchestrator-core.mjs';

function option(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readIssues(root) {
    const snapshot = option('--issues');
    if (snapshot) {
        const parsed = JSON.parse(await readFile(path.resolve(root, snapshot), 'utf8'));
        return Array.isArray(parsed) ? parsed : parsed.items ?? parsed.issues ?? [];
    }

    const repository = option('--repo') ?? 'johannesstuck-eng/Golf-Studio';
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Ungültiges Repository. Erwartet wird owner/name.');
    const response = await fetch(`https://api.github.com/repos/${repository}/issues?state=open&per_page=100`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'golf-studio-orchestrator' },
    });
    if (!response.ok) throw new Error(`GitHub-Issues konnten nicht gelesen werden (${response.status}). Nutze alternativ --issues <datei.json>.`);
    return (await response.json()).filter((issue) => !issue.pull_request);
}

async function main() {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const [status, roadmap, issues] = await Promise.all([
        readFile(path.join(root, 'docs', 'product-status.md'), 'utf8'),
        readFile(path.join(root, 'docs', 'roadmap.md'), 'utf8'),
        readIssues(root),
    ]);
    const report = buildReport({ status, roadmap, issues });
    if (process.argv.includes('--stdout')) {
        process.stdout.write(report);
        return;
    }
    const output = path.resolve(root, option('--output') ?? 'reports/orchestrator-report.md');
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, report, 'utf8');
    process.stdout.write(`Bericht geschrieben: ${path.relative(root, output)}\n`);
}

main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
