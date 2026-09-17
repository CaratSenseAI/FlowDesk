// One-off cleanup before the TDM client handover (Sept 2026).
// Talks to Neon over HTTPS (port 443), so it works on networks that block 5432.
// No dependencies — needs Node 18+.
//
//   DATABASE_URL="postgresql://…" node prisma/wipe-test-data.mjs            # dry run: counts + user list only
//   DATABASE_URL="postgresql://…" node prisma/wipe-test-data.mjs --execute  # delete, in one transaction
//
// Keeps only users U001 (TDM Admin) and U007 (Ashish). Deletes everything else.

const KEEP = ['U001', 'U007'];
const ADMIN = 'U001';
const execute = process.argv.includes('--execute');
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }

const host = new URL(url).host;
const endpoint = `https://${host}/sql`;
const baseHeaders = {
  'Neon-Connection-String': url,
  'Neon-Raw-Text-Output': 'true',
  'Neon-Array-Mode': 'false',
  'content-type': 'application/json',
};

async function query(sql) {
  const r = await fetch(endpoint, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ query: sql, params: [] }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${j.message ?? JSON.stringify(j)}`);
  return j.rows;
}

async function transaction(statements) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { ...baseHeaders, 'Neon-Batch-Isolation-Level': 'ReadCommitted', 'Neon-Batch-Read-Only': 'false', 'Neon-Batch-Deferrable': 'false' },
    body: JSON.stringify({ queries: statements.map(q => ({ query: q, params: [] })) }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status}: ${j.message ?? JSON.stringify(j)}`);
  return j.results.map(x => x.rowCount);
}

const keepList = KEEP.map(k => `'${k}'`).join(',');

const rows = await query(`
  SELECT 'Task' AS tbl, count(*)::int AS n FROM "Task"
  UNION ALL SELECT 'Activity', count(*)::int FROM "Activity"
  UNION ALL SELECT 'TaskAssignee', count(*)::int FROM "TaskAssignee"
  UNION ALL SELECT 'Message', count(*)::int FROM "Message"
  UNION ALL SELECT 'WhatsAppCommand', count(*)::int FROM "WhatsAppCommand"
  UNION ALL SELECT 'ConversationState', count(*)::int FROM "ConversationState"
  UNION ALL SELECT 'Invoice', count(*)::int FROM "Invoice"
  UNION ALL SELECT 'Contact', count(*)::int FROM "Contact"
  UNION ALL SELECT 'User (to delete)', count(*)::int FROM "User" WHERE id NOT IN (${keepList})`);
console.log('Will delete:');
for (const r of rows) console.log(`  ${r.tbl.padEnd(18)} ${r.n}`);

const users = await query(`SELECT id, name, role, phone, "reportingToId" FROM "User" ORDER BY id`);
console.log('Users:');
for (const u of users) console.log(`  ${u.id} ${u.name} (${u.role}) ${u.phone ?? '-'}  → ${KEEP.includes(u.id) ? 'KEEP' : 'DELETE'}`);

if (!execute) { console.log('\nDry run only. Re-run with --execute to delete.'); process.exit(0); }

const counts = await transaction([
  `DELETE FROM "Message"`,
  `DELETE FROM "WhatsAppCommand"`,
  `DELETE FROM "ConversationState"`,
  `DELETE FROM "Activity"`,
  `DELETE FROM "TaskAssignee"`,
  `DELETE FROM "Task"`,
  `DELETE FROM "Invoice"`,
  `DELETE FROM "Contact"`,
  `UPDATE "User" SET "reportingToId" = '${ADMIN}' WHERE id IN (${keepList}) AND "reportingToId" IS NOT NULL AND "reportingToId" NOT IN (${keepList})`,
  `DELETE FROM "User" WHERE id NOT IN (${keepList})`,
]);
console.log('\nDeleted rows per statement:', counts.join(', '));

const after = await query(`SELECT id, name, role, phone FROM "User" ORDER BY id`);
const left = await query(`SELECT (SELECT count(*)::int FROM "Task") AS tasks, (SELECT count(*)::int FROM "Message") AS messages`);
console.log('Remaining:', left[0], '\nUsers now:');
for (const u of after) console.log(`  ${u.id} ${u.name} (${u.role}) ${u.phone ?? '-'}`);
