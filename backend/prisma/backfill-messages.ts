/**
 * One-shot backfill: legacy WhatsApp `Activity` rows → `Message` rows.
 *
 *   npm run db:backfill
 *
 * Before the conversation refactor, every WhatsApp message was stored as an
 * Activity attached to exactly one task. Those rows are the existing chat
 * history, so they have to appear in the new per-user threads.
 *
 * SAFE TO RE-RUN. Every inserted row carries `legacyActivityId`, which is
 * @unique, and the insert uses `skipDuplicates`. Running this twice inserts
 * nothing the second time — without that guard a re-run would silently double
 * every message in every conversation.
 *
 * This deliberately does NOT delete the legacy Activity rows. They are the
 * rollback path: if the new tracker has to be reverted, the old one still has
 * its data. Pruning them is a separate, later decision.
 */
import { PrismaClient, MessageDirection, MessageKind } from '@prisma/client';

const prisma = new PrismaClient();

const INBOUND_TYPES  = ['whatsapp', 'whatsapp_dup', 'voicenote'];
const OUTBOUND_TYPES = ['outbound'];
const LEGACY_TYPES   = [...INBOUND_TYPES, ...OUTBOUND_TYPES];

const BATCH_SIZE = 500;

/**
 * Legacy rows never recorded the media type — only a Cloudinary URL. A
 * `whatsapp` row with mediaUrl could have been an image, a document or a
 * video and there is no way to recover which. `image` is the overwhelmingly
 * common case, and ChatBubble falls back gracefully when the URL doesn't
 * render as one.
 */
function inferKind(type: string, mediaUrl: string | null): MessageKind {
  if (type === 'voicenote') return MessageKind.voice;
  if (mediaUrl) return MessageKind.image;
  return MessageKind.text;
}

async function main(): Promise<void> {
  console.log('[backfill] scanning legacy WhatsApp activities…');

  let cursor: string | undefined;
  let scanned = 0;
  let inserted = 0;
  let skippedNoTask = 0;

  for (;;) {
    const batch = await prisma.activity.findMany({
      where: { type: { in: LEGACY_TYPES } },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
      ...(cursor && { skip: 1, cursor: { id: cursor } }),
      include: { task: { select: { assignedToId: true } } },
    });

    if (batch.length === 0) break;
    cursor = batch[batch.length - 1].id;
    scanned += batch.length;

    const rows = batch
      .filter((a) => {
        // The task relation is required, so this should never be null. Guard
        // anyway rather than crashing a migration halfway through.
        if (!a.task) {
          skippedNoTask += 1;
          console.warn(`[backfill] activity ${a.id} has no task — skipping`);
          return false;
        }
        return true;
      })
      .map((a) => ({
        // Conversation owner is the ASSIGNEE for both directions: an outbound
        // message from a manager still belongs in the employee's thread.
        userId:   a.task!.assignedToId,
        // Actor is whoever the activity was attributed to — preserves the
        // inbound(employee) / outbound(manager) asymmetry.
        senderId: a.byId,
        direction: INBOUND_TYPES.includes(a.type)
          ? MessageDirection.inbound
          : MessageDirection.outbound,
        kind:   inferKind(a.type, a.mediaUrl),
        taskId: a.taskId,
        // "manual" is the honest default: these rows predate attribution
        // tracking, so we genuinely don't know how they were routed.
        attributedBy:     'manual' as const,
        needsAttribution: false,
        text:             a.text,
        mediaUrl:         a.mediaUrl,
        transcription:    a.transcription,
        waMessageId:      null,
        deliveryStatus:   'sent' as const,
        legacyActivityId: a.id,
        createdAt:        a.createdAt,
      }));

    if (rows.length > 0) {
      const res = await prisma.message.createMany({ data: rows, skipDuplicates: true });
      inserted += res.count;
    }

    console.log(`[backfill] scanned ${scanned}, inserted ${inserted}…`);
  }

  const total = await prisma.message.count();
  console.log('\n[backfill] done');
  console.log(`  scanned legacy activities : ${scanned}`);
  console.log(`  inserted messages         : ${inserted}`);
  console.log(`  skipped (already present) : ${scanned - inserted - skippedNoTask}`);
  if (skippedNoTask > 0) console.log(`  skipped (no task)         : ${skippedNoTask}`);
  console.log(`  total messages in table   : ${total}`);
}

main()
  .catch((err) => {
    console.error('[backfill] FAILED:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
