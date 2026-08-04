import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReport, extractSection, issuePriority, rankIssues, uncheckedRoadmapItems } from './orchestrator-core.mjs';

test('extractSection reads only the requested section', () => {
    const markdown = '# Status\n\n## Engpass\n\nImport ist instabil.\n\n## Danach\n\nExport.';
    assert.equal(extractSection(markdown, 'Engpass'), 'Import ist instabil.');
});
test('issues are ranked by explicit priority and number', () => {
    const issues = [
        { number: 3, title: 'P2 Timeline', state: 'open' },
        { number: 2, title: 'Export', labels: [{ name: 'P0' }], state: 'open' },
        { number: 1, title: 'P1 Import', state: 'open' },
        { number: 4, title: 'PR', state: 'open', pull_request: {} },
    ];
    assert.deepEqual(rankIssues(issues).map((issue) => issue.number), [2, 1, 3]);
    assert.equal(issuePriority(issues[1]), 'P0');
});

test('uncheckedRoadmapItems excludes completed work', () => {
    assert.deepEqual(uncheckedRoadmapItems('- [x] fertig\n- [ ] offen'), ['offen']);
});

test('buildReport returns three recommendations and approvals', () => {
    const report = buildReport({
        status: '## Wichtigster aktueller Engpass\n\nDer Kernpfad.\n\n## Offene Freigaben\n\n- Testmatrix wählen',
        roadmap: '- [ ] Roadmap-Aufgabe',
        issues: [
            { number: 1, title: 'P0 Import', state: 'open' },
            { number: 2, title: 'P1 Wiedergabe', state: 'open' },
        ],
        generatedAt: new Date('2026-08-04T00:00:00.000Z'),
    });
    assert.match(report, /Der Kernpfad/);
    assert.match(report, /3\. \*\*Roadmap: Roadmap-Aufgabe\*\*/);
    assert.match(report, /Testmatrix wählen/);
    assert.match(report, /2026-08-04T00:00:00.000Z/);
});
