// ─────────────────────────────────────────────────────────────────────────────
// What the AI needs to know about the business it is working for.
//
// The model parsing a manager's message used to know nothing: not who works
// here, not what the company sells, not which outside parties exist. So
// "Bipan ko bola 14015 bhejden" became a sample dispatch to an unknown vendor,
// and a voice note saying "Anshul" came back as "insurance" with nothing to
// correct it against.
//
// Everything here is plain text handed to the model, plus two small pure
// helpers (aliases, key terms) that the speech and name-resolution steps use.
// One deployment serves one client, so the profile lives in code; the env
// overrides exist so a second client is an env file, not a fork.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from '../lib/prisma';
import { assignableUsers } from './permissionService';
import { contactCandidates } from './contactService';
import { heldByAnyUser } from './taskService';

export interface BusinessProfile {
  description: string;
  locations:   string[];
  vocabulary:  string[];
  taskTypes:   string[];
  notes:       string[];
}

/** TDM (Ashish Textiles). Written from what the client has told us so far. */
const DEFAULT_PROFILE: BusinessProfile = {
  description:
    'A textile trading business. It buys and sells fabric, keeps stock in a godown and runs a store. ' +
    'The owners give day-to-day instructions to staff, mostly in Hindi or Hinglish.',
  locations:  ['godown', 'store', 'Bandra store', 'office', 'shop', 'market', 'transport', 'bank'],
  vocabulary: [
    'fabric', 'kapda', 'maal', 'than', 'roll', 'bale', 'lot', 'design', 'shade', 'colour', 'sample', 'cutting',
    'cotton', 'satin', 'silk', 'rayon', 'georgette', 'print', 'stock', 'quantity', 'quality', 'rate',
    'order', 'dispatch', 'delivery', 'parcel', 'courier', 'bill', 'invoice', 'challan', 'payment', 'cheque',
    'party', 'customer', 'vendor', 'supplier',
  ],
  taskTypes: [
    'stock check / ginti', 'shade or quality check', 'maal bhejna (dispatch)', 'maal lana (pickup)',
    'delivery', 'sample bhejna', 'payment lena (collection)', 'bill banana', 'bank ka kaam',
    'store or godown visit', 'customer follow-up', 'packing',
  ],
  notes: [
    'A bare number of 4 to 6 digits (e.g. 14015) is a lot, design or bill number. Keep it in the task title. It is never a ticket number unless written with "task" or "TSK", and never an amount unless rupees are mentioned.',
    'Ticket numbers look like TSK-12.',
  ],
};

export function businessProfile(): BusinessProfile {
  const raw = process.env.WA_BUSINESS_PROFILE;
  if (!raw) return DEFAULT_PROFILE;
  try { return { ...DEFAULT_PROFILE, ...(JSON.parse(raw) as Partial<BusinessProfile>) }; }
  catch { return DEFAULT_PROFILE; }
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

export interface NameAlias { says: string; means: string }

/**
 * How people are actually referred to, where it differs from the roster.
 * From the client, 6 Oct 2026: a bare "Lalit" is the godown Lalit; "Dubey"
 * is Lalit Dubey; Dhamija is only ever called Dhamija.
 */
const DEFAULT_ALIASES: NameAlias[] = [
  { says: 'lalit',        means: 'Lalit Godown' },
  { says: 'lalit godown', means: 'Lalit Godown' },
  { says: 'dubey',        means: 'Lalit Dubey' },
  { says: 'dubey ji',     means: 'Lalit Dubey' },
  { says: 'vk dhamija',   means: 'Dhamija' },
  { says: 'dhamija ji',   means: 'Dhamija' },
  { says: 'bipin',        means: 'Bipan' },
  { says: 'vipin',        means: 'Bipan' },
];

export function nameAliases(): NameAlias[] {
  const raw = process.env.WA_NAME_ALIASES;
  if (!raw) return DEFAULT_ALIASES;
  try { return [...DEFAULT_ALIASES, ...(JSON.parse(raw) as NameAlias[])]; }
  catch { return DEFAULT_ALIASES; }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Swap a spoken name for the roster name it means, when there is an alias for
 * it AND that person is actually on the roster given. Anything else comes back
 * unchanged, so an alias can never invent somebody the sender may not reach.
 */
export function applyAlias(name: string | null | undefined, rosterNames: string[], aliases = nameAliases()): string | null {
  if (!name) return name ?? null;
  const key = norm(name);
  const hit = aliases.find((a) => norm(a.says) === key);
  if (!hit) return name;
  return rosterNames.some((r) => norm(r) === norm(hit.means)) ? hit.means : name;
}

/** Sarvam rejects the whole request above this many key terms (verified 6 Oct 2026). */
export const MAX_KEYTERMS = 50;

/**
 * The short word list a speech model is biased towards.
 *
 * Order is priority, because the list is cut at MAX_KEYTERMS: full names
 * first, then the spoken forms, then first names, then a few nouns. No verbs —
 * "deploy" in this list was heard where the speaker said "check". No
 * duplicates in any letter case: the provider refuses a list that has one,
 * and a refused list means falling back to a weaker model without anyone
 * noticing.
 */
export function speechKeyterms(rosterNames: string[], aliases = nameAliases(), profile = businessProfile()): string[] {
  const ordered: string[] = [
    ...rosterNames,
    ...aliases.map((a) => a.says.replace(/\b\w/g, (c) => c.toUpperCase())),
    ...rosterNames.map((n) => n.split(/\s+/)[0]).filter((f) => f.length >= 3),
    'FlowDesk', ...profile.locations.slice(0, 3), 'lot', 'sample', 'stock', 'payment',
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of ordered) {
    const clean = term.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length === MAX_KEYTERMS) break;
  }
  return out;
}

// ─── The context block ───────────────────────────────────────────────────────

export interface ContextData {
  profile:   BusinessProfile;
  sender:    { name: string; role: string };
  roster:    { name: string; role: string }[];
  aliases:   NameAlias[];
  openTasks: { id: string; title: string; holder: string; status: string }[];
  contacts:  string[];
}

/** Pure: the text handed to the model. Tested. */
export function renderContext(d: ContextData): string {
  const lines: string[] = [];
  lines.push('=== BUSINESS CONTEXT ===');
  lines.push(`Business: ${d.profile.description}`);
  lines.push(`Sender: ${d.sender.name} (${d.sender.role}).`);
  lines.push(`STAFF (the only people work can be given to): ${d.roster.map((r) => `${r.name} [${r.role}]`).join(', ') || 'none'}.`);
  const live = d.aliases.filter((a) => d.roster.some((r) => norm(r.name) === norm(a.means)));
  if (live.length) lines.push(`Spoken names: ${live.map((a) => `"${a.says}" means ${a.means}`).join('; ')}.`);
  lines.push(`SAVED OUTSIDE CONTACTS (vendors, customers): ${d.contacts.length ? d.contacts.join(', ') : 'none saved'}.`);
  lines.push(`Places: ${d.profile.locations.join(', ')}.`);
  lines.push(`Words used here: ${d.profile.vocabulary.join(', ')}.`);
  lines.push(`Typical jobs: ${d.profile.taskTypes.join('; ')}.`);
  for (const n of d.profile.notes) lines.push(`Note: ${n}`);
  if (d.openTasks.length) {
    lines.push('Open tasks right now:');
    for (const t of d.openTasks) lines.push(`  ${t.id} | ${t.title} | ${t.holder} | ${t.status}`);
  }
  lines.push('');
  lines.push('RULES THAT FOLLOW FROM THIS CONTEXT — they override anything above that conflicts:');
  lines.push('1. A name on the STAFF list is an employee. An instruction naming them is internal work: create_task (or reassign_ticket / add_comment / set_priority / set_deadline when a ticket is named).');
  lines.push('2. Use an outreach intent (assign_sample_dispatch, create_sales_task, create_store_check_task, create_collection_task, send_payment_reminder, send_sample_notice) ONLY when the message also names somebody from SAVED OUTSIDE CONTACTS. "bhej do", "bhejna", "send" on their own mean the employee should send something: that is create_task with the thing to send in the title.');
  lines.push('3. Write staff names exactly as on the STAFF list. Map a spoken or misspelt name to the closest STAFF name by sound. If two are equally close, or none is close, leave targets empty and lower confidence.');
  lines.push('4. Put date words (kal, aaj, parso, tomorrow, Monday, "by Friday", "shaam tak") in "deadline" and keep them OUT of "title".');
  lines.push('5. "title" is the work itself, short, in the sender\'s own words, without the person\'s name and without "ko bolo / ko bola / tell / ask".');
  return lines.join('\n');
}

/** Gather the context for one sender. Three small queries; callers fetch it lazily. */
export async function buildContext(actor: { id: string; name: string; role: string }): Promise<string> {
  const people = await assignableUsers({ id: actor.id, role: actor.role });
  const ids    = people.map((p) => p.id);

  const [tasks, contacts] = await Promise.all([
    ids.length
      ? prisma.task.findMany({
          where:   { AND: [heldByAnyUser(ids), { status: { not: 'Done' } }] },
          select:  { id: true, title: true, status: true, assignedTo: { select: { name: true } } },
          orderBy: { updatedAt: 'desc' },
          take:    30,
        })
      : Promise.resolve([]),
    contactCandidates({ id: actor.id, role: actor.role }).catch(() => []),
  ]);

  return renderContext({
    profile:   businessProfile(),
    sender:    { name: actor.name, role: actor.role },
    roster:    people.map((p) => ({ name: p.name, role: p.role })),
    aliases:   nameAliases(),
    openTasks: tasks.map((t) => ({ id: t.id, title: t.title, holder: t.assignedTo.name, status: t.status })),
    contacts:  [...new Set(contacts.map((c) => c.name))].slice(0, 40),
  });
}
