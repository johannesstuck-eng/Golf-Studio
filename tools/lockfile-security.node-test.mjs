import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

function versionParts(value) {
    return String(value).split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function atLeast(value, minimum) {
    const left = versionParts(value);
    const right = versionParts(minimum);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
        if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
    }
    return true;
}

test('lockfile keeps Vitest and nested Vite outside known vulnerable ranges', async () => {
    const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
    assert.equal(lock.packages[''].devDependencies.vitest, '^3.2.6');
    assert.equal(lock.packages['node_modules/vitest'].version, '3.2.6');

    for (const [location, entry] of Object.entries(lock.packages)) {
        if (location.endsWith('/vitest') || location === 'node_modules/vitest') {
            assert.ok(atLeast(entry.version, '3.2.6'), `${location} uses vulnerable Vitest ${entry.version}`);
        }
        if (location.endsWith('/vite') || location === 'node_modules/vite') {
            assert.ok(atLeast(entry.version, '6.4.3'), `${location} uses vulnerable Vite ${entry.version}`);
        }
    }
});
