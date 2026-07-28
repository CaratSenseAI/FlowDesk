import crypto from 'crypto';
import { Request, Response } from 'express';
import {
  AttributionSource, MessageDirection, MessageKind, Prisma, TaskStatus,
} from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ACTIVITY_TYPE, MAX_LIST_ROWS } from '../lib/constants';
import { storeWhatsAppMedia, downloadWhatsAppMedia, uploadBufferToCloudinary } from '../services/mediaService';
import { transcribeAudio } from '../services/transcriptionService';
import { analyzeMessage, hasExplicitTaskRef, IntentResult } from '../services/intentService';
import { decideAttribution } from '../services/attributionService';
import {
  adoptRecentUnattributed, findPendingAttribution, getLastAttributedTaskId,
  getUserTaskContext, kindFromMetaType, resolveUserByPhone, taskHasEvidence,
} from '../services/conversationService';
import { sendInteractiveList, sendTextMessage } from '../services/whatsappService';

// ─────────────────────────────────────────────────────────────────────────────
// Webhook verification (Meta challenge handshake)
// ─────────────────────────────────────────────────────────────────────────────

export function verifyWebhook(req: Request, res: Response): void {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
}

/**
 * Verify Meta's payload signature.
 *
 * `index.ts` already mounts express.raw() on this route specifically so the
 * exact bytes are available for this check — but the check itself was never
 * written, leaving the endpoint forgeable: anyone who found the URL could POST
 * fake worker replies and flip task statuses.
 *
 * When META_APP_SECRET is unset we warn and allow, so existing deployments
 * don't break the moment this ships. Set it in production.
 */
function verifyMetaSignature(req: Request): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn('[Webhook] META_APP_SECRET not set — accepting unverified payload');
    return true;
  }

  const header = req.get('x-hub-signature-256');
  if (!header?.startsWith('sha256=')) {
    console.error('[Webhook] REJECTED: missing or malformed X-Hub-Signature-256');
    return false;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body), 'utf8');
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    console.error('[Webhook] REJECTED: signature mismatch');
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound receiver — Meta requires a 200 within 3 seconds
// ─────────────────────────────────────────────────────────────────────────────

export function receiveWebhook(req: Request, res: Response): void {
  if (!verifyMetaSignature(req)) {
    res.sendStatus(403);
    return;
  }

  res.status(200).send('EVENT_RECEIVED');

  // express.raw() gives a Buffer; express.json() gives an object; handle all three
  let body: unknown;
  try {
    if (Buffer.isBuffer(req.body)) {
      body = JSON.parse(req.body.toString('utf8'));
    } else if (typeof req.body === 'string') {
      body = JSON.parse(req.body);
    } else {
      body = req.body;
    }
  } catch {
    console.error('[Webhook] Failed to parse body');
    return;
  }

  setImmediate(() => processInbound(body).catch(console.error));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline
//
//   1. Dedupe on Meta's message id — BEFORE any expensive work, so a retried
//      delivery doesn't re-download and re-transcribe the same audio.
//   2. Resolve the sender to a user (the conversation owner).
//   3. Extract text + media. Voice notes are transcribed here, because the
//      transcript is the only thing that says which task they meant.
//   4. Work out intent, then which task it belongs to.
//   5. Always persist one Message — including rejected and unattributed ones.
//   6. Apply an outcome only when we're confident which task it was.
// ─────────────────────────────────────────────────────────────────────────────

interface InboundContent {
  text:          string;
  mediaUrl:      string | null;
  transcription: string | null;
  kind:          MessageKind;
}

async function processInbound(body: unknown): Promise<void> {
  const value = (body as any)?.entry?.[0]?.changes?.[0]?.value;
  const messages = value?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;

  // Meta can batch several messages into one delivery. The old code read
  // messages[0] and silently dropped the rest.
  for (const message of messages) {
    try {
      await processMessage(message);
    } catch (err) {
      console.error(`[Webhook] Failed processing message ${message?.id}:`, err);
    }
  }
}

async function processMessage(message: any): Promise<void> {
  const waMessageId: string | null = message?.id ?? null;

  // ── 1. Idempotency ───────────────────────────────────────────────────────
  if (waMessageId) {
    const seen = await prisma.message.findUnique({
      where:  { waMessageId },
      select: { id: true },
    });
    if (seen) {
      console.log(`[Webhook] duplicate delivery ${waMessageId} — ignoring`);
      return;
    }
  }

  // ── 2. Who is this? ──────────────────────────────────────────────────────
  const senderPhone = String(message.from ?? '').replace(/\D/g, '');
  const user = await resolveUserByPhone(senderPhone);
  if (!user) {
    console.log(`[Webhook] No user matches phone ${senderPhone} — ignoring`);
    return;
  }

  // ── 3. Text + media ──────────────────────────────────────────────────────
  const content = await extractContent(message);
  if (!content) return;

  // ── 4. Intent + attribution ──────────────────────────────────────────────
  const intent = await analyzeMessage(content.text);
  const { ownedTaskIds, openTasks, allTasks } = await getUserTaskContext(user.id);
  const pending = await findPendingAttribution(user.id);

  const decision = decideAttribution({
    explicitRef:          intent.taskRef,
    refIsExplicit:        hasExplicitTaskRef(content.text),
    ownedTaskIds,
    openTasks:            openTasks.map((t) => ({ id: t.id, updatedAt: t.updatedAt })),
    lastAttributedTaskId: await getLastAttributedTaskId(user.id),
    action:               intent.action,
    pendingTaskChoice:    pending !== null,
  });

  // ── 5. Persist the message, always ───────────────────────────────────────
  // Even a rejected or unroutable message gets recorded. Dropping it on the
  // floor is what made the old misroutes invisible.
  const created = await prisma.message.create({
    data: {
      userId:           user.id,
      senderId:         user.id,          // inbound: actor is the owner
      direction:        MessageDirection.inbound,
      kind:             content.kind,
      taskId:           decision.taskId,
      attributedBy:     decision.attributedBy,
      needsAttribution: decision.needsAttribution,
      intentAction:     decision.needsAttribution ? intent.action : null,
      intentConfidence: decision.needsAttribution ? intent.confidence : null,
      text:             content.text,
      mediaUrl:         content.mediaUrl,
      transcription:    content.transcription,
      waMessageId,
    },
  });

  // ── 6. Act ───────────────────────────────────────────────────────────────
  if (decision.rejected) {
    console.log(`[Webhook] ${user.name} referenced ${intent.taskRef} — not their task`);
    await sendTextMessage(
      user.phone!,
      `${intent.taskRef} isn't assigned to you, so I haven't changed it. ` +
      `Reply with one of your own task numbers if you meant a different one.`,
    );
    return;
  }

  if (decision.needsAttribution) {
    await askWhichTask(user, decision.ambiguousAmong, allTasks);
    console.log(
      `[Webhook] ${user.name}: "${intent.action}" but ${decision.ambiguousAmong.length} open tasks — asked which`,
    );
    return;
  }

  if (!decision.taskId) return;

  // The worker has named a task while an earlier message was waiting on one,
  // so that earlier message is resolved either way.
  if (pending) await resolvePending(pending.id, decision.taskId);

  // Which outcome applies? The one in THIS message if it stated one; otherwise
  // the one parked on the message that was awaiting a task.
  //
  // Order matters. "TSK-1055 issue" after a parked "done" must report an issue
  // on TSK-1055 — applying the parked "done" instead would mark it complete.
  const action  = intent.action ?? (pending?.intentAction as IntentResult['action'] ?? null);
  const summary = intent.action ? intent.summary : pending?.text ?? '';

  if (action) {
    await applyOutcome(decision.taskId, user.id, action, {
      messageId: created.id,
      summary,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content extraction
// ─────────────────────────────────────────────────────────────────────────────

async function extractContent(message: any): Promise<InboundContent | null> {
  const msgType: string = message.type;
  const kind = kindFromMetaType(msgType);

  switch (msgType) {
    case 'text':
      return {
        text: String(message.text?.body ?? '').trim(),
        mediaUrl: null, transcription: null, kind,
      };

    case 'image':
    case 'document':
    case 'video': {
      const payload = message[msgType];
      const mediaId = payload?.id ?? null;
      return {
        text: String(payload?.caption ?? '').trim(),
        mediaUrl: mediaId ? await storeWhatsAppMedia(mediaId) : null,
        transcription: null, kind,
      };
    }

    case 'audio': {
      // Voice notes have no caption — the transcript IS the message, and it
      // has to exist before we can tell which task they meant.
      const mediaId = message.audio?.id ?? null;
      if (!mediaId) return null;

      const downloaded = await downloadWhatsAppMedia(mediaId);
      if (!downloaded) {
        console.warn('[Webhook] 🎙️ voice note download failed');
        return { text: '', mediaUrl: null, transcription: null, kind };
      }

      const [cloudinaryUrl, transcript] = await Promise.all([
        uploadBufferToCloudinary(downloaded.buffer, mediaId, 'flowdesk/voice-notes'),
        transcribeAudio(downloaded.buffer, downloaded.mimeType),
      ]);

      console.log(`[Webhook] 🎙️ transcript: "${(transcript ?? '').slice(0, 100)}"`);
      return {
        text: transcript ?? '',
        mediaUrl: cloudinaryUrl ?? null,
        transcription: transcript ?? null,
        kind,
      };
    }

    case 'interactive': {
      const i = message.interactive;
      const id = String(
        i?.type === 'button_reply' ? i.button_reply?.id
        : i?.type === 'list_reply' ? i.list_reply?.id
        : '',
      ).trim();
      if (!id) return null;
      console.log(`[Webhook] interactive reply: "${id}"`);
      return { text: id, mediaUrl: null, transcription: null, kind };
    }

    default:
      // sticker, reaction, location — ignore
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disambiguation
// ─────────────────────────────────────────────────────────────────────────────

async function askWhichTask(
  user: { id: string; phone: string | null; name: string },
  candidateIds: string[],
  allTasks: { id: string; title: string }[],
): Promise<void> {
  if (!user.phone) return;

  const titleById = new Map(allTasks.map((t) => [t.id, t.title]));
  const rows = candidateIds.slice(0, MAX_LIST_ROWS).map((id) => ({
    id,
    title: id.slice(0, 24),                                   // Meta caps at 24
    description: (titleById.get(id) ?? '').slice(0, 72),      // and 72
  }));

  await sendInteractiveList(
    user.phone,
    'Which task did you mean?',
    'Choose task',
    [{ title: 'Your open tasks', rows }],
    undefined,
    'Tap one, or reply with the task number.',
  );
}

/** Link a parked message to the task the worker finally picked. */
async function resolvePending(messageId: string, taskId: string): Promise<void> {
  await prisma.message.update({
    where: { id: messageId },
    data: { taskId, attributedBy: AttributionSource.list_reply, needsAttribution: false },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Outcomes
//
//   done + photo/document on the task → Done, auto-approved
//   done, no evidence                 → Done, awaiting approval
//   issue / delay                     → Issue / Delay
//
// The message text itself lives in `Message`. What lands in `Activity` is the
// audit row for the status change, so nothing is rendered twice and the task
// history stays complete.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, TaskStatus> = {
  done:  TaskStatus.Done,
  issue: TaskStatus.Issue,
  delay: TaskStatus.Delay,
};

const LABEL_MAP: Record<string, string> = {
  done:  'Marked done via WhatsApp',
  issue: 'Issue reported via WhatsApp',
  delay: 'Delay requested via WhatsApp',
};

async function applyOutcome(
  taskId: string,
  userId: string,
  action: IntentResult['action'],
  ctx: { messageId: string; summary: string },
): Promise<void> {
  if (!action || !STATUS_MAP[action]) return;

  const task = await prisma.task.findUnique({
    where:  { id: taskId },
    select: { id: true, status: true, approved: true, assignedToId: true },
  });
  if (!task) return;

  const newStatus = STATUS_MAP[action];

  // A photo sent moments before "task 1060 done" should still count as proof.
  if (action === 'done') await adoptRecentUnattributed(userId, taskId);

  const autoApprove = action === 'done' && (await taskHasEvidence(taskId));

  // Repeating an outcome the task is already in shouldn't rewrite the status
  // or fire a second notification. The message is already recorded either way.
  if (task.status === newStatus && (!autoApprove || task.approved)) {
    console.log(`[Webhook] ${taskId} already ${newStatus} — message logged, no status change`);
    return;
  }

  const parts = [LABEL_MAP[action]];
  if (ctx.summary) parts.push(`: ${ctx.summary}`);
  if (autoApprove) parts.push(' ✅ verified with attachment');

  // One transaction so a status change can never exist without its audit row.
  await prisma.$transaction([
    prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        ...(autoApprove && { approved: true }),
      },
    }),
    prisma.activity.create({
      data: {
        taskId,
        byId: task.assignedToId,
        type: ACTIVITY_TYPE.STATUS,
        text: parts.join(''),
      },
    }),
  ]);

  console.log(`[Webhook] ${taskId} → ${newStatus}${autoApprove ? ' (auto-approved)' : ''}`);
}

// Exported for integration tests: receiveWebhook answers Meta before any of
// this runs, so a test that drives the HTTP route can't observe the result.
export const __test = { processInbound, processMessage, applyOutcome };
