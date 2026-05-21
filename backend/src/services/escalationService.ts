import { prisma } from '../lib/prisma';
import { sendWhatsApp } from './whatsappService';

// ─── Escalation config ────────────────────────────────────────────────────────
//
// ESCALATION_INTERVALS_HOURS defines how long to wait between each escalation level.
// Format: comma-separated hours, one value per transition.
//
//   Index 0 → Level 0→1: hours after deadline before first escalation
//   Index 1 → Level 1→2: hours after L1 before escalating to L2
//   Index 2 → Level 2→3: hours after L2 before escalating to L3
//   ... and so on
//
// Once all intervals are exhausted, no further escalation happens.
//
// Examples:
//   Food delivery:  "0,0.25,0.5,1"     → immediate, +15min, +30min, +1hr
//   Home services:  "0,24,48,72"        → immediate, +24hr, +48hr, +72hr
//   Default:        "0,24,48"
//
// MAX_ESCALATION_LEVEL: cap so tasks don't escalate infinitely.
// Set to 0 to disable the cap.

function getEscalationConfig(): { intervals: number[]; maxLevel: number } {
  const raw      = process.env.ESCALATION_INTERVALS_HOURS ?? '0,24,48';
  const maxLevel = parseInt(process.env.MAX_ESCALATION_LEVEL ?? '0', 10) || 99;

  const intervals = raw
    .split(',')
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));

  if (intervals.length === 0) {
    console.warn('[Escalation] ESCALATION_INTERVALS_HOURS is invalid — using default [0, 24, 48]');
    return { intervals: [0, 24, 48], maxLevel };
  }

  return { intervals, maxLevel };
}

// ─── Main escalation runner ───────────────────────────────────────────────────

export async function runEscalation(): Promise<void> {
  const now = new Date();
  const { intervals, maxLevel } = getEscalationConfig();

  // Find all overdue, non-Done tasks
  const overdueTasks = await prisma.task.findMany({
    where: {
      deadline: { lt: now },
      status:   { not: 'Done' },
    },
    include: {
      assignedTo: {
        select: { id: true, name: true, phone: true, reportingToId: true },
      },
      assignedBy: { select: { id: true, name: true } },
    },
  });

  for (const task of overdueTasks) {
    try {
      const currentLevel = task.escalationLevel;

      // Already at or above max — stop
      if (maxLevel > 0 && currentLevel >= maxLevel) continue;

      // No more configured intervals — stop
      if (currentLevel >= intervals.length) continue;

      const intervalHours = intervals[currentLevel];
      const intervalMs    = intervalHours * 60 * 60 * 1000;

      // Find the most recent escalation activity for this task
      const lastEscalation = await prisma.activity.findFirst({
        where:   { taskId: task.id, type: 'escalation' },
        orderBy: { createdAt: 'desc' },
      });

      let shouldEscalate = false;

      if (!lastEscalation) {
        // Never escalated before — fire as soon as the wait after deadline is met
        const msSinceDeadline = now.getTime() - new Date(task.deadline).getTime();
        shouldEscalate = msSinceDeadline >= intervalMs;
      } else {
        // Already escalated — check if enough time has passed since the last one
        const msSinceLast = now.getTime() - new Date(lastEscalation.createdAt).getTime();
        shouldEscalate = msSinceLast >= intervalMs;
      }

      if (!shouldEscalate) continue;

      // ── Escalate ──────────────────────────────────────────────────────────
      const nextLevel = currentLevel + 1;

      await prisma.task.update({
        where: { id: task.id },
        data: {
          escalationLevel: nextLevel,
          activities: {
            create: {
              byId: task.assignedById,
              type: 'escalation',
              text: `Auto-escalated to L${nextLevel}: deadline missed by ${Math.round((now.getTime() - new Date(task.deadline).getTime()) / 3600000)}h`,
            },
          },
        },
      });

      console.log(`[Escalation] ${task.id} → L${nextLevel} (was L${currentLevel}, interval was ${intervalHours}h)`);

      // ── Notify: always ping the assignee ─────────────────────────────────
      if (task.assignedTo.phone) {
        sendWhatsApp(task.assignedTo.phone, 'task_escalation', [
          task.assignedTo.name,
          task.title,
        ]).catch(console.error);
      }

      // ── Notify: ping manager on L2+, Admin on L3+ ────────────────────────
      if (nextLevel >= 2 && task.assignedTo.reportingToId) {
        const manager = await prisma.user.findUnique({
          where:  { id: task.assignedTo.reportingToId },
          select: { phone: true, name: true, reportingToId: true },
        });
        if (manager?.phone) {
          sendWhatsApp(manager.phone, 'task_escalation', [
            task.assignedTo.name,
            task.title,
          ]).catch(console.error);
        }

        // L3+: also notify the manager's manager (Admin level)
        if (nextLevel >= 3 && manager?.reportingToId) {
          const admin = await prisma.user.findUnique({
            where:  { id: manager.reportingToId },
            select: { phone: true, name: true },
          });
          if (admin?.phone) {
            sendWhatsApp(admin.phone, 'task_escalation', [
              task.assignedTo.name,
              task.title,
            ]).catch(console.error);
          }
        }
      }
    } catch (err) {
      console.error(`[Escalation] Failed for task ${task.id}:`, err);
    }
  }

  // ── 48h advance alerts ────────────────────────────────────────────────────
  const alertThreshold = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const pendingAlerts  = await prisma.task.findMany({
    where: {
      alertDispatched: false,
      deadline: { lt: alertThreshold, gt: now },
      status:   { not: 'Done' },
    },
    include: {
      assignedTo: { select: { phone: true, name: true } },
    },
  });

  for (const task of pendingAlerts) {
    try {
      if (task.assignedTo.phone) {
        await sendWhatsApp(task.assignedTo.phone, 'task_assignment', [
          task.title,
          new Date(task.deadline).toLocaleDateString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
          }),
        ]);
      }
      await prisma.task.update({
        where: { id: task.id },
        data:  { alertDispatched: true },
      });
    } catch (err) {
      console.error(`[Alert] Failed for task ${task.id}:`, err);
    }
  }
}
