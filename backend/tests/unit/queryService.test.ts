import { describe, expect, it } from 'vitest';
import { TaskStatus } from '@prisma/client';
import {
  TaskDetail, TaskRow, daysOverdue, dueText, personSummary, taskCard, taskLine, teamSummary,
} from '../../src/services/queryService';

// Fixed clock: 11 Sept 2026, 12:00 IST.
const NOW = new Date('2026-09-11T06:30:00.000Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000);

const ramesh = { id: 'U2', name: 'Ramesh' };
const anshul = { id: 'U3', name: 'Anshul Raibole' };

function row(over: Partial<TaskRow> & { id: string }): TaskRow {
  return {
    title: 'Godown safai', status: TaskStatus.Pending, priority: 'Medium', deadline: day(3),
    escalationLevel: 0, assignedTo: ramesh, assignees: [], ...over,
  };
}

describe('deadlines as a person says them', () => {
  it('counts whole days late', () => {
    expect(daysOverdue(day(-2.5), NOW)).toBe(2);
    expect(daysOverdue(day(1), NOW)).toBe(0);
  });

  it('renders due today, overdue, and a future date', () => {
    expect(dueText('en', day(0.2), NOW)).toBe('due today');
    expect(dueText('en', day(-3), NOW)).toBe('⚠️ 3d overdue');
    expect(dueText('en', day(3), NOW)).toBe('due 14 Sept');
    expect(dueText('hi', day(-3), NOW)).toBe('⚠️ 3 दिन देर');
  });
});

describe('one task', () => {
  it('lists every holder of a shared task', () => {
    const t = row({ id: 'TSK-4', assignees: [
      { user: ramesh, status: TaskStatus.Pending }, { user: anshul, status: TaskStatus.Submitted },
    ] });
    expect(taskLine('en', t, NOW, true)).toBe('• TSK-4 Godown safai (Ramesh, Anshul Raibole) — Pending, due 14 Sept');
  });

  it('renders the card with the last update and escalation', () => {
    const t: TaskDetail = {
      ...row({ id: 'TSK-4', status: TaskStatus.Submitted, priority: 'High', deadline: day(-1), escalationLevel: 2 }),
      activities: [{ text: 'photo attached', createdAt: day(-1), by: { name: 'Ramesh' } }],
    };
    expect(taskCard('en', t, NOW)).toBe([
      '*TSK-4* — Godown safai',
      'Status: Submitted — awaiting approval',
      'Assigned to: Ramesh',
      'Priority: High · ⚠️ 1d overdue',
      'Escalated to L2',
      'Last update: 10 Sept, Ramesh — photo attached',
    ].join('\n'));
  });
});

describe('one person', () => {
  it('says so when there is nothing open', () => {
    expect(personSummary('en', 'Ramesh', [], false, NOW)).toBe('Ramesh has no open tasks. ✅');
    expect(personSummary('hi', 'Ramesh', [], true, NOW)).toBe('Ramesh का कोई काम देर से नहीं है। ✅');
  });

  it('lists open work in deadline order as given', () => {
    const tasks = [row({ id: 'TSK-2', deadline: day(-2) }), row({ id: 'TSK-5', title: 'Stock check', status: TaskStatus.Submitted })];
    expect(personSummary('en', 'Ramesh', tasks, false, NOW)).toBe([
      'Ramesh — 2 open tasks:',
      '• TSK-2 Godown safai — Pending, ⚠️ 2d overdue',
      '• TSK-5 Stock check — Submitted — awaiting approval, due 14 Sept',
    ].join('\n'));
  });
});

describe('the team', () => {
  const scope = [ramesh, anshul];

  it('counts per person, including people with nothing', () => {
    const tasks = [
      row({ id: 'TSK-2', deadline: day(-2) }),
      row({ id: 'TSK-5', status: TaskStatus.Submitted }),
    ];
    expect(teamSummary('en', scope, tasks, false, NOW)).toBe([
      'Team status — 2 open:',
      '• Ramesh: 2 open, ⚠️ 1 overdue, 1 awaiting approval',
      '• Anshul Raibole: nothing open',
      '',
      'For details reply: "<name> ke tasks" or "TSK-4 status"',
    ].join('\n'));
  });

  it('counts a shared task for everyone holding it', () => {
    const tasks = [row({ id: 'TSK-4', assignees: [
      { user: ramesh, status: TaskStatus.Pending }, { user: anshul, status: TaskStatus.Pending },
    ] })];
    const text = teamSummary('en', scope, tasks, false, NOW);
    expect(text).toContain('• Ramesh: 1 open');
    expect(text).toContain('• Anshul Raibole: 1 open');
  });

  it('lists the late ones with their holders when asked for overdue', () => {
    const tasks = [row({ id: 'TSK-2', deadline: day(-2), assignedTo: anshul })];
    expect(teamSummary('en', scope, tasks, true, NOW)).toBe([
      '⚠️ 1 overdue:',
      '• TSK-2 Godown safai (Anshul Raibole) — Pending, ⚠️ 2d overdue',
    ].join('\n'));
    expect(teamSummary('hi', scope, [], true, NOW)).toBe('टीम में कुछ भी देर से नहीं है। ✅');
  });
});
