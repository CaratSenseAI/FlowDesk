// Make users Admins. Defaults to Ashish (U007) and Bipan (U029); pass other ids as arguments:
//   node prisma/promote-admins.mjs U008
// Talks to Neon over HTTPS. No dependencies, Node 18+.
//   DATABASE_URL="postgresql://…" node prisma/promote-admins.mjs
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
const endpoint = `https://${new URL(url).host}/sql`;
const headers = { 'Neon-Connection-String': url, 'Neon-Raw-Text-Output': 'true', 'Neon-Array-Mode': 'false', 'content-type': 'application/json' };
async function q(query) {
  const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ query, params: [] }) });
  const j = await r.json(); if (!r.ok) throw new Error(`${r.status}: ${j.message ?? JSON.stringify(j)}`); return j.rows;
}
const ids = (process.argv.slice(2).filter((a) => /^U\d+$/.test(a)).length ? process.argv.slice(2).filter((a) => /^U\d+$/.test(a)) : ['U007', 'U029']);
const list = ids.map((i) => `'${i}'`).join(',');
console.log('before:', await q(`SELECT id, name, role FROM "User" WHERE id IN (${list}) ORDER BY id`));
await q(`UPDATE "User" SET role = 'Admin' WHERE id IN (${list})`);
console.log('after: ', await q(`SELECT id, name, role FROM "User" WHERE id IN (${list}) ORDER BY id`));
