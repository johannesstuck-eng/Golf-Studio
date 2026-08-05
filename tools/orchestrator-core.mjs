const PRIORITY_WEIGHT = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function extractSection(markdown, heading) {
    const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = markdown.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'mi'));
    if (!match) return '';
    return match[1].trim();
}

export function issuePriority(issue) {
    const labels = (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name ?? '');
    const haystack = `${issue.title ?? ''} ${issue.body ?? ''} ${labels.join(' ')}`;
    const match = haystack.match(/\bP([0-3])\b/i);
    return match ? `P${match[1]}`.toUpperCase() : 'P2';
}

export function rankIssues(issues) {
    return [...issues]
        .filter((issue) => !issue.pull_request && issue.state !== 'closed')
        .sort((left, right) => {
            const priority = PRIORITY_WEIGHT[issuePriority(left)] - PRIORITY_WEIGHT[issuePriority(right)];
            if (priority) return priority;
            return (left.number ?? Number.MAX_SAFE_INTEGER) - (right.number ?? Number.MAX_SAFE_INTEGER);
        });
}

export function uncheckedRoadmapItems(markdown) {
    return [...markdown.matchAll(/^\s*- \[ \]\s+(.+)$/gm)].map((match) => match[1].trim());
}

function cleanList(section) {
    return section
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*-\s*/, '').trim())
        .filter(Boolean);
}

export function buildReport({ status, roadmap, issues, generatedAt = new Date() }) {
    const bottleneck = extractSection(status, 'Wichtigster aktueller Engpass')
        || 'Kein Engpass ist im Produktstatus dokumentiert.';
    const approvals = cleanList(extractSection(status, 'Offene Freigaben'));
    const ranked = rankIssues(issues);
    const recommendations = ranked.slice(0, 3).map((issue) => ({
        title: issue.title,
        priority: issuePriority(issue),
        reference: issue.html_url ? `[#${issue.number}](${issue.html_url})` : issue.number ? `#${issue.number}` : 'lokal',
    }));
    const used = new Set(recommendations.map((item) => item.title));
    for (const item of uncheckedRoadmapItems(roadmap)) {
        if (recommendations.length >= 3) break;
        if (!used.has(item)) recommendations.push({ title: item, priority: 'Roadmap', reference: 'docs/roadmap.md' });
    }

    const nextTasks = recommendations.length
        ? recommendations.map((item, index) => `${index + 1}. **${item.priority}: ${item.title}** – ${item.reference}`).join('\n')
        : 'Keine offenen Aufgaben gefunden. Roadmap und Issues prüfen.';
    const approvalText = approvals.length ? approvals.map((item) => `- ${item}`).join('\n') : '- Keine offenen Freigaben dokumentiert.';

    return `# CUT18 – Orchestrator-Bericht

Erzeugt: ${generatedAt.toISOString()}

## Wichtigster Engpass

${bottleneck}

## Drei nächste empfohlene Aufgaben

${nextTasks}

## Offene Freigaben

${approvalText}

## Datengrundlage

- Produktstatus: \`docs/product-status.md\`
- Roadmap: \`docs/roadmap.md\`
- offene Issues gelesen: ${ranked.length}

## Grenzen

Dieser Bericht ist eine Empfehlung. Der Orchestrator hat keine Issues verändert, keinen Code gemergt und nichts veröffentlicht.
`;
}
