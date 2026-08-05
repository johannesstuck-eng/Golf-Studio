export type AgentId = 'orchestrator' | 'product' | 'engineering' | 'qa' | 'growth' | 'social-platforms' | 'content-studio' | 'beta-growth';

export interface AgentDefinition {
    id: AgentId;
    name: string;
    shortName: string;
    mission: string;
    label: string;
    color: string;
}

export interface GitHubLabel { name: string }

export interface GitHubIssue {
    number: number;
    title: string;
    body?: string | null;
    state: 'open' | 'closed';
    html_url: string;
    updated_at: string;
    labels: Array<GitHubLabel | string>;
    pull_request?: unknown;
}

export interface GitHubPullRequest {
    number: number;
    title: string;
    body?: string | null;
    state: 'open' | 'closed';
    draft?: boolean;
    merged_at?: string | null;
    html_url: string;
    updated_at: string;
}

export interface DashboardSnapshot {
    issues: GitHubIssue[];
    pullRequests: GitHubPullRequest[];
    fetchedAt: string;
}

export interface AgentProgress extends AgentDefinition {
    issues: GitHubIssue[];
    progress: number;
    done: number;
    active: number;
    blocked: number;
    effort: number;
}

export const AGENTS: AgentDefinition[] = [
    { id: 'orchestrator', name: 'Orchestrator', shortName: 'OR', mission: 'Prioritäten, Engpässe und Freigaben koordinieren', label: 'agent:orchestrator', color: '#baf44a' },
    { id: 'product', name: 'Product', shortName: 'PR', mission: 'Nutzerproblem, Scope und Produktentscheidungen schärfen', label: 'agent:product', color: '#f5c451' },
    { id: 'engineering', name: 'Engineering', shortName: 'EN', mission: 'Desktop-App und lokale Medienpipeline umsetzen', label: 'agent:engineering', color: '#5ad6c7' },
    { id: 'qa', name: 'QA', shortName: 'QA', mission: 'Qualität, Testabdeckung und Release-Risiken absichern', label: 'agent:qa', color: '#8ea6ff' },
    { id: 'growth', name: 'Growth', shortName: 'GR', mission: 'Positionierung und Markteintritt koordinieren', label: 'agent:growth', color: '#f08cff' },
    { id: 'social-platforms', name: 'Social Platforms', shortName: 'SP', mission: 'Plattformmix und Distribution planen', label: 'agent:social-platforms', color: '#ff8f70' },
    { id: 'content-studio', name: 'Content Studio', shortName: 'CS', mission: 'Anonymen englischen Content produzieren', label: 'agent:content-studio', color: '#ffcf75' },
    { id: 'beta-growth', name: 'Beta Growth', shortName: 'BG', mission: 'Beta-Warteliste und Lernschleifen vorbereiten', label: 'agent:beta-growth', color: '#72d7ff' },
];

const statusProgress: Record<string, number> = {
    'status:backlog': 0,
    'status:planned': 15,
    'status:blocked': 30,
    'status:in-progress': 55,
    'status:review': 85,
    'status:done': 100,
};

export function labelNames(issue: GitHubIssue): string[] {
    return issue.labels.map((label) => typeof label === 'string' ? label : label.name).map((label) => label.toLowerCase());
}

function metadataValue(issue: GitHubIssue, key: 'agent' | 'status' | 'effort'): string | undefined {
    const block = issue.body?.match(/<!--\s*cut18-dashboard([\s\S]*?)-->/i)?.[1];
    return block?.match(new RegExp(`^\\s*${key}:\\s*([^\\r\\n]+)`, 'im'))?.[1]?.trim().toLowerCase();
}

export function issueStatus(issue: GitHubIssue): keyof typeof statusProgress {
    if (issue.state === 'closed') return 'status:done';
    const explicit = labelNames(issue).find((label) => label in statusProgress) ?? metadataValue(issue, 'status');
    const normalized = explicit?.startsWith('status:') ? explicit : explicit ? `status:${explicit}` : undefined;
    return normalized && normalized in statusProgress ? normalized as keyof typeof statusProgress : 'status:planned';
}

export function issueProgress(issue: GitHubIssue): number {
    return issue.state === 'closed' ? 100 : statusProgress[issueStatus(issue)];
}

export function issueEffort(issue: GitHubIssue): number {
    const effort = labelNames(issue).find((label) => /^effort:(1|2|3|5|8)$/.test(label));
    const value = effort?.split(':')[1] ?? metadataValue(issue, 'effort');
    return value && /^(1|2|3|5|8)$/.test(value) ? Number(value) : 3;
}

export function issueAgent(issue: GitHubIssue): AgentDefinition {
    const labels = labelNames(issue);
    const explicit = AGENTS.find((agent) => labels.includes(agent.label));
    if (explicit) return explicit;
    const metadataAgent = metadataValue(issue, 'agent');
    const metadataOwner = AGENTS.find((agent) => agent.id === metadataAgent || agent.label === `agent:${metadataAgent}`);
    if (metadataOwner) return metadataOwner;
    const value = issue.title.toLowerCase();
    if (/social|instagram|youtube|tiktok|linkedin|plattform/.test(value)) return AGENTS.find((agent) => agent.id === 'social-platforms')!;
    if (/content|post|video-idee|redaktions|creative/.test(value)) return AGENTS.find((agent) => agent.id === 'content-studio')!;
    if (/beta|warteliste|waitlist|interview|feedback/.test(value)) return AGENTS.find((agent) => agent.id === 'beta-growth')!;
    if (/landingpage|positionierung|growth|markt|launch/.test(value)) return AGENTS.find((agent) => agent.id === 'growth')!;
    if (/test|validier|qualität|qa|reproduzierbar/.test(value)) return AGENTS.find((agent) => agent.id === 'qa')!;
    if (/scope|telemetrie|datenschutz|workflow|produkt/.test(value)) return AGENTS.find((agent) => agent.id === 'product')!;
    return AGENTS.find((agent) => agent.id === 'engineering')!;
}

export function weightedProgress(issues: GitHubIssue[]): number {
    const totals = issues.reduce((sum, issue) => ({
        earned: sum.earned + issueProgress(issue) * issueEffort(issue),
        effort: sum.effort + issueEffort(issue),
    }), { earned: 0, effort: 0 });
    return totals.effort ? Math.round(totals.earned / totals.effort) : 0;
}

export function buildAgentProgress(issues: GitHubIssue[]): AgentProgress[] {
    return AGENTS.map((agent) => {
        const owned = issues.filter((issue) => issueAgent(issue).id === agent.id);
        return {
            ...agent,
            issues: owned,
            progress: weightedProgress(owned),
            done: owned.filter((issue) => issueProgress(issue) === 100).length,
            active: owned.filter((issue) => ['status:in-progress', 'status:review'].includes(issueStatus(issue))).length,
            blocked: owned.filter((issue) => issueStatus(issue) === 'status:blocked').length,
            effort: owned.reduce((sum, issue) => sum + issueEffort(issue), 0),
        };
    });
}

export function openApprovals(issues: GitHubIssue[]): GitHubIssue[] {
    return issues.filter((issue) => issue.state === 'open' && (labelNames(issue).includes('approval') || /\[approval\]|freigabe/i.test(`${issue.title} ${issue.body ?? ''}`)));
}

export function relatedPullRequests(issue: GitHubIssue, pullRequests: GitHubPullRequest[]): GitHubPullRequest[] {
    const reference = new RegExp(`(?:#|issues/)${issue.number}(?!\\d)`);
    return pullRequests.filter((pullRequest) => reference.test(`${pullRequest.title} ${pullRequest.body ?? ''}`));
}

export function statusLabel(issue: GitHubIssue): string {
    const labels: Record<keyof typeof statusProgress, string> = {
        'status:backlog': 'Backlog',
        'status:planned': 'Geplant',
        'status:blocked': 'Blockiert',
        'status:in-progress': 'In Arbeit',
        'status:review': 'Im Review',
        'status:done': 'Erledigt',
    };
    return labels[issueStatus(issue)];
}
