import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, CircleDot, ExternalLink, GitPullRequest, RefreshCw, ShieldAlert, Wifi, WifiOff } from 'lucide-react';
import {
    buildAgentProgress, issueAgent, issueProgress, openApprovals, relatedPullRequests, statusLabel, weightedProgress,
    type AgentId, type DashboardSnapshot, type GitHubIssue, type GitHubPullRequest,
} from './dashboard';

const REPOSITORY = 'johannesstuck-eng/Golf-Studio';
const CACHE_KEY = 'cut18-agent-dashboard-v1';

async function githubRequest<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
        signal,
        headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(response.status === 403 ? 'GitHub-Limit erreicht. Der letzte Stand bleibt sichtbar.' : `GitHub antwortet mit Status ${response.status}.`);
    return response.json() as Promise<T>;
}

async function loadSnapshot(): Promise<DashboardSnapshot> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);
    try {
        const [issueItems, pullRequests] = await Promise.all([
            githubRequest<GitHubIssue[]>('issues?state=all&per_page=100&sort=updated&direction=desc', controller.signal),
            githubRequest<GitHubPullRequest[]>('pulls?state=all&per_page=100&sort=updated&direction=desc', controller.signal),
        ]);
        return { issues: issueItems.filter((issue) => !issue.pull_request), pullRequests, fetchedAt: new Date().toISOString() };
    } finally {
        window.clearTimeout(timeout);
    }
}

function readCache(): DashboardSnapshot | undefined {
    try {
        const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as DashboardSnapshot | null;
        return parsed && Array.isArray(parsed.issues) && Array.isArray(parsed.pullRequests) ? parsed : undefined;
    } catch { return undefined; }
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function ProgressBar({ value, color = '#baf44a', large = false }: { value: number; color?: string; large?: boolean }) {
    return <div className={`mission-progress ${large ? 'large' : ''}`} aria-label={`${value} Prozent`}>
        <i style={{ width: `${value}%`, backgroundColor: color }} />
    </div>;
}

function openGitHub(url: string) {
    if (window.golfStudio?.openExternal) void window.golfStudio.openExternal(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
}

function TaskRow({ issue, pullRequests }: { issue: GitHubIssue; pullRequests: GitHubPullRequest[] }) {
    const agent = issueAgent(issue);
    const progress = issueProgress(issue);
    const related = relatedPullRequests(issue, pullRequests);
    return <button className="mission-task-row" onClick={() => openGitHub(issue.html_url)}>
        <span className="task-number">#{issue.number}</span>
        <span className="task-main"><b>{issue.title.replace(/^\[P\d\](\[Approval\])?\s*/i, '')}</b><small>Aktualisiert {formatDate(issue.updated_at)}</small></span>
        <span className="task-agent" style={{ '--agent-color': agent.color } as CSSProperties}><i />{agent.name}</span>
        <span className={`task-status status-${statusLabel(issue).toLowerCase().replace(' ', '-')}`}>{statusLabel(issue)}</span>
        <span className="task-progress"><ProgressBar value={progress} color={agent.color} /><b>{progress}%</b></span>
        <span className="task-pr">{related.length ? <><GitPullRequest size={14} /> {related.map((pullRequest) => `#${pullRequest.number}`).join(', ')}</> : '–'}</span>
        <ExternalLink size={14} />
    </button>;
}

export function Dashboard({ onClose }: { onClose: () => void }) {
    const [snapshot, setSnapshot] = useState<DashboardSnapshot | undefined>(() => readCache());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [agentFilter, setAgentFilter] = useState<AgentId | 'all'>('all');

    const refresh = async () => {
        setLoading(true);
        setError('');
        try {
            const next = await loadSnapshot();
            setSnapshot(next);
            localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch (reason) {
            setError(reason instanceof DOMException && reason.name === 'AbortError' ? 'GitHub hat nicht rechtzeitig geantwortet.' : reason instanceof Error ? reason.message : 'Synchronisierung fehlgeschlagen.');
        } finally { setLoading(false); }
    };

    useEffect(() => {
        void refresh();
        const interval = window.setInterval(() => void refresh(), 5 * 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const issues = snapshot?.issues ?? [];
    const agentProgress = useMemo(() => buildAgentProgress(issues), [issues]);
    const projectProgress = useMemo(() => weightedProgress(issues), [issues]);
    const approvals = useMemo(() => openApprovals(issues), [issues]);
    const filteredIssues = useMemo(() => issues
        .filter((issue) => agentFilter === 'all' || issueAgent(issue).id === agentFilter)
        .sort((left, right) => Number(left.state === 'closed') - Number(right.state === 'closed') || right.updated_at.localeCompare(left.updated_at)), [issues, agentFilter]);
    const openCount = issues.filter((issue) => issue.state === 'open').length;
    const activeCount = issues.filter((issue) => ['In Arbeit', 'Im Review'].includes(statusLabel(issue))).length;
    const openPrs = snapshot?.pullRequests.filter((pullRequest) => pullRequest.state === 'open').length ?? 0;

    return <main className="mission-shell">
        <header className="mission-header">
            <div><button className="mission-back" onClick={onClose}><ArrowLeft size={17} /> Zurück zu CUT18</button><div className="mission-title"><span><Bot size={22} /></span><div><small>GITHUB-SYNCHRONISIERT</small><h1>Mission Control</h1></div></div></div>
            <div className="mission-sync">
                <div className={error ? 'offline' : ''}>{error ? <WifiOff size={15} /> : <Wifi size={15} />}<span>{error || (snapshot ? `Stand ${formatDate(snapshot.fetchedAt)}` : 'Noch nicht synchronisiert')}</span></div>
                <button onClick={() => void refresh()} disabled={loading}><RefreshCw size={16} className={loading ? 'spinning' : ''} /> {loading ? 'Synchronisiere …' : 'Jetzt aktualisieren'}</button>
            </div>
        </header>

        <section className="mission-content">
            <section className="project-overview">
                <div className="project-progress-copy"><div className="eyebrow"><span /> PROJEKTSTATUS</div><h2>CUT18 Gesamtfortschritt</h2><p>Gewichteter Fortschritt aller GitHub-Tasks. Er misst die Umsetzung des aktuellen Taskbestands – nicht den späteren Marktwert.</p></div>
                <div className="project-progress-value"><strong>{projectProgress}<small>%</small></strong><ProgressBar value={projectProgress} large /><span>{issues.length} Tasks · automatisch aus GitHub berechnet</span></div>
                <div className="project-stats">
                    <div><CircleDot size={18} /><span>Offene Tasks</span><b>{openCount}</b></div>
                    <div><RefreshCw size={18} /><span>Aktiv / Review</span><b>{activeCount}</b></div>
                    <div><GitPullRequest size={18} /><span>Offene PRs</span><b>{openPrs}</b></div>
                    <div className={approvals.length ? 'attention' : ''}><ShieldAlert size={18} /><span>Freigaben</span><b>{approvals.length}</b></div>
                </div>
            </section>

            <div className="mission-section-heading"><div><span>AGENTEN</span><h2>Verantwortung und Fortschritt</h2></div><p>Fortschritt = statusgewichtete Taskpunkte pro Agent.</p></div>
            <section className="agent-grid">
                {agentProgress.map((agent) => <button className={`agent-card ${agentFilter === agent.id ? 'selected' : ''}`} key={agent.id} onClick={() => setAgentFilter((current) => current === agent.id ? 'all' : agent.id)}>
                    <header><span className="agent-avatar" style={{ color: agent.color, borderColor: `${agent.color}55`, background: `${agent.color}12` }}>{agent.shortName}</span><div><h3>{agent.name}</h3><p>{agent.mission}</p></div><strong style={{ color: agent.color }}>{agent.progress}%</strong></header>
                    <ProgressBar value={agent.progress} color={agent.color} />
                    <footer><span>{agent.issues.length} Tasks</span><span><CheckCircle2 size={12} /> {agent.done} fertig</span><span><CircleDot size={12} /> {agent.active} aktiv</span>{agent.blocked > 0 && <span className="blocked"><AlertTriangle size={12} /> {agent.blocked}</span>}</footer>
                </button>)}
            </section>

            {approvals.length > 0 && <section className="approval-panel"><header><div><ShieldAlert size={19} /><div><span>JOHANNES</span><h2>Offene Freigaben</h2></div></div><b>{approvals.length}</b></header><div>{approvals.map((issue) => <button key={issue.number} onClick={() => openGitHub(issue.html_url)}><span>#{issue.number}</span><b>{issue.title.replace(/^\[P\d\](\[Approval\])?\s*/i, '')}</b><ExternalLink size={14} /></button>)}</div></section>}

            <section className="task-board">
                <header><div><span>TASKS</span><h2>{agentFilter === 'all' ? 'Alle Agenten' : agentProgress.find((agent) => agent.id === agentFilter)?.name}</h2></div>{agentFilter !== 'all' && <button onClick={() => setAgentFilter('all')}>Filter entfernen</button>}</header>
                <div className="task-table-head"><span>ID</span><span>Aufgabe</span><span>Agent</span><span>Status</span><span>Fortschritt</span><span>PR</span><span /></div>
                <div className="task-list">{filteredIssues.map((issue) => <TaskRow issue={issue} pullRequests={snapshot?.pullRequests ?? []} key={issue.number} />)}
                    {!filteredIssues.length && <div className="mission-empty">{loading ? 'GitHub-Daten werden geladen …' : 'Für diesen Agenten sind noch keine Tasks angelegt.'}</div>}
                </div>
            </section>
        </section>
    </main>;
}
