import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { IDS, prisma, seedOrg } from '../fixtures';

/**
 * The backfill migrates pre-refactor WhatsApp activities into `Message`.
 *
 * The re-run test is the important one: without `legacyActivityId @unique`,
 * running this twice would silently double every message in every
 * conversation, and there would be no way to tell which half was real.
 */

const runBackfill = () =>
  execSync('npx ts-node prisma/backfill-messages.ts', { env: process.env, stdio: 'pipe' });

async function seedLegacyActivities() {
  const rows = [
    { type: 'whatsapp',     text: 'task 1060 done',  mediaUrl: null,                 taskId: 'TSK-1060', byId: IDS.worker },
    { type: 'whatsapp',     text: '',                mediaUrl: 'https://cdn/x.jpg',  taskId: 'TSK-1060', byId: IDS.worker },
    { type: 'voicenote',    text: '🎙️ Voice note',   mediaUrl: 'https://cdn/a.ogg',  taskId: 'TSK-1061', byId: IDS.worker },
    { type: 'whatsapp_dup', text: 'done again',      mediaUrl: null,                 taskId: 'TSK-1060', byId: IDS.worker },
    { type: 'outbound',     text: 'thanks!',         mediaUrl: null,                 taskId: 'TSK-1060', byId: IDS.manager },
    // Must NOT be migrated — these are task audit rows, not messages.
    { type: 'status',       text: 'Status changed',  mediaUrl: null,                 taskId: 'TSK-1060', byId: IDS.manager },
    { type: 'created',      text: 'Task created',    mediaUrl: null,                 taskId: 'TSK-1061', byId: IDS.manager },
  ];
  for (const r of rows) {
    await prisma.activity.create({ data: { ...r, transcription: null } });
  }
}

beforeEach(async () => {
  await seedOrg();
  await seedLegacyActivities();
});
afterAll(async () => { await prisma.$disconnect(); });

describe('backfill-messages', () => {
  it('migrates only the WhatsApp activity types', async () => {
    runBackfill();

    const msgs = await prisma.message.findMany({ orderBy: { createdAt: 'asc' } });
    expect(msgs).toHaveLength(5);   // 7 activities, 2 of them audit rows
    expect(msgs.every((m) => m.legacyActivityId !== null)).toBe(true);

    // Legacy rows are left in place — they are the rollback path.
    expect(await prisma.activity.count()).toBe(7);
  });

  it('sets owner, sender and direction correctly', async () => {
    runBackfill();

    const inbound  = await prisma.message.findMany({ where: { direction: 'inbound' } });
    const outbound = await prisma.message.findMany({ where: { direction: 'outbound' } });

    expect(inbound).toHaveLength(4);
    expect(outbound).toHaveLength(1);

    // Owner is the assignee for BOTH directions — a manager's reply belongs in
    // the employee's conversation, not the manager's.
    expect(new Set(inbound.map((m) => m.userId))).toEqual(new Set([IDS.worker]));
    expect(outbound[0].userId).toBe(IDS.worker);
    // Sender preserves who actually wrote it.
    expect(outbound[0].senderId).toBe(IDS.manager);
  });

  it('infers kind from the activity type and media', async () => {
    runBackfill();

    const byText = Object.fromEntries(
      (await prisma.message.findMany()).map((m) => [m.text, m.kind]),
    );
    expect(byText['task 1060 done']).toBe('text');
    expect(byText['']).toBe('image');            // had a mediaUrl
    expect(byText['🎙️ Voice note']).toBe('voice');
  });

  it('is safe to run twice', async () => {
    runBackfill();
    const first = await prisma.message.count();

    runBackfill();
    expect(await prisma.message.count()).toBe(first);
  });
});
