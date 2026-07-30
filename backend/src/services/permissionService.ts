import { prisma } from '../lib/prisma';

// ─────────────────────────────────────────────────────────────────────────────
// Who may assign work to whom, and who may act on which task.
//
// This is the single definition of the reporting-hierarchy rules. Everything
// that changes a task's ownership goes through here — the web API and the
// WhatsApp command executor both, so the two channels cannot drift apart.
//
// The load-bearing idea for the WhatsApp path: `assignableUsers` is not just a
// check, it's the CANDIDATE SET that name resolution searches. A manager asking
// for someone outside their hierarchy gets "nobody by that name in your team"
// because that person was never in the list, not because a later filter caught
// it. The AI is never shown people the sender may not assign to, so no amount
// of clever phrasing can surface one.
// ─────────────────────────────────────────────────────────────────────────────

export interface Actor {
  id: string;
  role: string;
}

export interface AssignableUser {
  id: string;
  name: string;
  role: string;
  phone: string | null;
  preferredLanguage: string;
}

/**
 * Everyone `actor` is permitted to put work on.
 *
 *   Admin    → everybody
 *   Manager  → their direct reports, plus themselves (taking a task back is a
 *              legitimate move, and the spec's scenario starts with a manager
 *              holding a ticket)
 *   Employee → nobody. Employees do not assign work.
 *
 * Returned sorted by name so any list we read back to a human is stable.
 */
export async function assignableUsers(actor: Actor): Promise<AssignableUser[]> {
  const select = {
    id: true, name: true, role: true, phone: true, preferredLanguage: true,
  } as const;

  if (actor.role === 'Admin') {
    return prisma.user.findMany({ select, orderBy: { name: 'asc' } });
  }

  if (actor.role === 'Manager') {
    return prisma.user.findMany({
      where:   { OR: [{ reportingToId: actor.id }, { id: actor.id }] },
      select,
      orderBy: { name: 'asc' },
    });
  }

  return [];
}

/** May `actor` assign work to `targetId`? Derived from the same set, never a separate rule. */
export async function canAssignTo(actor: Actor, targetId: string): Promise<boolean> {
  if (actor.role === 'Admin') {
    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
    return target !== null;
  }

  if (actor.role !== 'Manager') return false;

  const target = await prisma.user.findUnique({
    where:  { id: targetId },
    select: { id: true, reportingToId: true },
  });
  if (!target) return false;

  return target.reportingToId === actor.id || target.id === actor.id;
}

export interface TaskForAuth {
  assignedToId: string;
  assignedById: string;
}

/**
 * May `actor` act on this task — reassign it, comment on it, change its
 * priority or deadline?
 *
 *   Admin    → any task
 *   Manager  → a task assigned to them, a task assigned to one of their direct
 *              reports, or a task they created
 *   Employee → only a task assigned to them
 *
 * "Assigned to them" matters and is easy to leave out: the whole delegation
 * scenario is a manager handing on a ticket they are personally holding, which
 * a reports-only check would refuse.
 */
export async function canManageTask(actor: Actor, task: TaskForAuth): Promise<boolean> {
  if (actor.role === 'Admin') return true;
  if (task.assignedToId === actor.id) return true;

  if (actor.role !== 'Manager') return false;
  if (task.assignedById === actor.id) return true;

  const assignee = await prisma.user.findUnique({
    where:  { id: task.assignedToId },
    select: { reportingToId: true },
  });
  return assignee?.reportingToId === actor.id;
}
