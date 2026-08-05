import { describe, expect, it } from 'vitest';
import { buildAgentProgress, issueAgent, issueEffort, issueProgress, openApprovals, relatedPullRequests, weightedProgress, type GitHubIssue } from './dashboard';

const issue = (overrides: Partial<GitHubIssue> = {}): GitHubIssue => ({
    number: 1,
    title: 'Task',
    state: 'open',
    html_url: 'https://github.com/johannesstuck-eng/Golf-Studio/issues/1',
    updated_at: '2026-08-05T12:00:00Z',
    labels: [],
    ...overrides,
});

describe('dashboard progress', () => {
    it('uses explicit GitHub labels for agent, status and effort', () => {
        const task = issue({ labels: [{ name: 'agent:product' }, { name: 'status:review' }, { name: 'effort:5' }] });
        expect(issueAgent(task).id).toBe('product');
        expect(issueProgress(task)).toBe(85);
        expect(issueEffort(task)).toBe(5);
    });

    it('reads machine metadata from an issue without changing its visible task copy', () => {
        const task = issue({ body: 'Visible task\n\n<!-- cut18-dashboard\nagent: growth\nstatus: in-progress\neffort: 5\n-->' });
        expect(issueAgent(task).id).toBe('growth');
        expect(issueProgress(task)).toBe(55);
        expect(issueEffort(task)).toBe(5);
    });

    it('always treats closed issues as complete', () => {
        expect(issueProgress(issue({ state: 'closed', labels: [{ name: 'status:blocked' }] }))).toBe(100);
    });

    it('calculates weighted project and agent progress', () => {
        const issues = [
            issue({ number: 1, state: 'closed', labels: [{ name: 'agent:engineering' }, { name: 'effort:5' }] }),
            issue({ number: 2, labels: [{ name: 'agent:engineering' }, { name: 'status:in-progress' }, { name: 'effort:3' }] }),
        ];
        expect(weightedProgress(issues)).toBe(83);
        expect(buildAgentProgress(issues).find((agent) => agent.id === 'engineering')).toMatchObject({ done: 1, active: 1, progress: 83 });
    });

    it('finds approvals and pull requests referencing an issue', () => {
        const approval = issue({ number: 10, title: '[Approval] Datenschutz entscheiden' });
        expect(openApprovals([approval])).toEqual([approval]);
        expect(relatedPullRequests(approval, [{ number: 18, title: 'Implement decision', body: 'Resolves #10', state: 'open', html_url: 'https://example.test', updated_at: '' }])).toHaveLength(1);
    });
});
