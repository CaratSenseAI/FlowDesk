import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { storeWhatsAppMedia, downloadWhatsAppMedia, uploadBufferToCloudinary } from '../services/mediaService';
import { transcribeAudio } from '../services/transcriptionService';
import { analyzeMessage, hasExplicitTaskRef, IntentResult } from '../services/intentService';

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

// ─────────────────────────────────────────────────────────────────────────────
// Inbound message receiver — Meta requires 200 within 3 seconds
// ─────────────────────────────────────────────────────────────────────────────

export function receiveWebhook(req: Request, res: Response): void {
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
//   1. Pull text + media out of the Meta payload. Voice notes are transcribed
//      HERE, before anything else — the transcript is the only thing that says
//      which task the worker meant.
//   2. Run intent analysis on that text (AI first, keywords as fallback).
//   3. Resolve the task from the reference in the message, falling back to the
//      worker's most recent open task only when they didn't name one.
//   4. Apply one of the outcome workflows.
// ─────────────────────────────────────────────────────────────────────────────

interface InboundMessage {
  senderPhone:  string;
  /** Text to analyse — caption, body, button id, or voice-note transcript. */
  text:         string;
  /** Cloudinary URL of any attachment, once stored. */
  mediaUrl:     string | null;
  /** Drives the bubble style in the tracker. */
  activityType: 'whatsapp' | 'voicenote';
  /** Voice notes carry a transcript that is shown under the audio player. */
  transcript:   string | null;
}

async function processInbound(body: unknown): Promise<void> {
  const entry   = (body as any)?.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) return;

  // Meta always sends phone as digits-only E.164 (e.g. "919174192837")
  const senderPhone: string = (message.from as string).replace(/\D/g, '');

  const inbound = await extractInbound(message, senderPhone);
  if (!inbound) return;

  // ── Understand the message ───────────────────────────────────────────────
  const intent = await analyzeMessage(inbound.text);

  // ── Find the task it belongs to ──────────────────────────────────────────
  const match = await resolveTask(senderPhone, intent.taskRef, inbound.text);
  if (!match) return;

  await applyOutcome(match, intent, inbound);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — normalise the Meta payload into text + stored media
// ─────────────────────────────────────────────────────────────────────────────

async function extractInbound(
  message:     any,
  senderPhone: string,
): Promise<InboundMessage | null> {
  const msgType: string = message.type;

  switch (msgType) {
    case 'text':
      return {
        senderPhone,
        text:         (message.text?.body as string ?? '').trim(),
        mediaUrl:     null,
        activityType: 'whatsapp',
        transcript:   null,
      };

    case 'image':
    case 'document':
    case 'video': {
      const payload = message[msgType];
      const mediaId = payload?.id ?? null;
      return {
        senderPhone,
        text:         (payload?.caption as string ?? '').trim(),
        mediaUrl:     mediaId ? await storeWhatsAppMedia(mediaId) : null,
        activityType: 'whatsapp',
        transcript:   null,
      };
    }

    case 'audio': {
      // Voice notes have no caption — the transcript IS the message. It has to
      // be produced before task resolution, because "task 1058 completed" only
      // exists inside the audio.
      const mediaId = message.audio?.id ?? null;
      if (!mediaId) return null;

      console.log(`[Webhook] 🎙️  Voice note from ${senderPhone} (mediaId: ${mediaId})`);

      const downloaded = await downloadWhatsAppMedia(mediaId);
      if (!downloaded) {
        console.warn('[Webhook] 🎙️  Voice note download failed');
        return {
          senderPhone,
          text:         '',
          mediaUrl:     null,
          activityType: 'voicenote',
          transcript:   null,
        };
      }

      const [cloudinaryUrl, transcript] = await Promise.all([
        uploadBufferToCloudinary(downloaded.buffer, mediaId, 'flowdesk/voice-notes'),
        transcribeAudio(downloaded.buffer, downloaded.mimeType),
      ]);

      console.log(`[Webhook] 🎙️  Transcript: "${(transcript ?? '').slice(0, 100)}"`);

      return {
        senderPhone,
        text:         transcript ?? '',
        mediaUrl:     cloudinaryUrl ?? null,
        activityType: 'voicenote',
        transcript:   transcript ?? null,
      };
    }

    case 'interactive': {
      const iType = message.interactive?.type as string;
      if (iType === 'button_reply') {
        const id = (message.interactive.button_reply?.id as string ?? '').trim();
        console.log(`[Webhook] Button tap from ${senderPhone}: id="${id}"`);
        return { senderPhone, text: id, mediaUrl: null, activityType: 'whatsapp', transcript: null };
      }
      if (iType === 'list_reply') {
        const id = (message.interactive.list_reply?.id as string ?? '').trim();
        console.log(`[Webhook] List select from ${senderPhone}: id="${id}"`);
        return { senderPhone, text: id, mediaUrl: null, activityType: 'whatsapp', transcript: null };
      }
      return null;
    }

    default:
      // sticker, reaction, location — ignore
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — task resolution
//
// The old version only recognised the literal form "TSK-1058" and otherwise
// grabbed whichever task was updated most recently. That meant every reply
// landed on the newest task regardless of what the worker said. Now:
//
//   • an explicit reference wins, and is checked against the sender's tasks
//   • the fallback prefers OPEN tasks, so a finished task stops absorbing replies
//   • the fallback is recorded so a misroute is visible in the tracker
// ─────────────────────────────────────────────────────────────────────────────

type TaskRow = { id: string; status: string; approved: boolean; assignedToId: string };

interface TaskMatch {
  task:      TaskRow;
  matchedBy: 'reference' | 'fallback';
  /** Number of open tasks the worker had when we guessed — >1 means ambiguous. */
  openCount: number;
}

const TASK_FIELDS = { id: true, status: true, approved: true, assignedToId: true } as const;

/** Matches on the last 10 digits so "+91 91741 92837" and "919174192837" agree. */
function phoneWhere(senderPhone: string) {
  return { phone: { contains: senderPhone.slice(-10) } };
}

async function resolveTask(
  senderPhone: string,
  taskRef:     string | null,
  rawText:     string,
): Promise<TaskMatch | null> {
  // ── Explicit reference ───────────────────────────────────────────────────
  if (taskRef) {
    const owned = await prisma.task.findFirst({
      where:  { id: taskRef, assignedTo: phoneWhere(senderPhone) },
      select: TASK_FIELDS,
    });

    if (owned) {
      console.log(`[Webhook] Matched ${taskRef} by reference`);
      return { task: owned, matchedBy: 'reference', openCount: 0 };
    }

    const existsForSomeoneElse = await prisma.task.findUnique({
      where:  { id: taskRef },
      select: { id: true },
    });

    // Only treat this as an attempt to act on someone else's task when the
    // worker actually named it ("TSK-1058"). A bare number could just as
    // easily be a quantity — "5000 units done" must not be silently dropped
    // because TSK-5000 happens to belong to a colleague.
    if (existsForSomeoneElse && hasExplicitTaskRef(rawText)) {
      console.log(`[Webhook] REJECTED: ${senderPhone} referenced ${taskRef} — not their task`);
      return null;
    }

    // Referenced a task number that doesn't exist. Could be a transcription
    // slip ("1058" heard as "1053"), so fall through to the open-task guess
    // rather than dropping the worker's message on the floor.
    console.log(`[Webhook] ${taskRef} not found — falling back to most recent open task`);
  }

  // ── Fallback: their most recently touched OPEN task ──────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recent = {
    alertDispatched: true,
    updatedAt:       { gt: sevenDaysAgo },
    assignedTo:      phoneWhere(senderPhone),
  };

  const openTasks = await prisma.task.findMany({
    where:   { ...recent, status: { not: 'Done' as const } },
    orderBy: { updatedAt: 'desc' },
    select:  TASK_FIELDS,
  });

  if (openTasks.length > 0) {
    if (openTasks.length > 1) {
      console.warn(
        `[Webhook] AMBIGUOUS: ${senderPhone} has ${openTasks.length} open tasks and named none — ` +
        `assuming ${openTasks[0].id}`,
      );
    }
    return { task: openTasks[0], matchedBy: 'fallback', openCount: openTasks.length };
  }

  // Nothing open — fall back to any recent task so follow-up comments on a
  // finished task still land somewhere sensible.
  const anyRecent = await prisma.task.findFirst({
    where:   recent,
    orderBy: { updatedAt: 'desc' },
    select:  TASK_FIELDS,
  });

  if (!anyRecent) {
    console.log(`[Webhook] No task found for sender ${senderPhone} (ref=${taskRef ?? 'none'})`);
    return null;
  }

  return { task: anyRecent, matchedBy: 'fallback', openCount: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — outcome workflows
//
//   A. done + evidence  → Done, auto-approved      ("completely done")
//   B. done, no evidence → Done, awaiting approval ("marked complete")
//   C. issue / delay     → Issue / Delay
//   D. progress / unclear → logged as a comment, status untouched
//
// A repeat of an outcome the task is already in is logged to the thread but
// does not rewrite the status — that stops a second "task done" message from
// firing another status change and another notification.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_MAP = {
  done:  'Done',
  issue: 'Issue',
  delay: 'Delay',
} as const;

const LABEL_MAP = {
  done:  'Marked done via WhatsApp',
  issue: 'Issue reported via WhatsApp',
  delay: 'Delay requested via WhatsApp',
} as const;

async function applyOutcome(
  match:   TaskMatch,
  intent:  IntentResult,
  inbound: InboundMessage,
): Promise<void> {
  const { task } = match;
  const { action } = intent;

  // ── Workflow D — nothing actionable, just record the message ─────────────
  if (action === null || action === 'progress') {
    await logActivity(task, inbound, {
      text: intent.summary || inbound.text || '📎 Attachment received',
      type: inbound.activityType,
    });
    console.log(`[Webhook] ${task.id} ← comment only (action=${action ?? 'none'})`);
    return;
  }

  const newStatus = STATUS_MAP[action];

  // Evidence = a photo/document on THIS message, or one already on the task.
  // A worker merely *saying* "I clicked a photo" is not enough to auto-approve;
  // there has to be an actual attachment on the task.
  const hasEvidence =
    (inbound.mediaUrl !== null && inbound.activityType === 'whatsapp') ||
    (await taskHasAttachment(task.id));

  const autoApprove = action === 'done' && hasEvidence;

  // ── Repeat of the state the task is already in ───────────────────────────
  const statusUnchanged   = task.status === newStatus;
  const approvalUnchanged = !autoApprove || task.approved;

  if (statusUnchanged && approvalUnchanged) {
    await logActivity(task, inbound, {
      // `whatsapp_dup` still renders in the tracker thread but is excluded from
      // the notification feed, so a worker repeating themselves doesn't ping the
      // manager twice. Voice notes keep their own type to preserve the player.
      type: inbound.activityType === 'voicenote' ? 'voicenote' : 'whatsapp_dup',
      text: `${LABEL_MAP[action]} (already ${newStatus.toLowerCase()} — no change)`,
    });
    console.log(`[Webhook] ${task.id} already ${newStatus} — logged repeat, no status change`);
    return;
  }

  const parts: string[] = [LABEL_MAP[action]];
  if (intent.summary) parts.push(`: ${intent.summary}`);
  if (autoApprove) parts.push(' ✅ verified with attachment');
  if (match.matchedBy === 'fallback') {
    parts.push(
      intent.taskRef
        ? ` (couldn't find ${intent.taskRef} — matched this task instead)`
        : ' (no task number given — matched most recent open task)',
    );
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: newStatus,
      ...(autoApprove && { approved: true }),
      activities: {
        create: {
          byId:          task.assignedToId,
          type:          inbound.activityType,
          text:          parts.join(''),
          ...(inbound.mediaUrl   && { mediaUrl:      inbound.mediaUrl }),
          ...(inbound.transcript && { transcription: inbound.transcript }),
        },
      },
    },
  });

  console.log(
    `[Webhook] ${task.id} → ${newStatus}` +
    `${autoApprove ? ' (auto-approved)' : ''} via ${intent.confidence} intent`,
  );
}

/** Has the assignee already sent a photo/document on this task? */
async function taskHasAttachment(taskId: string): Promise<boolean> {
  const attachment = await prisma.activity.findFirst({
    where:  { taskId, mediaUrl: { not: null }, type: 'whatsapp' },
    select: { id: true },
  });
  return attachment !== null;
}

async function logActivity(
  task:    TaskRow,
  inbound: InboundMessage,
  opts:    { text: string; type: string },
): Promise<void> {
  await prisma.activity.create({
    data: {
      taskId: task.id,
      byId:   task.assignedToId,
      type:   opts.type,
      text:   opts.text,
      ...(inbound.mediaUrl   && { mediaUrl:      inbound.mediaUrl }),
      ...(inbound.transcript && { transcription: inbound.transcript }),
    },
  });
}
