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
  await prisma.whatsAppCommand.deleteMany();
  await prisma.conversationState.deleteMany();
  await prisma.message.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.user.deleteMany();
}

/**
 * Create a task WITH its assignee row.
 *
 * In production every task has one — `taskService.create` writes it, and the
 * backfill covers everything older. Seeding tasks without one would leave the
 * tests exercising a fallback path that no longer exists in the real system,
 * which is the kind of gap that makes a suite pass while production breaks.
 */
export async function createTask(data: {
  id: string;
  title: string;
  assignedToId: string;
  assignedById: string;
  deadline: Date;
  status?: 'Pending' | 'InProgress' | 'Submitted' | 'Done' | 'Issue' | 'Delay';
  approved?: boolean;
  alertDispatched?: boolean;
  /** Extra holders, for shared-task cases. */
  coAssigneeIds?: string[];
}) {
  const { coAssigneeIds = [], ...task } = data;
  const holders = [data.assignedToId, ...coAssigneeIds];

  return prisma.task.create({
    data: {
      ...task,
      alertDispatched: data.alertDispatched ?? true,
      assignmentMode: coAssigneeIds.length > 0 ? 'shared' : 'sole',
      assignees: {
        create: holders.map((userId) => ({
          userId,
          addedById: data.assignedById,
          // Mirror the task's own state, exactly as the backfill does.
          status: data.status === 'Done' ? 'Submitted' : (data.status ?? 'Pending'),
        })),
      },
    },
  });
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
  await createTask({ id: 'TSK-1060', title: 'Install mirrors', assignedToId: IDS.worker, assignedById: IDS.manager, deadline });
  await createTask({ id: 'TSK-1061', title: 'Photograph site', assignedToId: IDS.worker, assignedById: IDS.manager, deadline });
  await createTask({ id: 'TSK-1059', title: 'Already finished', assignedToId: IDS.worker, assignedById: IDS.manager, deadline, status: 'Done' });

  // Solo has exactly one, so a bare "done" is unambiguous.
  await createTask({ id: 'TSK-2000', title: 'Solo only task', assignedToId: IDS.solo, assignedById: IDS.manager, deadline });

  // Belongs to someone outside the manager's reporting line.
  await createTask({ id: 'TSK-3000', title: 'Not yours', assignedToId: IDS.other, assignedById: IDS.admin, deadline });
}

// ─────────────────────────────────────────────────────────────────────────────
// A second org, shaped for the management-command tests.
//
//   admin ──► sahil (Manager)   ──► Vikranth Sharma  ┐ two people whose FIRST
//        │                      ──► Vikranth Rao     ┘ names are identical
//        │                      ──► Vedant Kulkarni    (unambiguous)
//        └──► rival (Manager)   ──► Farouk Ali          (out of sahil's scope)
//
// TSK-1059 is assigned to Sahil himself — the scenario in the spec is a manager
// delegating a ticket he is personally holding, which a reports-only permission
// check would refuse.
// ─────────────────────────────────────────────────────────────────────────────

export const CMD = {
  admin:     'U001',
  sahil:     'U010',
  rival:     'U011',
  vikranthS: 'U201',
  vikranthR: 'U202',
  vedant:    'U203',
  outsider:  'U204',
} as const;

export const CMD_PHONES = {
  sahil:     '919100000010',
  rival:     '919100000011',
  vikranthS: '919100000201',
  vikranthR: '919100000202',
  vedant:    '919100000203',
  outsider:  '919100000204',
} as const;

export async function seedCommandOrg(): Promise<void> {
  await resetData();

  const base = { passwordHash: 'x', preferredLanguage: 'en', avatar: '', color: '' };

  await prisma.user.create({
    data: { ...base, id: CMD.admin, name: 'Admin One', email: 'admin@test.io', role: 'Admin' },
  });
  await prisma.user.create({
    data: { ...base, id: CMD.sahil, name: 'Sahil Mehta', email: 'sahil@test.io', role: 'Manager', reportingToId: CMD.admin, phone: CMD_PHONES.sahil },
  });
  await prisma.user.create({
    data: { ...base, id: CMD.rival, name: 'Rival Manager', email: 'rival@test.io', role: 'Manager', reportingToId: CMD.admin, phone: CMD_PHONES.rival },
  });

  await prisma.user.create({
    data: { ...base, id: CMD.vikranthS, name: 'Vikranth Sharma', email: 'vs@test.io', role: 'Employee', reportingToId: CMD.sahil, phone: CMD_PHONES.vikranthS },
  });
  await prisma.user.create({
    data: { ...base, id: CMD.vikranthR, name: 'Vikranth Rao', email: 'vr@test.io', role: 'Employee', reportingToId: CMD.sahil, phone: CMD_PHONES.vikranthR },
  });
  await prisma.user.create({
    data: { ...base, id: CMD.vedant, name: 'Vedant Kulkarni', email: 'vk@test.io', role: 'Employee', reportingToId: CMD.sahil, phone: CMD_PHONES.vedant },
  });
  await prisma.user.create({
    data: { ...base, id: CMD.outsider, name: 'Farouk Ali', email: 'fa@test.io', role: 'Employee', reportingToId: CMD.rival, phone: CMD_PHONES.outsider },
  });

  const deadline = new Date(Date.now() + 86_400_000);

  await createTask({ id: 'TSK-1059', title: 'Install mirrors', assignedToId: CMD.sahil, assignedById: CMD.admin, deadline });
  await createTask({ id: 'TSK-1060', title: 'Photograph site', assignedToId: CMD.vedant, assignedById: CMD.sahil, deadline });
  await createTask({ id: 'TSK-1070', title: 'Not yours', assignedToId: CMD.outsider, assignedById: CMD.rival, deadline });
  await createTask({ id: 'TSK-1080', title: 'Finished work', assignedToId: CMD.vedant, assignedById: CMD.sahil, deadline, status: 'Done', approved: true });
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
