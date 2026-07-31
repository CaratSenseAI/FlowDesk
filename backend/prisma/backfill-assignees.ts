/**
 * One-shot backfill: every existing `Task` gets its `TaskAssignee` row.
 *
 *   npm run db:backfill-assignees
 *
 * Multi-assignee is layered on top of `Task.assignedToId` rather than replacing
 * it, and the join table is meant to be authoritative for "who holds this?".
 * That only works if EVERY task has at least one row — otherwise a query that
 * reads the join table would silently miss every task created before this
 * shipped, and a worker would find their own tasks had vanished from WhatsApp.
 *
 * SAFE TO RE-RUN. `@@unique([taskId, userId])` plus `skipDuplicates` makes a
 * second run insert nothing.
 *
 * Deliberately mirrors each task's CURRENT state: the assignee row inherits the
 * task's status, so a task already sitting in Submitted doesn't reappear as
 * outstanding work for the person who finished it.
 */
import { PrismaClient, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

const BATCH_SIZE = 500;

/**
 * A task's status maps onto its sole assignee's status directly — with one
 * exception. `Done` means an approver signed it off, which is a fact about the
 * task, not about the person; their part was Submitted.
 */
function assigneeStatusFor(taskStatus: TaskStatus): TaskStatus {
  return taskStatus === TaskStatus.Done ? TaskStatus.Submitted : taskStatus;
}

async function main(): Promise<void> {
  const total = await prisma.task.count();
  console.log(`[backfill] ${total} task(s) to check`);

  let processed = 0;
  let inserted = 0;
  let cursor: string | undefined;

  for (;;) {
    const tasks = await prisma.task.findMany({
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      orderBy: { id: 'asc' },
      select: { id: true, assignedToId: true, assignedById: true, status: true, updatedAt: true },
    });
    if (tasks.length === 0) break;

    const { count } = await prisma.taskAssignee.createMany({
      data: tasks.map((t) => ({
        taskId: t.id,
        userId: t.assignedToId,
        status: assigneeStatusFor(t.status),
        // Submitted work already has a submission time in spirit; the task's
        // own updatedAt is the closest honest value we have for when.
        submittedAt: assigneeStatusFor(t.status) === TaskStatus.Submitted ? t.updatedAt : null,
        // Whoever created the task is who put this person on it.
        addedById: t.assignedById,
      })),
      skipDuplicates: true,
    });

    processed += tasks.length;
    inserted += count;
    cursor = tasks[tasks.length - 1].id;
    console.log(`[backfill] ${processed}/${total} checked, ${inserted} row(s) inserted`);
  }

  // The invariant this whole file exists to establish.
  const orphans = await prisma.task.count({ where: { assignees: { none: {} } } });
  if (orphans > 0) {
    throw new Error(
      `${orphans} task(s) still have no assignee row. The join table is not safe to ` +
      `read from — investigate before deploying code that relies on it.`,
    );
  }

  console.log(`[backfill] ✅ done — ${inserted} inserted, every task has an assignee row`);
}

main()
  .catch((err) => { console.error('[backfill] failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
