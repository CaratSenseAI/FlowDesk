import {
  ActionChannel, AttributionSource, DeliveryStatus, MessageDirection, MessageKind,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  SendResult, formatDeadlineIST, richTemplatesApproved, sendMediaMessage,
  sendTaskAssignmentFull, sendTaskAssignmentNotification, sendTaskReassignedFull,
  sendTaskReassignedNotification, sendTextMessage,
} from './whatsappService';
import { computeSession, getLastInbound } from './conversationService';

// ─────────────────────────────────────────────────────────────────────────────
// Recording an outbound template.
//
// Template notifications used to be fire-and-forget everywhere except task
// creation: the escalation cron sent three of them per overdue task and not one
// appeared in the tracker, so a thread opened with the assignee's reply and
// nothing before it — and Meta's delivery receipts had no row to match, so a
// silently failed escalation looked identical to a delivered one.
//
// Never throws. A notification that fails to be *recorded* must not roll back
// the escalation or reassignment that already happened.
// ─────────────────────────────────────────────────────────────────────────────
export async function recordTemplateSend(p: {
  /** Whose conversation this belongs to — the recipient. */
  userId:   string;
  /** Who caused it. `null` for unattended writers like the escalation cron. */
  actorId:  string | null;
  taskId:   string | null;
  /** What the tracker should show. Templates render server-side, so we say it. */
  text:     string;
  result:   SendResult;
}): Promise<void> {
  try {
    await prisma.message.create({
      data: {
        userId:    p.userId,
        // Falling back to the recipient keeps the FK satisfied for the cron,
        // the same way notifyAssignment does for unattended reassignments.
        senderId:  p.actorId ?? p.userId,
        direction: MessageDirection.outbound,
        kind:      MessageKind.system,
        taskId:    p.taskId,
        attributedBy: p.taskId ? AttributionSource.manual : AttributionSource.none,
        text:      p.text,
        waMessageId:    p.result.waMessageId ?? null,
        deliveryStatus: p.result.ok ? DeliveryStatus.sent : DeliveryStatus.failed,
        deliveryError:  p.result.ok ? null : p.result.error ?? 'Send failed',
      },
    });
  } catch (err) {
    console.error('[Notify] Failed recording an outbound template:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Telling somebody they've been given work.
//
// This used to live inline in taskController.createTask, which meant only the
// web "create task" path notified anybody — a reassignment moved a ticket to a
// new owner in silence. Now both go through here.
//
// Two delivery modes, forced on us by Meta rather than chosen:
//
//   session open  → a free-form message. We can say who assigned it, what it's
//                   called, and that they can reply.
//   session shut  → an approved template, which takes exactly two parameters
//                   and cannot carry any of that. The person still learns they
//                   have a task; the detail waits for the dashboard.
//
// Either way the send is recorded as an outbound `Message` so the tracker shows
// the notification instead of the thread starting mid-conversation with the
// assignee's reply — and so Meta's delivery receipts have a row to match.
// ─────────────────────────────────────────────────────────────────────────────

export interface NotifyTask {
  id:    string;
  title: string;
  /** Both optional so older call sites keep compiling; the message is fuller with them. */
  description?:    string | null;
  deadline?:       Date | null;
  attachmentUrl?:  string | null;
  attachmentKind?: string | null;
}

interface NotifyParams {
  task:     NotifyTask;
  assignee: { id: string; name: string; phone: string | null; preferredLanguage: string };
  /** Who caused this. `null` for unattended writers like the escalation cron. */
  actor:    { id: string; name: string } | null;
  /** `new` = the task was just created. `reassigned` = it changed hands. */
  kind:     'new' | 'reassigned';
  /** Only meaningful for `reassigned`; used to word the message. */
  previousAssigneeName?: string | null;
  channel:  ActionChannel;
}

/**
 * The free-form message, sent when the person's 24h window is open. Says what
 * the work is, when it is due, and any details — the same facts the full
 * template carries, so the two paths read alike.
 */
export function bodyFor(p: NotifyParams): string {
  const who   = p.actor?.name ?? 'FlowDesk';
  const lines = [
    p.kind === 'reassigned'
      ? `📋 ${who} has assigned ticket ${p.task.id} to you.`
      : `📋 New task assigned: ${p.task.id}`,
    '',
    `*${p.task.title}*`,
  ];
  if (p.task.deadline) lines.push(`Deadline: ${formatDeadlineIST(p.task.deadline)}`);
  const details = (p.task.description ?? '').trim();
  if (details) lines.push(`Details: ${details.slice(0, 600)}`);
  lines.push('', `Reply here when you've started or finished it.`);
  return lines.join('\n');
}

/**
 * Which send to make. Pure, so the choice is testable without Meta:
 *
 *   window open, image attached  → the image itself, with the message as caption
 *   window open, no image        → free-form text
 *   window shut, rich approved   → task_assignment_image / _full / task_reassigned_full
 *   window shut, not yet approved→ the original two-slot templates
 */
export type AssignmentSend =
  | 'media_with_caption' | 'free_text'
  | 'template_image' | 'template_full' | 'template_reassigned_full'
  | 'template_legacy_assignment' | 'template_legacy_reassigned';

export function chooseAssignmentSend(o: {
  sessionOpen: boolean; kind: 'new' | 'reassigned'; hasImage: boolean; richApproved: boolean;
}): AssignmentSend {
  if (o.sessionOpen) return o.hasImage ? 'media_with_caption' : 'free_text';
  if (!o.richApproved) {
    return o.kind === 'reassigned' ? 'template_legacy_reassigned' : 'template_legacy_assignment';
  }
  if (o.kind === 'reassigned') return 'template_reassigned_full';
  return o.hasImage ? 'template_image' : 'template_full';
}

/**
 * Notify an assignee over WhatsApp and record the attempt.
 *
 * Never throws — a notification failing must not roll back a reassignment that
 * already succeeded. Callers fire and forget; the delivery outcome is on the
 * `Message` row either way, including the failure reason.
 */
export async function notifyAssignment(p: NotifyParams): Promise<void> {
  try {
    if (!p.assignee.phone) {
      console.warn(
        `[Notify] Skipping WhatsApp for ${p.task.id} — "${p.assignee.name}" has no phone number set.`,
      );
      return;
    }

    const session  = computeSession(await getLastInbound(p.assignee.id));
    const hasImage = p.task.attachmentKind === 'image' && !!p.task.attachmentUrl;
    const details  = {
      assigneeName: p.assignee.name, taskId: p.task.id, title: p.task.title,
      deadline: p.task.deadline ?? new Date(), description: p.task.description ?? null,
    };
    const choice = chooseAssignmentSend({
      sessionOpen: session.open, kind: p.kind, hasImage, richApproved: richTemplatesApproved(),
    });

    // Outside the window a template is the only thing Meta will deliver. Which
    // one depends on what has been approved — see chooseAssignmentSend.
    let result: SendResult;
    switch (choice) {
      case 'media_with_caption':
        result = await sendMediaMessage(p.assignee.phone, p.task.attachmentUrl!, { kind: 'image', caption: bodyFor(p) });
        break;
      case 'free_text':
        result = await sendTextMessage(p.assignee.phone, bodyFor(p));
        break;
      case 'template_image':
        result = await sendTaskAssignmentFull(p.assignee.phone, { ...details, imageUrl: p.task.attachmentUrl }, p.assignee.preferredLanguage);
        break;
      case 'template_full':
        result = await sendTaskAssignmentFull(p.assignee.phone, details, p.assignee.preferredLanguage);
        break;
      case 'template_reassigned_full':
        result = await sendTaskReassignedFull(p.assignee.phone, { ...details, movedBy: p.actor?.name ?? 'FlowDesk' }, p.assignee.preferredLanguage);
        break;
      case 'template_legacy_reassigned':
        result = await sendTaskReassignedNotification(p.assignee.phone, p.assignee.name, p.actor?.name ?? 'FlowDesk', p.task.id, p.assignee.preferredLanguage);
        break;
      default:
        result = await sendTaskAssignmentNotification(p.assignee.phone, p.assignee.name, p.task.id, p.assignee.preferredLanguage);
    }

    const sentImage = choice === 'media_with_caption' || choice === 'template_image';
    await prisma.message.create({
      data: {
        userId:   p.assignee.id,
        // The conversation belongs to the assignee; the actor is whoever moved
        // the task. Falling back to the assignee keeps the FK satisfied for
        // unattended writers.
        senderId: p.actor?.id ?? p.assignee.id,
        direction: MessageDirection.outbound,
        kind:      sentImage ? MessageKind.image : session.open ? MessageKind.text : MessageKind.system,
        taskId:    p.task.id,
        attributedBy: AttributionSource.manual,
        text: p.kind === 'reassigned'
          ? `📋 ${p.actor?.name ?? 'FlowDesk'} assigned ${p.task.id} to you — ${p.task.title}`
          : `📋 New task assigned: ${p.task.id} — ${p.task.title}`,
        mediaUrl:       sentImage ? p.task.attachmentUrl : null,
        waMessageId:    result.waMessageId ?? null,
        deliveryStatus: result.ok ? DeliveryStatus.sent : DeliveryStatus.failed,
        deliveryError:  result.ok ? null : result.error ?? 'Send failed',
      },
    });
    console.log(`[Notify] ${p.task.id} → ${p.assignee.name}: ${choice} ${result.ok ? '✅' : '❌ ' + result.error}`);

    // The 48h advance-alert sweep in escalationService keys off this flag. A
    // freshly notified task must not immediately get a second ping from it.
    await prisma.task.update({
      where: { id: p.task.id },
      data:  { alertDispatched: true },
    });
  } catch (err) {
    console.error(`[Notify] Failed notifying ${p.assignee.name} about ${p.task.id}:`, err);
  }
}
