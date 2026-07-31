import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The spec's 25 use cases, as executable tests.
 *
 * One `describe` per use case, named by its id, so a failure says which
 * requirement broke rather than which function did. Cases belonging to phases
 * not yet built are marked `.todo` — they are listed rather than omitted, so
 * the gap between "specified" and "working" stays visible.
 */

vi.mock('../../src/services/whatsappService', () => ({
  sendInteractiveList:    vi.fn().mockResolvedValue(undefined),
  sendInteractiveButtons: vi.fn().mockResolvedValue(undefined),
  sendTextMessage:        vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.OUT' }),
  sendWhatsApp:           vi.fn().mockResolvedValue(undefined),
  sendTaskAssignmentNotification: vi.fn().mockResolvedValue({ ok: true, waMessageId: 'wamid.TPL' }),
  sendEscalationNotification:     vi.fn().mockResolvedValue({ ok: true }),
  sendWhatsAppLocalized:          vi.fn().mockResolvedValue({ ok: true }),
  normalisePhone: (s: string) => String(s ?? '').replace(/\D/g, ''),
}));

vi.mock('../../src/services/mediaService', () => ({
  storeWhatsAppMedia:       vi.fn().mockResolvedValue('https://cdn.test/photo.jpg'),
  downloadWhatsAppMedia:    vi.fn().mockResolvedValue({ buffer: Buffer.from('x'), mimeType: 'audio/ogg' }),
  uploadBufferToCloudinary: vi.fn().mockResolvedValue('https://cdn.test/voice.ogg'),
}));

vi.mock('../../src/services/transcriptionService', () => ({
  transcribeAudio: vi.fn().mockResolvedValue(''),
}));

import { __test } from '../../src/controllers/webhookController';
import { sendInteractiveButtons, sendTextMessage } from '../../src/services/whatsappService';
import { __resetRateLimits } from '../../src/lib/rateLimit';
import {
  CMD, CMD_PHONES, createTask, prisma, seedCommandOrg, listReply, textMessage,
} from '../fixtures';

const { processInbound } = __test;

delete process.env.NVIDIA_API_KEY;

const task    = (id: string) => prisma.task.findUniqueOrThrow({ where: { id }, include: { assignees: true } });
const tasks   = () => prisma.task.findMany({ orderBy: { id: 'asc' } });
const commands = () => prisma.whatsAppCommand.findMany({ orderBy: { createdAt: 'asc' } });

function repliesTo(phone: string): string {
  return vi.mocked(sendTextMessage).mock.calls
    .filter((c) => c[0] === phone).map((c) => c[1]).join('\n');
}

/** The body text of the last button prompt we sent. */
function lastButtonPrompt(): string {
  const calls = vi.mocked(sendInteractiveButtons).mock.calls;
  return calls.length ? String(calls[calls.length - 1][1]) : '';
}

function buttonIds(): string[] {
  const calls = vi.mocked(sendInteractiveButtons).mock.calls;
  return calls.length ? (calls[calls.length - 1][2] as { id: string }[]).map((b) => b.id) : [];
}

/** Tap a button, exactly as Meta delivers it. */
const tap = (phone: string, id: string) => processInbound(listReply(phone, id));

beforeEach(async () => {
  vi.clearAllMocks();
  __resetRateLimits();
  process.env.WA_COMMANDS_ENABLED = 'true';
  process.env.WA_STATE_TTL_S = '600';
  await seedCommandOrg();
});

afterAll(async () => { await prisma.$disconnect(); });

// ─────────────────────────────────────────────────────────────────────────────
// Core assignment
// ─────────────────────────────────────────────────────────────────────────────

describe('UC1 — assign a new task to one person', () => {
  it('creates a single task for the named person', async () => {
    const before = (await tasks()).length;
    await processInbound(textMessage(
      CMD_PHONES.sahil, "Assign Vedant the task of checking today's inventory by Friday",
    ));

    const all = await tasks();
    expect(all).toHaveLength(before + 1);

    const created = all.find((t) => t.title.includes('inventory'))!;
    expect(created.assignedToId).toBe(CMD.vedant);
    expect(created.assignmentMode).toBe('sole');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('Created');
  });
});

describe('UC2 — same work, two people, separate tasks', () => {
  it('creates one task each and links them to the source', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil,
      'Assign task 1059 to Vedant and Vikranth Sharma. Both of them need to complete it separately.',
    ));

    const copies = await prisma.task.findMany({ where: { sourceTaskId: 'TSK-1059' } });
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => c.assignedToId).sort()).toEqual([CMD.vikranthS, CMD.vedant].sort());

    // The original is untouched — still Sahil's.
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect(repliesTo(CMD_PHONES.sahil)).toContain('separate tasks');
  });

  it('one person completing does not complete the other', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil,
      'Assign task 1059 to Vedant and Vikranth Sharma. Both of them need to complete it separately.',
    ));
    const copies = await prisma.task.findMany({ where: { sourceTaskId: 'TSK-1059' } });
    const vedantsCopy = copies.find((c) => c.assignedToId === CMD.vedant)!;

    await processInbound(textMessage(CMD_PHONES.vedant, `${vedantsCopy.id} done`));

    expect((await task(vedantsCopy.id)).status).toBe('Submitted');
    const others = copies.filter((c) => c.id !== vedantsCopy.id);
    expect((await task(others[0].id)).status).toBe('Pending');
  });
});

describe('UC3 — one shared task, two people', () => {
  it('keeps one task and adds both as joint assignees', async () => {
    const before = (await tasks()).length;
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Assign task 1059 to Vedant and Vikranth Sharma. They should work on it together.',
    ));

    // No new task was created.
    expect(await tasks()).toHaveLength(before);

    const t = await task('TSK-1059');
    expect(t.assignmentMode).toBe('shared');
    expect(t.assignees.map((a) => a.userId).sort())
      .toEqual([CMD.sahil, CMD.vedant, CMD.vikranthS].sort());
    expect(repliesTo(CMD_PHONES.sahil)).toContain('jointly');
  });
});

describe('UC4 — ambiguous multiple-person assignment', () => {
  it('asks instead of guessing, and changes nothing', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Vedant and Vikranth Sharma.'));

    expect((await task('TSK-1059')).assignmentMode).toBe('sole');
    expect((await task('TSK-1059')).assignees).toHaveLength(1);
    expect((await commands())[0].status).toBe('clarifying');

    expect(lastButtonPrompt()).toContain('share');
    expect(buttonIds()).toEqual(['wa_shared', 'wa_separate', 'wa_cancel']);
  });

  it('honours "Share one task"', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Vedant and Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_shared');

    expect((await task('TSK-1059')).assignmentMode).toBe('shared');
  });

  it('honours "Create separate tasks"', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Vedant and Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_separate');

    expect(await prisma.task.findMany({ where: { sourceTaskId: 'TSK-1059' } })).toHaveLength(2);
  });

  it('honours Cancel', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Vedant and Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_cancel');

    expect((await task('TSK-1059')).assignees).toHaveLength(1);
    expect((await commands()).some((c) => c.status === 'cancelled')).toBe(true);
  });
});

describe('UC5 — assign an existing task to an ADDITIONAL person', () => {
  it('shows the current holder and asks add-or-reassign', async () => {
    // TSK-1060 is Vedant's.
    await processInbound(textMessage(CMD_PHONES.sahil, 'Also assign task 1060 to Vikranth Sharma.'));

    expect(lastButtonPrompt()).toContain('currently assigned to Vedant Kulkarni');
    expect(buttonIds()).toEqual(['wa_add', 'wa_replace', 'wa_cancel']);

    // Vedant has not been removed.
    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vedant);
  });

  it('adds without removing when told to add', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Also assign task 1060 to Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_add');

    const t = await task('TSK-1060');
    expect(t.assignees.map((a) => a.userId).sort()).toEqual([CMD.vedant, CMD.vikranthS].sort());
    expect(t.assignedToId).toBe(CMD.vedant);   // still the owner of record
  });

  it('replaces only when told to replace', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Also assign task 1060 to Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_replace');

    const t = await task('TSK-1060');
    expect(t.assignedToId).toBe(CMD.vikranthS);
    expect(t.assignees).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reassignment
// ─────────────────────────────────────────────────────────────────────────────

describe('UC6 — reassign a task completely', () => {
  it('moves it, keeps the id, and preserves the history', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Reassign task 1060 from Vedant to Vikranth Sharma'));

    const t = await task('TSK-1060');
    expect(t.id).toBe('TSK-1060');
    expect(t.assignedToId).toBe(CMD.vikranthS);

    const audit = await prisma.activity.findFirstOrThrow({
      where: { taskId: 'TSK-1060', type: 'reassign' },
    });
    expect(audit.text).toContain('Vedant Kulkarni');   // the previous holder is named
    expect(audit.channel).toBe('whatsapp');
  });
});

describe('UC7 — reassignment without naming the current assignee', () => {
  it('confirms before removing whoever holds it', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Give task 1060 to Vikranth Sharma instead.'));

    // "instead" is replacement language — but replacement removes somebody, so
    // it is confirmed rather than executed.
    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vedant);
    expect((await commands())[0].status).toBe('awaiting_confirmation');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('Vedant Kulkarni');

    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));
    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vikranthS);
  });
});

describe.todo('UC8 — reassign all open tasks from one person (phase 6)');
describe.todo('UC9 — reassign tasks due tomorrow during leave (phase 6)');

// ─────────────────────────────────────────────────────────────────────────────
// Duplicates
// ─────────────────────────────────────────────────────────────────────────────

describe('UC10 — repeated assignment message', () => {
  it('states the current assignment and creates nothing', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1060 to Vedant.'));

    const [cmd] = await commands();
    expect(cmd.status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('already assigned to Vedant Kulkarni');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('No duplicate assignment');
    expect((await task('TSK-1060')).assignees).toHaveLength(1);
  });
});

describe.todo('UC11 — create another copy of a task (phase 6)');
describe.todo('UC12 — duplicate a task for several people (phase 6)');

// ─────────────────────────────────────────────────────────────────────────────
// Attachments — phase 7
// ─────────────────────────────────────────────────────────────────────────────

describe.todo('UC13 — image with a caption becomes a task (phase 7)');
describe.todo('UC14 — "send this to Vedant" after an image (phase 7)');
describe.todo('UC15 — ambiguous image reference (phase 7)');
describe.todo('UC16 — add an image to an existing task (phase 7)');
describe.todo('UC17 — forward a document without creating a task (phase 7)');

// ─────────────────────────────────────────────────────────────────────────────
// Natural language
// ─────────────────────────────────────────────────────────────────────────────

describe('UC18 — misspelled name', () => {
  it('resolves the typo but confirms before acting', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Vedent.'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    expect((await commands())[0].status).toBe('awaiting_confirmation');
    expect(repliesTo(CMD_PHONES.sahil)).toContain('Vedant Kulkarni');

    await processInbound(textMessage(CMD_PHONES.sahil, 'Yes'));
    expect((await task('TSK-1059')).assignedToId).toBe(CMD.vedant);
  });
});

describe('UC19 — two people with the same first name', () => {
  it('asks which Rahul, and picks neither', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Rahul.'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    const reply = repliesTo(CMD_PHONES.sahil);
    expect(reply).toContain('Rahul Sharma');
    expect(reply).toContain('Rahul Verma');
    expect((await commands())[0].status).toBe('clarifying');
  });

  it('completes once the full name is given', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Rahul.'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'Rahul Verma'));
    await processInbound(textMessage(CMD_PHONES.sahil, 'Confirm'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.rahulV);
  });
});

describe('UC20 — informal, mixed Hindi and English', () => {
  it('assigns to one and creates a separate copy for the other', async () => {
    await processInbound(textMessage(
      CMD_PHONES.sahil, 'Task 1059 vedant ko de do aur vikranth sharma ko bhi same kaam alag se',
    ));

    // "alag se" = separately, so each gets their own copy.
    const copies = await prisma.task.findMany({ where: { sourceTaskId: 'TSK-1059' } });
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => c.assignedToId).sort()).toEqual([CMD.vikranthS, CMD.vedant].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Safety and permissions
// ─────────────────────────────────────────────────────────────────────────────

describe('UC21 — unauthorized assignment', () => {
  it('refuses a non-manager', async () => {
    await processInbound(textMessage(CMD_PHONES.vedant, 'Assign task 1060 to Vikranth Sharma.'));

    expect((await task('TSK-1060')).assignedToId).toBe(CMD.vedant);
    expect((await commands())[0].status).toBe('rejected');
    expect(repliesTo(CMD_PHONES.vedant)).toContain('Only managers');
  });
});

describe('UC22 — person outside the manager\'s team', () => {
  it('refuses, and does not reveal that they exist', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1059 to Farouk.'));

    expect((await task('TSK-1059')).assignedToId).toBe(CMD.sahil);
    const reply = repliesTo(CMD_PHONES.sahil);
    expect(reply).toContain("couldn't find anyone called");
    expect(reply).not.toContain('Farouk Ali');
  });
});

describe('UC23 — task does not exist', () => {
  it('says so and does not guess another number', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 44 to Vedant.'));

    expect(repliesTo(CMD_PHONES.sahil)).toContain('could not find ticket TSK-44');
    expect((await commands())[0].status).toBe('rejected');
    // Nothing was created and nothing else moved.
    expect(await prisma.task.count()).toBe(4);
  });
});

describe('UC24 — assigning a completed task', () => {
  it('offers reopen or copy rather than silently reopening', async () => {
    // TSK-1080 is Done.
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1080 to Vikranth Sharma.'));

    expect((await task('TSK-1080')).status).toBe('Done');
    expect(lastButtonPrompt()).toContain('completed');
    expect(buttonIds()).toEqual(['wa_reopen', 'wa_copy', 'wa_cancel']);
  });

  it('reopens on request, clearing the approval', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1080 to Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_reopen');

    const t = await task('TSK-1080');
    expect(t.status).not.toBe('Done');
    expect(t.approved).toBe(false);
    expect(t.assignedToId).toBe(CMD.vikranthS);
  });

  it('creates a copy on request, leaving the original completed', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 1080 to Vikranth Sharma.'));
    await tap(CMD_PHONES.sahil, 'wa_copy');

    expect((await task('TSK-1080')).status).toBe('Done');
    const copies = await prisma.task.findMany({ where: { sourceTaskId: 'TSK-1080' } });
    expect(copies).toHaveLength(1);
    // A copy starts fresh — carrying the completion over would hand somebody a
    // task that already claims they finished it.
    expect(copies[0].status).toBe('Pending');
    expect(copies[0].approved).toBe(false);
  });
});

describe.todo('UC25 — undo the last assignment (phase 6)');

// ─────────────────────────────────────────────────────────────────────────────
// Acceptance criteria that cut across cases
// ─────────────────────────────────────────────────────────────────────────────

describe('every action is recorded', () => {
  it('audits an executed command with both sides of the change', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Reassign task 1060 from Vedant to Vikranth Sharma'));

    const [cmd] = await commands();
    expect(cmd.status).toBe('executed');
    expect(cmd.senderId).toBe(CMD.sahil);
    expect(cmd.previousAssigneeId).toBe(CMD.vedant);
    expect(cmd.newAssigneeId).toBe(CMD.vikranthS);
    expect(cmd.channel).toBe('whatsapp');
    expect(cmd.rawText).toContain('Reassign task 1060');
  });

  it('audits a refusal with the reason the sender was given', async () => {
    await processInbound(textMessage(CMD_PHONES.sahil, 'Assign task 44 to Vedant.'));

    const [cmd] = await commands();
    expect(cmd.status).toBe('rejected');
    expect(cmd.errorReason).toContain('TSK-44');
  });
});

describe('a shared task is created with a real shared record', () => {
  it('gives every holder their own row', async () => {
    await createTask({
      id: 'TSK-3001', title: 'Joint audit',
      assignedToId: CMD.vedant, assignedById: CMD.sahil,
      deadline: new Date(Date.now() + 86_400_000),
      coAssigneeIds: [CMD.vikranthS],
    });

    const t = await task('TSK-3001');
    expect(t.assignmentMode).toBe('shared');
    expect(t.assignees).toHaveLength(2);
    expect(t.assignees.every((a) => a.status === 'Pending')).toBe(true);
  });
});
