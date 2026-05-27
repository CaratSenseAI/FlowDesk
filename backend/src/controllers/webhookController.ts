import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { storeWhatsAppMedia, downloadWhatsAppMedia, uploadBufferToCloudinary } from '../services/mediaService';
import { transcribeAudio } from '../services/transcriptionService';
import { detectVoiceIntent } from '../services/intentService';

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
// Message parser (text / image / document / video)
//
// Handles messages like:
//   "TSK-1054 done, mirrors installed"   → status update + comment
//   "done"                               → status update on latest task
//   "issue gateway is down"              → issue report
//   "delay need 2 more days"             → delay request
//   (image/doc with caption)             → media + optional status/comment
//   (image/doc with no caption)          → attachment logged as comment
//   (audio / voice note)                 → Cloudinary upload + NVIDIA transcript
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedReply {
  taskId:  string | null;
  action:  'done' | 'issue' | 'delay' | null;
  comment: string;
}

function parseReply(raw: string): ParsedReply {
  // Extract task ID (e.g. TSK-1054)
  const idMatch = raw.match(/\bTSK-\d+\b/i);
  const taskId  = idMatch ? idMatch[0].toUpperCase() : null;

  // Remove the task ID and surrounding punctuation/spaces
  let rest = raw
    .replace(/\bTSK-\d+\b/i, '')
    .replace(/^[\s,]+|[\s,]+$/g, '')
    .trim();

  // Detect status keyword and strip it, leaving the comment behind
  let action: ParsedReply['action'] = null;

  if (/\bdone\b/i.test(rest)) {
    action = 'done';
    rest = rest.replace(/\bdone\b/i, '').replace(/^[\s,]+/, '').trim();
  } else if (/\bissue\b/i.test(rest)) {
    action = 'issue';
    rest = rest.replace(/\bissue\b/i, '').replace(/^[\s,]+/, '').trim();
  } else if (/\bdelay\b/i.test(rest)) {
    action = 'delay';
    rest = rest.replace(/\bdelay\b/i, '').replace(/^[\s,]+/, '').trim();
  }

  return { taskId, action, comment: rest };
}

// ─────────────────────────────────────────────────────────────────────────────
// Core processing — runs after 200 is already sent to Meta
// ─────────────────────────────────────────────────────────────────────────────

async function processInbound(body: unknown): Promise<void> {
  const entry   = (body as any)?.entry?.[0]?.changes?.[0]?.value;
  const message = entry?.messages?.[0];
  if (!message) return;

  // Meta always sends phone as digits-only E.164 (e.g. "919174192837")
  const senderPhone: string = (message.from as string).replace(/\D/g, '');
  const msgType: string     = message.type;

  // ── 1. Extract text + optional media ID based on message type ────────────
  let rawText = '';
  let mediaId: string | null = null;

  switch (msgType) {
    case 'text':
      rawText = (message.text?.body     as string ?? '').trim();
      break;
    case 'image':
      rawText = (message.image?.caption   as string ?? '').trim();
      mediaId = message.image?.id   ?? null;
      break;
    case 'document':
      rawText = (message.document?.caption as string ?? '').trim();
      mediaId = message.document?.id ?? null;
      break;
    case 'video':
      rawText = (message.video?.caption   as string ?? '').trim();
      mediaId = message.video?.id   ?? null;
      break;
    case 'audio':
      // Voice notes — no caption possible. The media pipeline runs separately below.
      mediaId = message.audio?.id ?? null;
      if (!mediaId) return; // nothing to process
      break;
    case 'interactive': {
      const iType = message.interactive?.type as string;
      if (iType === 'button_reply') {
        rawText = (message.interactive.button_reply?.id as string ?? '').trim();
        console.log(`[Webhook] Button tap from ${senderPhone}: id="${rawText}"`);
      } else if (iType === 'list_reply') {
        rawText = (message.interactive.list_reply?.id as string ?? '').trim();
        console.log(`[Webhook] List select from ${senderPhone}: id="${rawText}"`);
      } else {
        return;
      }
      break;
    }
    default:
      // sticker, reaction, location — ignore
      return;
  }

  // ── 2. Parse the text (not relevant for voice notes) ────────────────────
  const { taskId, action: textAction, comment } = parseReply(rawText);

  // ── 3. Find the task ─────────────────────────────────────────────────────
  let task = null;

  if (taskId) {
    task = await prisma.task.findFirst({
      where: {
        id:         taskId,
        assignedTo: { phone: { contains: senderPhone.slice(-10) } },
      },
      include: { assignedTo: true },
    });

    if (!task) {
      const exists = await prisma.task.findUnique({ where: { id: taskId }, select: { id: true } });
      if (exists) {
        console.log(`[Webhook] REJECTED: ${senderPhone} tried to act on ${taskId} — not their task`);
        return;
      }
    }
  }

  if (!task) {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    task = await prisma.task.findFirst({
      where: {
        alertDispatched: true,
        updatedAt:  { gt: sevenDaysAgo },
        assignedTo: { phone: { contains: senderPhone.slice(-10) } },
      },
      orderBy: { updatedAt: 'desc' },
      include: { assignedTo: true },
    });
  }

  if (!task) {
    console.log(`[Webhook] No task found for sender ${senderPhone} (taskId=${taskId ?? 'none'})`);
    return;
  }

  // ── 4. Voice note pipeline (audio type only) ─────────────────────────────
  if (msgType === 'audio' && mediaId) {
    await processVoiceNote(task, mediaId, senderPhone);
    return;
  }

  // ── 5. Download & store attachment for non-audio messages ────────────────
  const mediaUrl = mediaId ? await storeWhatsAppMedia(mediaId) : null;

  // ── 6. Apply action ──────────────────────────────────────────────────────
  if (!textAction) {
    await prisma.activity.create({
      data: {
        taskId: task.id,
        byId:   task.assignedToId,
        type:   'whatsapp',
        text:   rawText || '📎 Attachment received',
        ...(mediaUrl && { mediaUrl }),
      },
    });
    return;
  }

  const STATUS_MAP = {
    done:  'Done',
    issue: 'Issue',
    delay: 'Delay',
  } as const;

  const LABEL_MAP = {
    done:  'Marked done via WhatsApp',
    issue: 'Issue reported via WhatsApp',
    delay: 'Delay requested via WhatsApp',
  };

  const newStatus = STATUS_MAP[textAction];
  const actText   = comment
    ? `${LABEL_MAP[textAction]}: ${comment}`
    : LABEL_MAP[textAction];

  await prisma.task.update({
    where: { id: task.id },
    data: {
      status: newStatus,
      activities: {
        create: {
          byId: task.assignedToId,
          type: 'whatsapp',
          text: actText,
          ...(mediaUrl && { mediaUrl }),
        },
      },
    },
  });

  console.log(`[Webhook] Task ${task.id} → ${newStatus}${comment ? ` (${comment})` : ''}${mediaUrl ? ' + attachment' : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Voice note sub-pipeline
//
// 1. Download the audio from Meta (one HTTP call)
// 2. In parallel: upload to Cloudinary + run NVIDIA ASR transcription
// 3. Run intent detection on the transcript
// 4. Persist the activity (type: voicenote) with mediaUrl + transcription
// 5. If a clear intent was found, update the task status
// ─────────────────────────────────────────────────────────────────────────────

async function processVoiceNote(
  task:         { id: string; assignedToId: string },
  mediaId:      string,
  senderPhone:  string,
): Promise<void> {
  console.log(`[Webhook] 🎙️ Voice note received for task ${task.id} (mediaId: ${mediaId})`);

  // Step 1 — download once
  const downloaded = await downloadWhatsAppMedia(mediaId);

  if (!downloaded) {
    // Download failed — log a minimal activity so it's not silently dropped
    await prisma.activity.create({
      data: {
        taskId: task.id,
        byId:   task.assignedToId,
        type:   'voicenote',
        text:   '🎙️ Voice note received (download failed)',
      },
    });
    return;
  }

  const { buffer, mimeType } = downloaded;

  // Step 2 — Cloudinary upload + NVIDIA transcription run in parallel
  const [cloudinaryUrl, transcript] = await Promise.all([
    uploadBufferToCloudinary(buffer, mediaId, 'flowdesk/voice-notes'),
    transcribeAudio(buffer, mimeType),
  ]);

  // Step 3 — intent detection
  const { action, confidence } = await detectVoiceIntent(transcript ?? '');

  console.log(`[Webhook] 🎙️  Transcript: "${(transcript ?? '').slice(0, 80)}${(transcript?.length ?? 0) > 80 ? '…' : ''}"`);
  console.log(`[Webhook] 🎙️  Intent: ${action ?? 'none'} (${confidence})`);

  // Step 4 — build activity text
  const STATUS_MAP = {
    done:  'Done',
    issue: 'Issue',
    delay: 'Delay',
  } as const;

  const actText = action
    ? `🎙️ Voice note — ${action} (${confidence} match)`
    : '🎙️ Voice note received';

  // Step 5 — persist + optionally update status
  if (action) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        status: STATUS_MAP[action],
        activities: {
          create: {
            byId:          task.assignedToId,
            type:          'voicenote',
            text:          actText,
            ...(cloudinaryUrl  && { mediaUrl:      cloudinaryUrl }),
            ...(transcript     && { transcription: transcript }),
          },
        },
      },
    });
    console.log(`[Webhook] Task ${task.id} → ${STATUS_MAP[action]} via voice note`);
  } else {
    await prisma.activity.create({
      data: {
        taskId:        task.id,
        byId:          task.assignedToId,
        type:          'voicenote',
        text:          actText,
        ...(cloudinaryUrl  && { mediaUrl:      cloudinaryUrl }),
        ...(transcript     && { transcription: transcript }),
      },
    });
  }
}
