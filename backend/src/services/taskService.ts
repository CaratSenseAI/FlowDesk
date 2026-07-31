import { ActionChannel, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE } from '../lib/constants';
import { Actor, canAssignTo, canManageTask } from './permissionService';
import { notifyAssignment } from './notifyService';

// ─────────────────────────────────────────────────────────────────────────────
// The task operations themselves, with the authorization that belongs to them.
//
// These used to live inside Express handlers as (req, res), which made them
// unreachable from anywhere that isn't an HTTP request — the WhatsApp webhook
// could not have reused a line of it. Everything here is transport-agnostic:
// `taskController` wraps it for HTTP, `commandExecutor` calls it for WhatsApp,
// and because there is exactly one implementation the two channels cannot
// enforce different rules.
//
// That is the point. "A WhatsApp action must appear exactly as a website action
// would" is true here by construction rather than by two code paths agreeing to
// behave the same.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A refusal, not a crash. `code` maps cleanly onto HTTP status for the web
 * caller and onto a sentence for the WhatsApp caller, so neither has to parse
 * a message string to find out what went wrong.
 */
export class TaskOpError extends Error {
  constructor(
    public readonly code: 'not_found' | 'forbidden' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'TaskOpError';
  }
}

export const HTTP_STATUS: Record<TaskOpError['code'], number> = {
  not_found: 404,
  forbidden: 403,
  invalid:   400,
};

/**
 * Activities are fetched newest-first with a cap and reversed before
 * responding. Without the cap, `listTasks` serialises every activity ever
 * recorded on every in-scope task — an Admin request pulled the entire table.
 * Reversal matters because the UI renders the array in order.
 */
const ACTIVITY_LIMIT = 200;

export const taskInclude = {
  assignedTo: { select: { id: true, name: true, avatar: true, color: true, phone: true, preferredLanguage: true, role: true, reportingToId: true } },
  assignedBy: { select: { id: true, name: true, avatar: true, color: true } },
  activities: {
    orderBy: { createdAt: 'desc' as const },
    take: ACTIVITY_LIMIT,
    include: { by: { select: { id: true, name: true, avatar: true, color: true } } },
  },
} satisfies Prisma.TaskInclude;

type WithActivities = { activities: unknown[] };

/** Restore chronological order after the newest-first fetch above. */
export function chronological<T extends WithActivities>(task: T): T {
  task.activities.reverse();
  return task;
}

/**
 * Generate the next human-readable task ID.
 * Scans all existing IDs matching TSK-<digits>, takes the max, increments by 1.
 *
 * A fresh database starts at TSK-1. Note this only applies when there are no
 * tasks at all — an existing database keeps counting from its own maximum, so
 * numbering never jumps backwards and no already-issued ID is ever reused.
 */
export async function generateTaskId(): Promise<string> {
  const rows = await prisma.task.findMany({ select: { id: true } });
  const nums = rows
    .map((r) => r.id.match(/^TSK-(\d+)$/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `TSK-${next}`;
}

/** Statuses a task can no longer be moved out of by reassignment. */
const CLOSED_STATUSES = new Set(['Done']);

export interface ReassignOptions {
  channel: ActionChannel;
  /** Free text the actor gave for the handover ("high workload"). Optional. */
  reason?: string | null;
}

/**
 * Move a task to a new assignee.
 *
 * Both directions are checked, and they are different questions:
 *   canManageTask — may the actor touch THIS TASK at all?
 *   canAssignTo   — may the actor put work on THIS PERSON?
 *
 * Before this existed the endpoint asked neither, so any Manager could move any
 * task in the database onto any user. The web UI never offered that because
 * `listUsers` is role-scoped, but the server was taking the client's word for it.
 *
 * The old assignment is preserved: `Activity` is append-only, so the history
 * gains a row naming both sides rather than the previous owner being erased.
 */
export async function reassign(
  actor: Actor,
  taskId: string,
  newAssigneeId: string,
  opts: ReassignOptions,
) {
  const existing = await prisma.task.findUnique({
    where:  { id: taskId },
    select: {
      id: true, title: true, status: true, assignedToId: true, assignedById: true,
      assignedTo: { select: { id: true, name: true } },
    },
  });
  if (!existing) throw new TaskOpError('not_found', `Task ${taskId} not found`);

  if (!(await canManageTask(actor, existing))) {
    throw new TaskOpError('forbidden', `You do not have access to ${taskId}`);
  }

  const newAssignee = await prisma.user.findUnique({
    where:  { id: newAssigneeId },
    select: { id: true, name: true, phone: true, preferredLanguage: true },
  });
  if (!newAssignee) throw new TaskOpError('not_found', 'Assignee not found');

  if (!(await canAssignTo(actor, newAssigneeId))) {
    throw new TaskOpError(
      'forbidden',
      `${newAssignee.name} is outside your permitted reporting structure`,
    );
  }

  if (existing.assignedToId === newAssigneeId) {
    throw new TaskOpError('invalid', `${taskId} is already assigned to ${newAssignee.name}`);
  }

  if (CLOSED_STATUSES.has(existing.status)) {
    throw new TaskOpError('invalid', `${taskId} is already ${existing.status} and cannot be reassigned`);
  }

  const actorRow = await prisma.user.findUnique({
    where: { id: actor.id }, select: { id: true, name: true },
  });
  const actorName = actorRow?.name ?? 'someone';

  const detail = [
    `Reassigned from ${existing.assignedTo.name} to ${newAssignee.name} by ${actorName}`,
    opts.reason ? ` — ${opts.reason}` : '',
  ].join('');

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      assignedToId: newAssigneeId,
      activities: {
        create: {
          byId:    actor.id,
          type:    ACTIVITY_TYPE.REASSIGN,
          text:    detail,
          channel: opts.channel,
        },
      },
    },
    include: taskInclude,
  });

  // Fire-and-forget: the reassignment has already committed, and a WhatsApp
  // outage must not undo it. notifyAssignment swallows its own errors.
  void notifyAssignment({
    task:     { id: task.id, title: task.title },
    assignee: newAssignee,
    actor:    actorRow,
    kind:     'reassigned',
    previousAssigneeName: existing.assignedTo.name,
    channel:  opts.channel,
  });

  return chronological(task);
}

/**
 * Load a task and check the actor may act on it.
 *
 * The three edit operations below differ only in what they then change, so the
 * gate lives in one place — a new one can't be added that forgets to check.
 */
async function authorisedTask(actor: Actor, taskId: string) {
  const task = await prisma.task.findUnique({
    where:  { id: taskId },
    select: {
      id: true, title: true, status: true, priority: true, deadline: true,
      assignedToId: true, assignedById: true,
    },
  });
  if (!task) throw new TaskOpError('not_found', `Task ${taskId} not found`);

  if (!(await canManageTask(actor, task))) {
    throw new TaskOpError('forbidden', `You do not have access to ${taskId}`);
  }
  return task;
}

/** Add a note to a task's history. Visible to everyone who can see the task. */
export async function comment(
  actor: Actor,
  taskId: string,
  text: string,
  opts: { channel: ActionChannel },
) {
  const body = text?.trim();
  if (!body) throw new TaskOpError('invalid', 'A comment cannot be empty');

  await authorisedTask(actor, taskId);

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      activities: {
        create: { byId: actor.id, type: ACTIVITY_TYPE.COMMENT, text: body, channel: opts.channel },
      },
    },
    include: taskInclude,
  });
  return chronological(task);
}

export async function setPriority(
  actor: Actor,
  taskId: string,
  priority: 'Low' | 'Medium' | 'High',
  opts: { channel: ActionChannel },
) {
  const existing = await authorisedTask(actor, taskId);

  if (existing.priority === priority) {
    throw new TaskOpError('invalid', `${taskId} is already ${priority} priority`);
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      priority,
      activities: {
        create: {
          byId:    actor.id,
          type:    ACTIVITY_TYPE.STATUS,
          text:    `Priority changed from ${existing.priority} to ${priority}`,
          channel: opts.channel,
        },
      },
    },
    include: taskInclude,
  });
  return chronological(task);
}

export async function setDeadline(
  actor: Actor,
  taskId: string,
  deadline: Date,
  opts: { channel: ActionChannel },
) {
  if (!(deadline instanceof Date) || isNaN(deadline.getTime())) {
    throw new TaskOpError('invalid', 'a valid deadline is required');
  }

  const existing = await authorisedTask(actor, taskId);

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      deadline,
      // Pushing a deadline out gives the task a fresh window, so the 48h
      // advance alert should be allowed to fire again for the new date instead
      // of staying suppressed by the one already sent for the old one.
      ...(deadline > existing.deadline && { alertDispatched: false }),
      activities: {
        create: {
          byId:    actor.id,
          type:    ACTIVITY_TYPE.STATUS,
          text:    `Deadline moved from ${fmtDate(existing.deadline)} to ${fmtDate(deadline)}`,
          channel: opts.channel,
        },
      },
    },
    include: taskInclude,
  });
  return chronological(task);
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export interface CreateInput {
  title:        string;
  description?: string;
  assignedToId: string;
  priority?:    'Low' | 'Medium' | 'High';
  deadline:     Date;
  customFields?: Record<string, string>;
}

/**
 * Create a task and tell the assignee about it.
 *
 * Creation is an assignment, so it runs the same `canAssignTo` check that
 * reassignment does. The web endpoint previously checked only that the caller
 * wasn't an Employee, which had the same shape of hole as reassign.
 */
export async function create(actor: Actor, input: CreateInput, opts: { channel: ActionChannel }) {
  if (actor.role === 'Employee') {
    throw new TaskOpError('forbidden', 'Employees cannot create tasks');
  }
  if (!input.title?.trim()) throw new TaskOpError('invalid', 'title is required');
  if (!input.assignedToId)  throw new TaskOpError('invalid', 'assignedToId is required');
  if (!(input.deadline instanceof Date) || isNaN(input.deadline.getTime())) {
    throw new TaskOpError('invalid', 'a valid deadline is required');
  }

  const assignee = await prisma.user.findUnique({
    where:  { id: input.assignedToId },
    select: { id: true, name: true, phone: true, preferredLanguage: true },
  });
  if (!assignee) throw new TaskOpError('not_found', 'Assignee not found');

  if (!(await canAssignTo(actor, input.assignedToId))) {
    throw new TaskOpError(
      'forbidden',
      `${assignee.name} is outside your permitted reporting structure`,
    );
  }

  const taskId = await generateTaskId();
  const task = await prisma.task.create({
    data: {
      id:           taskId,
      title:        input.title.trim(),
      description:  input.description ?? '',
      assignedToId: input.assignedToId,
      assignedById: actor.id,
      priority:     input.priority ?? 'Medium',
      deadline:     input.deadline,
      customFields: input.customFields ?? {},
      activities: {
        create: {
          byId:    actor.id,
          type:    ACTIVITY_TYPE.CREATED,
          text:    'Task created',
          channel: opts.channel,
        },
      },
    },
    include: taskInclude,
  });

  const actorRow = await prisma.user.findUnique({
    where: { id: actor.id }, select: { id: true, name: true },
  });

  void notifyAssignment({
    task:     { id: task.id, title: task.title },
    assignee,
    actor:    actorRow,
    kind:     'new',
    channel:  opts.channel,
  });

  return chronological(task);
}
