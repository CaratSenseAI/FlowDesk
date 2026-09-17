/**
 * One-off cleanup before the TDM client handover (Sept 2026).
 *
 * Deletes every task, activity, message, WhatsApp command, conversation
 * state, contact and invoice, and every user EXCEPT the ones listed in KEEP.
 * Kept users are re-pointed to report to the admin if their manager is removed.
 *
 *   DATABASE_URL="postgresql://…" npx ts-node prisma/wipe-test-data.ts            # dry run: prints counts only
 *   DATABASE_URL="postgresql://…" npx ts-node prisma/wipe-test-data.ts --execute  # actually deletes
 */
import { PrismaClient } from '@prisma/client';

const KEEP = ['U001', 'U007']; // TDM Admin, Ashish
const ADMIN = 'U001';
const execute = process.argv.includes('--execute');
const prisma = new PrismaClient();

async function main() {
  const url = process.env.DATABASE_URL ?? '';
  if (!url) throw new Error('DATABASE_URL is not set');
  console.log(`Target host: ${url.replace(/\/\/[^@]+@/, '//***@').split('?')[0]}`);

  const counts = {
    tasks: await prisma.task.count(),
    activities: await prisma.activity.count(),
    taskAssignees: await prisma.taskAssignee.count(),
    messages: await prisma.message.count(),
    commands: await prisma.whatsAppCommand.count(),
    conversationStates: await prisma.conversationState.count(),
    invoices: await prisma.invoice.count(),
    contacts: await prisma.contact.count(),
    usersToDelete: await prisma.user.count({ where: { id: { notIn: KEEP } } }),
  };
  const users = await prisma.user.findMany({ select: { id: true, name: true, role: true, reportingToId: true } });
  console.log('Users:', users.map(u => `${u.id} ${u.name} (${u.role})${KEEP.includes(u.id) ? ' KEEP' : ' DELETE'}`).join('\n       '));
  console.log('Will delete:', counts);

  if (!execute) { console.log('\nDry run only. Re-run with --execute to delete.'); return; }

  await prisma.$transaction(async tx => {
    await tx.message.deleteMany();
    await tx.whatsAppCommand.deleteMany();
    await tx.conversationState.deleteMany();
    await tx.activity.deleteMany();
    await tx.taskAssignee.deleteMany();
    await tx.task.deleteMany();
    await tx.invoice.deleteMany();
    await tx.contact.deleteMany();
    // Kept users whose manager is being removed now report to the admin.
    await tx.user.updateMany({
      where: { id: { in: KEEP }, reportingToId: { notIn: KEEP }, NOT: { reportingToId: null } },
      data: { reportingToId: ADMIN },
    });
    await tx.user.deleteMany({ where: { id: { notIn: KEEP } } });
  });

  console.log('\nDone. Remaining:', {
    tasks: await prisma.task.count(),
    messages: await prisma.message.count(),
    users: (await prisma.user.findMany({ select: { id: true, name: true, role: true, phone: true } })),
  });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
