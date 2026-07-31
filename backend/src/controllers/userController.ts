import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';

/**
 * Generate the next human-readable user ID.
 * Scans all existing IDs matching U<digits>, takes the max, increments by 1.
 * Falls back to U108 if none are found (seed data tops out at U107).
 * Zero-padded to 3 digits: U108, U109 … U999.
 */
async function generateUserId(): Promise<string> {
  const rows = await prisma.user.findMany({ select: { id: true } });
  const nums = rows
    .map((r) => r.id.match(/^U(\d+)$/)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => parseInt(n, 10));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 108;
  return `U${next.toString().padStart(3, '0')}`;
}

const safeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  reportingToId: true,
  phone: true,
  preferredLanguage: true,
  avatar: true,
  color: true,
  createdAt: true,
};

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { role, userId } = req.user!;

  if (role === 'Admin') {
    const users = await prisma.user.findMany({ select: safeSelect, orderBy: { name: 'asc' } });
    res.json(users);
    return;
  }

  if (role === 'Manager') {
    const users = await prisma.user.findMany({
      where: { OR: [{ id: userId }, { reportingToId: userId }] },
      select: safeSelect,
      orderBy: { name: 'asc' },
    });
    res.json(users);
    return;
  }

  // Employee — self only
  const user = await prisma.user.findUnique({ where: { id: userId }, select: safeSelect });
  res.json(user ? [user] : []);
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const { name, email, password, role, reportingToId, phone, preferredLanguage, avatar, color } = req.body as {
    name: string;
    email: string;
    password: string;
    role?: string;
    reportingToId?: string;
    phone?: string;
    preferredLanguage?: string;
    avatar?: string;
    color?: string;
  };

  if (!name || !email || !password) {
    res.status(400).json({ error: 'name, email, and password required' });
    return;
  }

  const [passwordHash, id] = await Promise.all([
    bcrypt.hash(password, 10),
    generateUserId(),
  ]);
  try {
    const user = await prisma.user.create({
      data: {
        id,
        name,
        email,
        passwordHash,
        role: (role as 'Admin' | 'Manager' | 'Employee') ?? 'Employee',
        reportingToId: reportingToId ?? null,
        phone: phone ?? null,
        preferredLanguage: preferredLanguage ?? 'en',
        avatar: avatar ?? name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
        color: color ?? 'from-slate-400 to-slate-600',
      },
      select: safeSelect,
    });
    res.status(201).json(user);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'P2002') {
      res.status(409).json({ error: 'Email already in use' });
    } else {
      throw err;
    }
  }
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { role: callerRole, userId: callerId } = req.user!;

  const allowedFields: Record<string, string[]> = {
    Admin:    ['name', 'email', 'role', 'reportingToId', 'phone', 'preferredLanguage', 'avatar', 'color'],
    Manager:  ['name', 'phone', 'preferredLanguage', 'avatar', 'color'],
    Employee: ['name', 'phone', 'preferredLanguage', 'avatar', 'color'],
  };

  if (callerRole !== 'Admin' && id !== callerId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const permitted = allowedFields[callerRole] ?? [];
  const patch: Record<string, unknown> = {};
  for (const key of permitted) {
    if (req.body[key] !== undefined) patch[key] = req.body[key];
  }

  if (req.body.password && (callerRole === 'Admin' || id === callerId)) {
    patch.passwordHash = await bcrypt.hash(req.body.password as string, 10);
  }

  const user = await prisma.user.update({ where: { id }, data: patch, select: safeSelect });
  res.json(user);
}

/**
 * Remove a member.
 *
 * The schema protects a person's footprint with RESTRICT foreign keys — their
 * tasks, the activities they wrote, the messages they sent. That is deliberate:
 * deleting somebody must not quietly delete the record of who did what.
 *
 * This used to hand the delete straight to Postgres and let it fail. Because
 * Express 4 doesn't catch async rejections, that failure became an
 * unhandledRejection and took the whole process down — one Admin clicking
 * "Remove Member" restarted the API for everyone. It is checked here now, and
 * `errorHandler` catches anything that still slips through.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const { userId: callerId } = req.user!;

  if (id === callerId) {
    res.status(400).json({ error: 'You cannot remove your own account.' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!user) { res.status(404).json({ error: 'Member not found' }); return; }

  // Everything that would block the delete, counted in one round trip so the
  // message can name all of it at once rather than one obstacle per attempt.
  const [assignedTasks, createdTasks, reports, activities] = await Promise.all([
    prisma.task.count({ where: { assignedToId: id } }),
    prisma.task.count({ where: { assignedById: id } }),
    prisma.user.count({ where: { reportingToId: id } }),
    prisma.activity.count({ where: { byId: id } }),
  ]);

  const blockers: string[] = [];
  if (assignedTasks) blockers.push(`${assignedTasks} task${assignedTasks > 1 ? 's are' : ' is'} still assigned to them`);
  if (reports)       blockers.push(`${reports} ${reports > 1 ? 'people report' : 'person reports'} to them`);
  if (createdTasks)  blockers.push(`they created ${createdTasks} task${createdTasks > 1 ? 's' : ''}`);
  if (activities)    blockers.push(`they have ${activities} entr${activities > 1 ? 'ies' : 'y'} in task history`);

  if (blockers.length > 0) {
    res.status(409).json({
      error:
        `${user.name} can't be removed because ${joinList(blockers)}. ` +
        `Reassign their tasks and move their reports to another manager first. ` +
        `Task history is kept permanently for the audit trail, so a member who has ` +
        `worked on tasks can't be deleted — change their role instead.`,
      blockers: { assignedTasks, createdTasks, reports, activities },
    });
    return;
  }

  await prisma.user.delete({ where: { id } });
  res.json({ ok: true });
}

/** "a, b and c" — reads as a sentence rather than a comma-separated dump. */
function joinList(parts: string[]): string {
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
