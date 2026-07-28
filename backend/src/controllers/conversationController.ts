import { Request, Response } from 'express';
import { AttributionSource, MessageDirection } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE } from '../lib/constants';
import {
  canAccessConversation, computeSession, conversationScope, previewFor,
} from '../services/conversationService';

const USER_FIELDS = {
  id: true, name: true, avatar: true, color: true, role: true, phone: true, reportingToId: true,
} as const;

const MESSAGE_FIELDS = {
  id: true, direction: true, kind: true, text: true, mediaUrl: true, transcription: true,
  taskId: true, attributedBy: true, needsAttribution: true, deliveryStatus: true,
  deliveryError: true, senderId: true, createdAt: true,
} as const;

/**
 * GET /api/conversations
 *
 * One row per person — the conversation list. Everything on it is derived from
 * `Message` + `Task` rather than stored on a conversation row, so there's no
 * second write path that can drift out of sync.
 *
 * People with no messages are included: you have to be able to start a
 * conversation with someone new.
 */
export async function listConversations(req: Request, res: Response): Promise<void> {
  const { userId, role } = req.user!;

  const users = await prisma.user.findMany({
    where: conversationScope(role, userId),
    select: USER_FIELDS,
    orderBy: { name: 'asc' },
  });
  if (users.length === 0) { res.json([]); return; }

  const ids = users.map((u) => u.id);

  // Aggregates, not per-user queries — this stays 5 round trips regardless of
  // how many people are in scope.
  const [lastPerUser, lastInboundPerUser, needsAttrPerUser, openTasks] = await Promise.all([
    prisma.message.groupBy({
      by: ['userId'], where: { userId: { in: ids } }, _max: { createdAt: true },
    }),
    prisma.message.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, direction: MessageDirection.inbound },
      _max: { createdAt: true },
    }),
    prisma.message.groupBy({
      by: ['userId'],
      where: { userId: { in: ids }, needsAttribution: true },
      _count: { _all: true },
    }),
    prisma.task.findMany({
      where: { assignedToId: { in: ids }, status: { not: 'Done' } },
      select: { assignedToId: true, deadline: true },
    }),
  ]);

  // Fetch the actual last message for each conversation in one query.
  const lastKeys = lastPerUser
    .filter((g) => g._max.createdAt !== null)
    .map((g) => ({ userId: g.userId, createdAt: g._max.createdAt! }));

  const lastMessages = lastKeys.length
    ? await prisma.message.findMany({
        where: { OR: lastKeys },
        select: { ...MESSAGE_FIELDS, userId: true },
      })
    : [];

  const lastByUser       = new Map(lastMessages.map((m) => [m.userId, m]));
  const lastInboundByUser = new Map(lastInboundPerUser.map((g) => [g.userId, g._max.createdAt]));
  const needsAttrByUser  = new Map(needsAttrPerUser.map((g) => [g.userId, g._count._all]));

  const now = new Date();
  const taskStats = new Map<string, { open: number; overdue: number }>();
  for (const t of openTasks) {
    const s = taskStats.get(t.assignedToId) ?? { open: 0, overdue: 0 };
    s.open += 1;
    if (t.deadline < now) s.overdue += 1;
    taskStats.set(t.assignedToId, s);
  }

  const rows = users.map((u) => {
    const last  = lastByUser.get(u.id) ?? null;
    const stats = taskStats.get(u.id) ?? { open: 0, overdue: 0 };

    return {
      userId: u.id,
      name:   u.name,
      avatar: u.avatar,
      color:  u.color,
      role:   u.role,
      hasPhone: Boolean(u.phone),
      reportingToId: u.reportingToId,
      lastMessage: last && {
        id: last.id,
        preview: previewFor(last),
        direction: last.direction,
        kind: last.kind,
        createdAt: last.createdAt,
      },
      session: computeSession(lastInboundByUser.get(u.id) ?? null, now),
      needsAttributionCount: needsAttrByUser.get(u.id) ?? 0,
      openTaskCount: stats.open,
      overdueCount:  stats.overdue,
    };
  });

  // Most recent conversation first; people you've never messaged fall to the
  // bottom in alphabetical order (the findMany above already sorted by name).
  rows.sort((a, b) => {
    const at = a.lastMessage?.createdAt?.getTime() ?? -Infinity;
    const bt = b.lastMessage?.createdAt?.getTime() ?? -Infinity;
    return bt - at;
  });

  res.json(rows);
}

/**
 * GET /api/conversations/:userId/messages?before=<iso>&limit=50
 *
 * The thread. Paginated because a merged per-person conversation is an order
 * of magnitude longer than the per-task threads it replaces — this is the
 * concrete answer to "too large for admin to see 100 chats".
 *
 * Returns oldest-first for direct rendering, plus the person's tasks so the
 * re-attribution menu doesn't need a second round trip.
 */
export async function getConversation(req: Request, res: Response): Promise<void> {
  const { userId: requesterId, role } = req.user!;
  const targetUserId = req.params.userId;

  if (!(await canAccessConversation(role, requesterId, targetUserId))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: targetUserId }, select: USER_FIELDS });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }

  const limit  = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10) || 50, 1), 200);
  const before = req.query.before ? new Date(String(req.query.before)) : null;

  // Fetch newest-first so `before` paginates backwards, then flip for render.
  const page = await prisma.message.findMany({
    where: {
      userId: targetUserId,
      ...(before && !isNaN(before.getTime()) && { createdAt: { lt: before } }),
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,                       // one extra tells us if more exist
    select: { ...MESSAGE_FIELDS, task: { select: { id: true, title: true, status: true } } },
  });

  const hasMore  = page.length > limit;
  const slice    = hasMore ? page.slice(0, limit) : page;
  const messages = slice
    .map(({ task, ...m }) => ({
      ...m,
      taskTitle:  task?.title ?? null,
      taskStatus: task?.status ?? null,
    }))
    .reverse();

  const [tasks, lastInbound] = await Promise.all([
    prisma.task.findMany({
      where: { assignedToId: targetUserId },
      orderBy: [{ status: 'asc' }, { deadline: 'asc' }],
      select: { id: true, title: true, status: true },
    }),
    prisma.message.findFirst({
      where: { userId: targetUserId, direction: MessageDirection.inbound },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  res.json({
    user,
    messages,
    hasMore,
    nextBefore: hasMore ? slice[slice.length - 1].createdAt : null,
    session: computeSession(lastInbound?.createdAt ?? null),
    tasks,
  });
}

/**
 * PATCH /api/conversations/messages/:id   { taskId: string | null }
 *
 * Re-link a message to a different task, or unlink it.
 *
 * The correction is auditable, not silent: an `attribution` activity is written
 * on both the task losing the message and the one gaining it, so the task
 * history explains why its status changed.
 *
 * The old task's status is deliberately NOT auto-reverted — that would fight
 * the existing status audit trail. Instead `revertHint` tells the UI to offer
 * a one-click follow-up through the normal status endpoint.
 */
export async function reattributeMessage(req: Request, res: Response): Promise<void> {
  const { userId: requesterId, role } = req.user!;
  const messageId = req.params.id;
  const { taskId } = req.body as { taskId: string | null };

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { task: { select: { id: true, status: true } } },
  });
  if (!message) { res.status(404).json({ error: 'Message not found' }); return; }

  if (!(await canAccessConversation(role, requesterId, message.userId))) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  // The target task must belong to whoever owns this conversation, or the
  // message would end up on a task its sender has nothing to do with.
  let newTask: { id: string; title: string } | null = null;
  if (taskId) {
    newTask = await prisma.task.findFirst({
      where:  { id: taskId, assignedToId: message.userId },
      select: { id: true, title: true },
    });
    if (!newTask) {
      res.status(400).json({ error: `${taskId} is not assigned to this person` });
      return;
    }
  }

  const oldTaskId = message.taskId;
  if (oldTaskId === (taskId ?? null)) {
    res.json({ message, revertHint: null });
    return;
  }

  const actor = await prisma.user.findUnique({
    where: { id: requesterId }, select: { name: true },
  });
  const actorName = actor?.name ?? 'someone';

  const writes: any[] = [
    prisma.message.update({
      where: { id: messageId },
      data: {
        taskId: taskId ?? null,
        attributedBy: taskId ? AttributionSource.manual : AttributionSource.none,
        needsAttribution: false,
      },
      select: { ...MESSAGE_FIELDS },
    }),
  ];

  if (oldTaskId) {
    writes.push(prisma.activity.create({
      data: {
        taskId: oldTaskId,
        byId: requesterId,
        type: ACTIVITY_TYPE.ATTRIBUTION,
        text: taskId
          ? `Message re-attributed to ${taskId} by ${actorName}`
          : `Message unlinked from this task by ${actorName}`,
      },
    }));
  }

  if (taskId) {
    writes.push(prisma.activity.create({
      data: {
        taskId,
        byId: requesterId,
        type: ACTIVITY_TYPE.ATTRIBUTION,
        text: oldTaskId
          ? `Message re-attributed from ${oldTaskId} by ${actorName}`
          : `Message linked to this task by ${actorName}`,
      },
    }));
  }

  const [updated] = await prisma.$transaction(writes);

  // If the old task is sitting in a state this message put it in, offer to undo.
  const revertHint =
    oldTaskId && message.task && message.task.status !== 'Pending'
      ? { taskId: oldTaskId, currentStatus: message.task.status, suggestedStatus: 'Pending' }
      : null;

  res.json({ message: updated, revertHint });
}
