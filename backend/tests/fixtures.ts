import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * A small org that exercises every scoping rule:
 *
 *   admin ──► manager ──► worker  (2 open tasks + 1 done)  ← the ambiguous case
 *                    └──► solo    (1 open task)            ← the unambiguous one
 *                         other   (reports to nobody)      ← out of manager scope
 */
export const IDS = {
  admin:   'U001',
  manager: 'U010',
  worker:  'U101',
  solo:    'U102',
  other:   'U103',
} as const;

export const PHONES = {
  worker: '919174192837',
  solo:   '919000000002',
  other:  '919000000003',
} as const;

export async function resetData(): Promise<void> {
  // Order matters — Message and Activity both reference Task and User.
  await prisma.message.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();
}

export async function seedOrg(): Promise<void> {
  await resetData();

  const base = { passwordHash: 'x', preferredLanguage: 'en', avatar: '', color: '' };

  await prisma.user.create({
    data: { ...base, id: IDS.admin, name: 'Admin One', email: 'admin@test.io', role: 'Admin' },
  });
  await prisma.user.create({
    data: { ...base, id: IDS.manager, name: 'Manager One', email: 'mgr@test.io', role: 'Manager', reportingToId: IDS.admin },
  });
  await prisma.user.create({
    data: { ...base, id: IDS.worker, name: 'Worker One', email: 'w1@test.io', role: 'Employee', reportingToId: IDS.manager, phone: PHONES.worker },
  });
  await prisma.user.create({
    data: { ...base, id: IDS.solo, name: 'Solo Worker', email: 'w2@test.io', role: 'Employee', reportingToId: IDS.manager, phone: PHONES.solo },
  });
  await prisma.user.create({
    data: { ...base, id: IDS.other, name: 'Other Person', email: 'w3@test.io', role: 'Employee', phone: PHONES.other },
  });

  const deadline = new Date(Date.now() + 86_400_000);

  // Worker has TWO open tasks — every "which task did they mean?" case needs this.
  await prisma.task.create({
    data: { id: 'TSK-1060', title: 'Install mirrors', assignedToId: IDS.worker, assignedById: IDS.manager, deadline, alertDispatched: true },
  });
  await prisma.task.create({
    data: { id: 'TSK-1061', title: 'Photograph site', assignedToId: IDS.worker, assignedById: IDS.manager, deadline, alertDispatched: true },
  });
  await prisma.task.create({
    data: { id: 'TSK-1059', title: 'Already finished', assignedToId: IDS.worker, assignedById: IDS.manager, deadline, status: 'Done', alertDispatched: true },
  });

  // Solo has exactly one, so a bare "done" is unambiguous.
  await prisma.task.create({
    data: { id: 'TSK-2000', title: 'Solo only task', assignedToId: IDS.solo, assignedById: IDS.manager, deadline, alertDispatched: true },
  });

  // Belongs to someone outside the manager's reporting line.
  await prisma.task.create({
    data: { id: 'TSK-3000', title: 'Not yours', assignedToId: IDS.other, assignedById: IDS.admin, deadline, alertDispatched: true },
  });
}

// ─── Meta webhook payload builders ────────────────────────────────────────────

let seq = 0;
export const nextWamid = () => `wamid.TEST${++seq}`;

function envelope(message: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '0', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', messages: [message] } }] }],
  };
}

export function textMessage(from: string, body: string, id = nextWamid()) {
  return envelope({ from, id, type: 'text', timestamp: '0', text: { body } });
}

export function imageMessage(from: string, caption = '', id = nextWamid()) {
  return envelope({ from, id, type: 'image', timestamp: '0', image: { id: 'media-1', caption, mime_type: 'image/jpeg' } });
}

export function audioMessage(from: string, id = nextWamid()) {
  return envelope({ from, id, type: 'audio', timestamp: '0', audio: { id: 'audio-1', mime_type: 'audio/ogg' } });
}

export function listReply(from: string, rowId: string, id = nextWamid()) {
  return envelope({
    from, id, type: 'interactive', timestamp: '0',
    interactive: { type: 'list_reply', list_reply: { id: rowId, title: rowId } },
  });
}

/** Meta's delivery receipt for a message WE sent — drives the ticks. */
export function statusUpdate(waMessageId: string, status: 'sent' | 'delivered' | 'read' | 'failed') {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '0',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          statuses: [{
            id: waMessageId,
            status,
            timestamp: '0',
            recipient_id: PHONES.worker,
            ...(status === 'failed' && { errors: [{ title: 'Message undeliverable' }] }),
          }],
        },
      }],
    }],
  };
}

/** Two messages in one delivery — Meta batches, and the old code read only [0]. */
export function batchedMessages(from: string, bodies: string[]) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: '0',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          messages: bodies.map((body) => ({
            from, id: nextWamid(), type: 'text', timestamp: '0', text: { body },
          })),
        },
      }],
    }],
  };
}
