// ─────────────────────────────────────────────────────────────────────────────
// Status queries over WhatsApp.
//
// The command layer lets a manager CHANGE things from WhatsApp; this module
// lets them ASK. "TSK-4 ka status", "Ramesh ke pending kaam", "team update" —
// each is answered with a short text reply built here.
//
// Nothing in this file sends anything or writes anything. It reads tasks and
// renders text, so every formatter is a pure function the unit tests can call
// with fixed dates.
// ─────────────────────────────────────────────────────────────────────────────
import { Prisma, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { Lang } from './replies';
import { heldByAnyUser, heldByUser } from './taskService';

export type QueryScope = { id: string; name: string }[];

/** The fields a status line needs. Kept narrow so the queries stay cheap. */
export interface TaskRow {
  id: string;
  title: string;
  status: TaskStatus;
  priority: string;
  deadline: Date;
  escalationLevel: number;
  assignedTo: { id: string; name: string };
  assignees: { user: { id: string; name: string }; status: TaskStatus }[];
}

export interface TaskDetail extends TaskRow {
  activities: { text: string; createdAt: Date; by: { name: string } }[];
}

const TASK_SELECT = {
  id: true, title: true, status: true, priority: true, deadline: true, escalationLevel: true,
  assignedTo: { select: { id: true, name: true } },
  assignees:  { select: { status: true, user: { select: { id: true, name: true } } } },
} as const;

/** Statuses that still need somebody to do something. */
export const OPEN_STATUSES: TaskStatus[] = [
  TaskStatus.Pending, TaskStatus.InProgress, TaskStatus.Submitted, TaskStatus.Issue, TaskStatus.Delay,
];

// ─── Reads ───────────────────────────────────────────────────────────────────

export async function loadTaskDetail(taskId: string): Promise<TaskDetail | null> {
  return prisma.task.findUnique({
    where:  { id: taskId },
    select: {
      ...TASK_SELECT,
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { text: true, createdAt: true, by: { select: { name: true } } },
      },
    },
  });
}

export async function openTasksHeldBy(userId: string, overdueOnly: boolean, now: Date): Promise<TaskRow[]> {
  return prisma.task.findMany({
    where:   { AND: [heldByUser(userId), openFilter(overdueOnly, now)] },
    select:  TASK_SELECT,
    orderBy: { deadline: 'asc' },
  });
}

export async function openTasksHeldByAny(userIds: string[], overdueOnly: boolean, now: Date): Promise<TaskRow[]> {
  if (userIds.length === 0) return [];
  return prisma.task.findMany({
    where:   { AND: [heldByAnyUser(userIds), openFilter(overdueOnly, now)] },
    select:  TASK_SELECT,
    orderBy: { deadline: 'asc' },
  });
}

function openFilter(overdueOnly: boolean, now: Date): Prisma.TaskWhereInput {
  return overdueOnly
    ? { status: { in: OPEN_STATUSES }, deadline: { lt: now } }
    : { status: { in: OPEN_STATUSES } };
}

// ─── Text ────────────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<Lang, Record<TaskStatus, string>> = {
  en: {
    Pending:    'Pending',
    InProgress: 'In progress',
    Submitted:  'Submitted — awaiting approval',
    Done:       'Done',
    Issue:      'Issue raised',
    Delay:      'Delay requested',
  },
  hi: {
    Pending:    'लंबित',
    InProgress: 'चल रहा है',
    Submitted:  'सबमिट — मंज़ूरी बाकी',
    Done:       'पूरा',
    Issue:      'समस्या',
    Delay:      'देरी की मांग',
  },
};

export function statusLabel(lang: Lang, status: TaskStatus): string {
  return STATUS_LABEL[lang][status] ?? status;
}

/** "14 Sept" in Indian time, whatever the server's clock zone is. */
export function shortDate(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d);
}

/** Whole days late, or 0 when not yet due. */
export function daysOverdue(deadline: Date, now: Date): number {
  const ms = now.getTime() - deadline.getTime();
  return ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

/** "due 14 Sept" / "3d overdue" — the deadline as a person would say it. */
export function dueText(lang: Lang, deadline: Date, now: Date): string {
  const late = daysOverdue(deadline, now);
  if (late > 0) return lang === 'hi' ? `⚠️ ${late} दिन देर` : `⚠️ ${late}d overdue`;
  if (now.getTime() <= deadline.getTime() && deadline.getTime() - now.getTime() < 86_400_000) {
    return lang === 'hi' ? 'आज तक' : 'due today';
  }
  return lang === 'hi' ? `${shortDate(deadline)} तक` : `due ${shortDate(deadline)}`;
}

/** Everyone holding the task, for shared tasks; the sole assignee otherwise. */
export function holderNames(task: TaskRow): string[] {
  const names = task.assignees.length > 0
    ? task.assignees.map((a) => a.user.name)
    : [task.assignedTo.name];
  return [...new Set(names)];
}

/** One bullet in a list: "• TSK-4 Godown safai — Pending, due today". */
export function taskLine(lang: Lang, task: TaskRow, now: Date, withHolder = false): string {
  const who = withHolder ? ` (${holderNames(task).join(', ')})` : '';
  return `• ${task.id} ${task.title}${who} — ${statusLabel(lang, task.status)}, ${dueText(lang, task.deadline, now)}`;
}

/** The full card for a single task. */
export function taskCard(lang: Lang, task: TaskDetail, now: Date): string {
  const hi = lang === 'hi';
  const lines = [
    `*${task.id}* — ${task.title}`,
    `${hi ? 'स्थिति' : 'Status'}: ${statusLabel(lang, task.status)}`,
    `${hi ? 'किसके पास' : 'Assigned to'}: ${holderNames(task).join(', ')}`,
    `${hi ? 'प्राथमिकता' : 'Priority'}: ${task.priority} · ${dueText(lang, task.deadline, now)}`,
  ];
  if (task.escalationLevel > 0) {
    lines.push(hi ? `एस्केलेशन स्तर ${task.escalationLevel}` : `Escalated to L${task.escalationLevel}`);
  }
  const last = task.activities[0];
  if (last) {
    lines.push(`${hi ? 'आख़िरी अपडेट' : 'Last update'}: ${shortDate(last.createdAt)}, ${last.by.name} — ${last.text.slice(0, 120)}`);
  }
  return lines.join('\n');
}

/** A person's open work, newest deadline last. */
export function personSummary(lang: Lang, name: string, tasks: TaskRow[], overdueOnly: boolean, now: Date): string {
  const hi = lang === 'hi';
  if (tasks.length === 0) {
    if (overdueOnly) return hi ? `${name} का कोई काम देर से नहीं है। ✅` : `${name} has nothing overdue. ✅`;
    return hi ? `${name} के पास अभी कोई खुला काम नहीं है। ✅` : `${name} has no open tasks. ✅`;
  }
  const head = overdueOnly
    ? (hi ? `${name} — ${tasks.length} काम देर से:` : `${name} — ${tasks.length} overdue:`)
    : (hi ? `${name} — ${tasks.length} खुले काम:` : `${name} — ${tasks.length} open task${tasks.length === 1 ? '' : 's'}:`);
  return [head, ...tasks.map((t) => taskLine(lang, t, now))].join('\n');
}

/** The whole team at a glance, one line per person, then a hint. */
export function teamSummary(lang: Lang, scope: QueryScope, tasks: TaskRow[], overdueOnly: boolean, now: Date): string {
  const hi = lang === 'hi';
  if (tasks.length === 0) {
    if (overdueOnly) return hi ? 'टीम में कुछ भी देर से नहीं है। ✅' : 'Nothing overdue in the team. ✅';
    return hi ? 'टीम के पास अभी कोई खुला काम नहीं है। ✅' : 'The team has no open tasks. ✅';
  }

  if (overdueOnly) {
    const head = hi ? `⚠️ ${tasks.length} काम देर से:` : `⚠️ ${tasks.length} overdue:`;
    return [head, ...tasks.map((t) => taskLine(lang, t, now, true))].join('\n');
  }

  // Per person: how many open, how many of those late, how many waiting on
  // the manager. A task shared by two people counts for both — each of them
  // still has it on their plate.
  const byPerson = new Map<string, { name: string; open: number; late: number; submitted: number }>();
  for (const p of scope) byPerson.set(p.id, { name: p.name, open: 0, late: 0, submitted: 0 });
  for (const task of tasks) {
    const holders = task.assignees.length > 0 ? task.assignees.map((a) => a.user) : [task.assignedTo];
    for (const h of holders) {
      const row = byPerson.get(h.id) ?? { name: h.name, open: 0, late: 0, submitted: 0 };
      row.open += 1;
      if (daysOverdue(task.deadline, now) > 0) row.late += 1;
      if (task.status === TaskStatus.Submitted) row.submitted += 1;
      byPerson.set(h.id, row);
    }
  }

  const lines: string[] = [hi ? `टीम की स्थिति — ${tasks.length} खुले काम:` : `Team status — ${tasks.length} open:`];
  for (const row of byPerson.values()) {
    if (row.open === 0) { lines.push(`• ${row.name}: ${hi ? 'कोई खुला काम नहीं' : 'nothing open'}`); continue; }
    const bits = [hi ? `${row.open} खुले` : `${row.open} open`];
    if (row.late)      bits.push(hi ? `⚠️ ${row.late} देर से` : `⚠️ ${row.late} overdue`);
    if (row.submitted) bits.push(hi ? `${row.submitted} मंज़ूरी बाकी` : `${row.submitted} awaiting approval`);
    lines.push(`• ${row.name}: ${bits.join(', ')}`);
  }
  lines.push('');
  lines.push(hi
    ? 'किसी एक के बारे में जानने के लिए भेजें: "<नाम> ke tasks" या "TSK-4 status"'
    : 'For details reply: "<name> ke tasks" or "TSK-4 status"');
  return lines.join('\n');
}
