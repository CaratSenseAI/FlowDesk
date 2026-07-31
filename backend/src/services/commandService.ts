import axios from 'axios';
import { MODEL, NVIDIA_URL, extractTaskRef, parseLooseJson } from './intentService';

// ─────────────────────────────────────────────────────────────────────────────
// Turning a manager's WhatsApp message into a structured command.
//
// This is the INTERPRETATION layer and nothing more. It reads text and returns
// a struct. It has no database access, sends nothing, and decides no
// permissions — everything it produces is treated as untrusted user input by
// commandExecutor, which re-derives every fact from the database before acting.
//
// Two stages, mirroring how intentService already works:
//
//   1. Rules      — deterministic patterns for the phrasings people actually
//                   use. No API key needed, same answer every time, and it is
//                   what the tests assert against so they don't depend on a
//                   model's mood.
//   2. AI (Ph. 2) — a small instruct model for everything the rules miss.
//
// The rules run first and, when they fully match, win outright. A model is not
// more trustworthy than an exact pattern match on this kind of input; it is
// only better at the long tail.
// ─────────────────────────────────────────────────────────────────────────────

export type CommandIntent =
  | 'reassign_ticket'
  | 'create_task'
  | 'add_comment'
  | 'set_priority'
  | 'set_deadline';

export interface ParsedCommand {
  intent: CommandIntent;
  /** Normalised `TSK-<n>`, or null when the sender didn't name one. */
  taskRef: string | null;
  /** The name as the sender typed it. Resolution to a user happens later. */
  targetName: string | null;
  /** For create_task. */
  title: string | null;
  /** Raw deadline phrase ("by Friday"). Parsed to a Date in Phase 3. */
  deadlineText: string | null;
  priority: 'Low' | 'Medium' | 'High' | null;
  /** For add_comment. */
  comment: string | null;
  /** "because I have a high workload" — recorded on the audit trail. */
  reason: string | null;
  /** 0–1. Drives whether we act straight away or confirm first. */
  confidence: number;
  source: 'rule' | 'ai';
}

// ─── Patterns ─────────────────────────────────────────────────────────────────

/**
 * Handover verbs.
 *
 * "move" is deliberately absent. It reads far more naturally as a deadline
 * command ("move TSK-1059 to Friday") and, being a common word, it is the one
 * most likely to collide with an ordinary worker message.
 */
const REASSIGN_VERB = /\b(assign|assigns|assigned|allocate|allocates|allocated|re-?assign(?:s|ed)?|delegate(?:s|d)?|allot(?:s|ted)?|transfer(?:s|red)?|hand(?:s|ed)?\s*over|handover|pass\s+(?:on|to))\b/i;

/**
 * The noun must follow the verb directly, allowing only articles between.
 *
 * This used to permit 20 characters of anything in between, which was fine
 * while people wrote "TSK-1059" — the word "task" simply didn't appear. Once
 * short ids made "task 4" the normal phrasing, "Add a comment to task 4" put
 * "add" and "task" 14 characters apart and the message parsed as a request to
 * CREATE a task. Proximity is what distinguishes "add a task" from "add a
 * comment to task 4".
 */
const CREATE_VERB = /\b(create|add|make|raise|open|set\s+up|new)\s+(?:(?:a|an|one|new|another)\s+){0,2}(task|ticket|job)\b/i;

const COMMENT_VERB = /\b(add\s+(?:a\s+)?(?:comment|note|remark)|comment|note\s+(?:on|that)|remark)\b/i;

const PRIORITY_VERB = /\b(?:set|change|make|mark|update)\b[^.!?]{0,30}?\bpriorit(?:y|ies)\b|\bpriority\b[^.!?]{0,20}?\b(?:to|as|=)\b/i;

const DEADLINE_VERB = /\b(?:set|change|extend|move|push|update|shift)\b[^.!?]{0,30}?\b(?:deadline|due\s*date|due)\b|\bdeadline\b[^.!?]{0,20}?\b(?:to|by|=)\b/i;

/**
 * "… to Vikranth", "… to Vikranth Sharma", "… for Vedant".
 *
 * Capped at three words and letters-only so it grabs a name and stops. Without
 * the cap, "assign 1059 to Vikranth because the client is waiting" swallows the
 * entire reason into the name.
 */
const NAME_AFTER = /\b(?:to|for)\s+([A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2})/i;

/**
 * Note the closing `\b`, and the absence of a bare "as".
 *
 * Without the boundary, "as" matched the first two letters of "assign" — so
 * "Tsk1059 - assign to Vikranth" had "sign to Vikranth" stripped off as a
 * reason clause and the assignee vanished. "as" is dropped entirely rather than
 * bounded, because "assign as soon as possible" would still misfire.
 */
const REASON_AFTER = /\b(?:because|since|due\s+to|reason)\b[:\s]\s*(.+)$/i;

const PRIORITY_VALUE = /\b(high|urgent|critical|medium|normal|low)\b/i;

/**
 * Deadline phrase for CREATE, where there is no ticket number to anchor on and
 * the whole message has to be searched. "to" is excluded here: in "create a
 * task for Vedant to prepare the report by Friday", the first "to" introduces
 * the work, not the date.
 */
const DEADLINE_CREATE = /\b(?:by|before|until|till|due)\s+(.+?)\s*$/i;

/**
 * Deadline phrase for SET DEADLINE, applied only to the text after the ticket
 * reference — so "to" is safe and, in "…TSK-1059 to Monday", necessary.
 */
const DEADLINE_SET = /\b(?:to|by|before|on|until|till|due)\s+(.+?)\s*$/i;

const COMMENT_BODY = /\b(?:saying|says|say|stating|states|noting|notes|note|that)\b\s*(.+)$/i;

/**
 * Words that end a name. NAME_AFTER grabs up to three words, which is right for
 * "Vikranth Sharma Rao" and wrong for "Vedant to prepare" — the capture has to
 * stop where the name stops.
 */
const NAME_STOPWORDS = new Set([
  'to', 'for', 'by', 'and', 'or', 'because', 'since', 'on', 'at', 'in', 'with',
  'from', 'before', 'until', 'till', 'due', 'please', 'pls', 'asap', 'the', 'a',
  'an', 'task', 'ticket', 'is', 'has', 'have', 'will', 'that', 'saying', 'so',
  'today', 'tomorrow', 'priority', 'about', 'regarding', 're',
]);

/**
 * Words that look like names to NAME_AFTER but never are. "assign it to me",
 * "assign to someone else" — a name slot filled with one of these is a slot the
 * sender did not actually fill.
 */
const NON_NAMES = new Set([
  'me', 'myself', 'him', 'her', 'them', 'someone', 'somebody', 'anyone',
  'anybody', 'him her', 'the team', 'team', 'us', 'you', 'it', 'this', 'that',
  'high', 'medium', 'low', 'urgent', 'today', 'tomorrow', 'complete', 'completed',
  'done', 'pending', 'progress',
]);

const PRIORITY_CANON: Record<string, 'Low' | 'Medium' | 'High'> = {
  high: 'High', urgent: 'High', critical: 'High',
  medium: 'Medium', normal: 'Medium',
  low: 'Low',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Trim a name capture down to the actual name.
 *
 * Two jobs: drop trailing punctuation ("to Vikranth." → "Vikranth") and cut the
 * capture at the first word that cannot be part of a name, so
 * "for Vedant to prepare" yields "Vedant".
 */
function cleanName(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const words: string[] = [];
  for (const word of raw.trim().split(/\s+/)) {
    const bare = word.replace(/^[^A-Za-z]+|[^A-Za-z'’\-]+$/g, '');
    if (!bare) break;
    if (NAME_STOPWORDS.has(bare.toLowerCase())) break;
    words.push(bare);
  }

  const name = words.join(' ');
  if (!name) return null;
  if (NON_NAMES.has(name.toLowerCase())) return null;
  return name;
}

function extractReason(text: string): string | null {
  const m = text.match(REASON_AFTER);
  return m?.[1]?.trim().replace(/[.!]+$/, '') || null;
}

/**
 * The part of the message that comes after the ticket reference.
 *
 * Nearly every slot we want to fill sits to the right of the ticket number, and
 * reading from the left finds the wrong thing: "Extend the deadline of TSK-1059
 * to Monday" has an "of" before the date, and "Reassign my ticket TSK-1059 to
 * Vikranth" has "my ticket" between the verb and the name. Anchoring past the
 * reference makes the first "to …" the right one.
 *
 * Returns null when there is no reference, so callers fall back to the whole
 * message rather than searching an empty string.
 */
function afterTaskRef(text: string, taskRef: string | null): string | null {
  if (!taskRef) return null;

  const digits = taskRef.replace(/\D/g, '');
  const idx = text.search(new RegExp(`\\b\\D{0,6}${digits}\\b`));
  if (idx < 0) return null;

  // Drop the reference token itself along with whatever prefix it carried.
  const tail = text.slice(idx).replace(/^\S+\s*/, '').trim();
  return tail || null;
}

/**
 * Find the assignee. Searched after the ticket reference where one exists, and
 * always with the reason clause removed first — otherwise "to Vikranth because
 * of workload" leaks the explanation into the name.
 */
function extractName(text: string, taskRef: string | null): string | null {
  const tail  = afterTaskRef(text, taskRef);
  // Only narrow to the tail if it actually contains a "to"/"for". A message
  // that names the person before the ticket ("give Vikranth 1059") must not
  // lose them.
  const scope = tail && NAME_AFTER.test(tail) ? tail : text;

  const withoutReason = scope.replace(REASON_AFTER, '');
  return cleanName(withoutReason.match(NAME_AFTER)?.[1]);
}

function blank(intent: CommandIntent, source: 'rule' | 'ai', confidence: number): ParsedCommand {
  return {
    intent, taskRef: null, targetName: null, title: null, deadlineText: null,
    priority: null, comment: null, reason: null, confidence, source,
  };
}

// ─── Stage 1: rules ───────────────────────────────────────────────────────────

/**
 * Deterministic parse. Returns null when the message isn't a management
 * command at all — which is the overwhelmingly common case, since most traffic
 * on this webhook is workers reporting on tasks.
 *
 * Confidence is graded rather than binary: a message naming both a ticket and a
 * person is a command we can act on; one missing a piece is a command we should
 * ask about. That grading is what decides between executing and clarifying.
 */
export function parseWithRules(text: string): ParsedCommand | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;

  const taskRef = extractTaskRef(trimmed);

  // ── Reassignment ──────────────────────────────────────────────────────────
  if (REASSIGN_VERB.test(trimmed)) {
    const cmd = blank('reassign_ticket', 'rule', 0);
    cmd.taskRef    = taskRef;
    cmd.targetName = extractName(trimmed, taskRef);
    cmd.reason     = extractReason(trimmed);

    // Both slots filled by an explicit verb — nothing left to guess.
    if (cmd.taskRef && cmd.targetName) cmd.confidence = 0.95;
    // One slot missing. Still clearly a reassignment request, so we ask for the
    // missing half rather than dropping the message into the worker pipeline
    // where "delegate this to Vikranth" would be read as unrelated chatter.
    else if (cmd.targetName || cmd.taskRef) cmd.confidence = 0.6;
    else return null;

    return cmd;
  }

  // ── Comment ───────────────────────────────────────────────────────────────
  //
  // Operations on an EXISTING ticket are checked before creation. A message
  // naming a ticket is talking about that ticket; only one with no reference at
  // all is asking for a new one. Ordering it the other way round meant "Add a
  // comment to task 4" was read as a request to create a task.
  if (COMMENT_VERB.test(trimmed) && taskRef) {
    const cmd = blank('add_comment', 'rule', 0.9);
    cmd.taskRef = taskRef;
    cmd.comment = extractCommentBody(afterTaskRef(trimmed, taskRef) ?? trimmed);
    if (!cmd.comment) cmd.confidence = 0.5;
    return cmd;
  }

  // ── Priority ──────────────────────────────────────────────────────────────
  if (PRIORITY_VERB.test(trimmed)) {
    const cmd = blank('set_priority', 'rule', 0.6);
    cmd.taskRef  = taskRef;
    cmd.priority = PRIORITY_CANON[trimmed.match(PRIORITY_VALUE)?.[1].toLowerCase() ?? ''] ?? null;
    if (cmd.taskRef && cmd.priority) cmd.confidence = 0.95;
    return cmd;
  }

  // ── Deadline ──────────────────────────────────────────────────────────────
  if (DEADLINE_VERB.test(trimmed)) {
    const cmd = blank('set_deadline', 'rule', 0.6);
    cmd.taskRef = taskRef;

    // Searched after the ticket reference. Reading the whole message instead
    // made "Extend the deadline of TSK-1059 to Monday" yield the date as
    // "of TSK-1059 to Monday".
    const scope = afterTaskRef(trimmed, taskRef) ?? trimmed;
    cmd.deadlineText = scope.match(DEADLINE_SET)?.[1]?.split(',')[0].trim() || null;

    if (cmd.taskRef && cmd.deadlineText) cmd.confidence = 0.9;
    return cmd;
  }

  // ── Creation ──────────────────────────────────────────────────────────────
  // Last, so that anything referring to an existing ticket has already claimed
  // the message.
  if (CREATE_VERB.test(trimmed)) {
    const cmd = blank('create_task', 'rule', 0.6);
    cmd.targetName   = extractName(trimmed, null);
    cmd.reason       = extractReason(trimmed);
    // Cut at a comma: "by tomorrow, high priority" is a date followed by a
    // separate instruction, not a five-word date.
    cmd.deadlineText = trimmed.match(DEADLINE_CREATE)?.[1]?.split(',')[0].trim() || null;
    cmd.priority     = PRIORITY_CANON[trimmed.match(PRIORITY_VALUE)?.[1].toLowerCase() ?? ''] ?? null;
    cmd.title        = extractCreatedTitle(trimmed);

    if (cmd.targetName && cmd.title) cmd.confidence = 0.9;
    return cmd;
  }

  return null;
}

/**
 * "Create a task for Vedant to prepare the weekly report by Friday"
 *                                 └────────── title ──────────┘
 */
function extractCreatedTitle(text: string): string | null {
  // Everything after "for <name> to …" is the work itself.
  let body = text.match(/\bfor\s+[A-Za-z][A-Za-z.'’\-]*(?:\s+[A-Za-z][A-Za-z.'’\-]*){0,2}\s+to\s+(.+)$/i)?.[1]
    // "Create a task to prepare the weekly report" — no assignee named yet.
    ?? text.match(/\b(?:task|ticket|job)\b\s*(?::|-)?\s*(?:to\s+)?(.+)$/i)?.[1]
    ?? null;
  if (!body) return null;

  // Cut from the deadline marker onward rather than matching the exact phrase
  // at end-of-string — "by tomorrow, high priority" has trailing text, and an
  // anchored strip would leave the whole clause in the title.
  body = body
    .replace(/\s*\b(?:by|before|until|till|due)\s+.*$/i, '')
    .replace(REASON_AFTER, '')
    .trim()
    .replace(/[.,;]+$/, '');

  return body.length >= 3 ? body : null;
}

function extractCommentBody(text: string): string | null {
  // A leading colon ("comment on TSK-1059: client approval pending") is the
  // other common form. Checked separately from the verb list because a bare
  // "-" alternative matched the hyphen inside "TSK-1059".
  const body = text.match(COMMENT_BODY)?.[1]?.trim()
    ?? text.match(/:\s*(.+)$/)?.[1]?.trim();

  return body && body.length >= 2 ? body.replace(/[.]+$/, '') : null;
}

// ─── Stage 2: the model ───────────────────────────────────────────────────────

/**
 * The ceiling on anything a language model tells us about its own certainty.
 *
 * Small instruct models are cheerfully overconfident, and the executor's
 * act-immediately threshold sits at 0.9 — so this is what decides whether a
 * model can ever cause a ticket to move without a human saying yes. Clamping
 * to exactly the threshold means it can, but only when the model is maximally
 * confident AND the name resolved to an exact match. Lower this to 0.89 to
 * require confirmation on every AI-parsed command.
 */
const AI_CONFIDENCE_CEILING = 0.9;

const COMMAND_PROMPT = [
  'You convert a WhatsApp message from a MANAGER into a structured task-management command.',
  'Messages may be in English, Hindi, Marathi, or a mix, and voice-note transcripts are often noisy.',
  '',
  'Reply with ONLY a JSON object. No markdown fence, no commentary, no reasoning:',
  '{"intent":"reassign_ticket|create_task|add_comment|set_priority|set_deadline|none",',
  ' "ticket":"<digits or null>","target":"<person name or null>","title":"<task title or null>",',
  ' "deadline":"<date phrase exactly as written, or null>","priority":"High|Medium|Low|null",',
  ' "comment":"<comment text or null>","reason":"<stated reason or null>","confidence":<0.0-1.0>}',
  '',
  'intent:',
  '  reassign_ticket = move an EXISTING ticket to a different person',
  '  create_task     = create a NEW task for someone',
  '  add_comment     = add a note or comment to a ticket',
  '  set_priority    = change a ticket\'s priority',
  '  set_deadline    = change a ticket\'s due date',
  '  none            = anything else',
  '',
  'CRITICAL: a person reporting on their OWN work is ALWAYS "none". These are all "none":',
  '  "task 1060 done"   "done"   "in progress"   "I have a problem"   "need more time"',
  '  "ho gaya"   "kar raha hoon"   "काम पूरा हो गया"   "will finish tomorrow"',
  'Only a message asking to change WHO OWNS a ticket, or to create one, is a command.',
  '',
  'ticket: digits only, from "TSK-1059", "Tsk 1059", "task number 1059", "टास्क 1059", or a',
  'bare "1059". Ticket numbers can be SHORT — "TSK-4", "task 7" and "task 12" are valid and',
  'mean 4, 7 and 12. Never pad, round or lengthen a number; report exactly the digits',
  'stated. null if none is stated — never infer or invent one. Quantities are not',
  'ticket numbers: "need 2 more days" contains no ticket.',
  '',
  'target: the person\'s name exactly as the sender wrote it, misspellings included — do not',
  'correct it. null if nobody is named. "me", "myself", "someone", "the team" are not names.',
  '',
  'confidence: your certainty that this IS a management command and that you read the slots',
  'correctly. Use below 0.7 if you are guessing at any part of it.',
].join('\n');

const AI_INTENTS: CommandIntent[] = [
  'reassign_ticket', 'create_task', 'add_comment', 'set_priority', 'set_deadline',
];

function str(v: unknown): string | null {
  const s = String(v ?? '').trim();
  return s && s.toLowerCase() !== 'null' ? s : null;
}

async function parseWithAI(text: string): Promise<ParsedCommand | null> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.post<{ choices: Array<{ message: { content: string } }> }>(
      NVIDIA_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: COMMAND_PROMPT },
          { role: 'user',   content: `Manager message:\n"""${text}"""` },
        ],
        temperature: 0,   // extraction — same answer every time
        max_tokens: 300,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );

    const parsed = parseLooseJson(data.choices?.[0]?.message?.content ?? '');
    if (!parsed) return null;

    const intent = String(parsed.intent ?? 'none').toLowerCase() as CommandIntent;
    if (!AI_INTENTS.includes(intent)) return null;

    const digits = String(parsed.ticket ?? '').replace(/\D/g, '');
    const rawConfidence = Number(parsed.confidence);

    return {
      intent,
      taskRef:    digits ? `TSK-${parseInt(digits, 10)}` : null,
      // Run the model's name through the same cleaner the rules use, so
      // "Vikranth please" can't arrive as a name from one path and not the other.
      targetName: cleanName(str(parsed.target)),
      title:      str(parsed.title),
      deadlineText: str(parsed.deadline),
      priority:   PRIORITY_CANON[str(parsed.priority)?.toLowerCase() ?? ''] ?? null,
      comment:    str(parsed.comment),
      reason:     str(parsed.reason),
      confidence: Math.min(
        Number.isFinite(rawConfidence) ? Math.max(0, rawConfidence) : 0.5,
        AI_CONFIDENCE_CEILING,
      ),
      source: 'ai',
    };
  } catch (err) {
    // Best-effort. A model outage must degrade the feature to the rule set,
    // never take down the webhook.
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.warn(
      '[Command] NVIDIA call failed:',
      e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0, 150)}` : e.message,
    );
    return null;
  }
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Combine a rule parse with a model parse.
 *
 * Rules win on the ticket number, always. The regexes handle "Tsk1058",
 * "task -1058" and "टास्क 1058" reliably, and a wrong ticket number is the most
 * damaging single field to get wrong — it points the whole command at somebody
 * else's work. Elsewhere the model fills gaps the rules left.
 *
 * Pure and exported so the precedence is testable without a network call.
 */
export function mergeParsed(
  rule: ParsedCommand | null,
  ai: ParsedCommand | null,
): ParsedCommand | null {
  if (!rule) return ai;
  if (!ai)   return rule;

  // The rules recognised a different action than the model did. Trust the
  // explicit verb: "assign" in the message beats an inference about intent.
  if (rule.intent !== ai.intent) return rule;

  const merged: ParsedCommand = {
    ...rule,
    taskRef:      rule.taskRef      ?? ai.taskRef,
    targetName:   rule.targetName   ?? ai.targetName,
    title:        rule.title        ?? ai.title,
    deadlineText: rule.deadlineText ?? ai.deadlineText,
    priority:     rule.priority     ?? ai.priority,
    comment:      rule.comment      ?? ai.comment,
    reason:       rule.reason       ?? ai.reason,
    source:       'ai',
  };

  // Confidence reflects what we ended up with, not what either stage claimed in
  // isolation: a rule parse that was only partial becomes trustworthy once the
  // model supplied the missing half, but never more trustworthy than the model
  // was about the message overall.
  merged.confidence = Math.max(rule.confidence, Math.min(ai.confidence, AI_CONFIDENCE_CEILING));
  return merged;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Work out whether this message is a management command, and what it asks for.
 *
 * The rules run first and, when they produce a complete command, the model is
 * never called — that is the common phrasing, it costs nothing, and a language
 * model is not more trustworthy than an exact pattern match on this input. The
 * model exists for the long tail, and for the cases where the rules found a
 * verb but not everything around it.
 */
export async function parseCommand(text: string): Promise<ParsedCommand | null> {
  const rule = parseWithRules(text);

  // Complete rule match — nothing a model could add, so don't pay for one.
  if (rule && rule.confidence >= 0.9) {
    console.log(`[Command] rule → ${rule.intent} task=${rule.taskRef} target=${rule.targetName}`);
    return rule;
  }

  const merged = mergeParsed(rule, await parseWithAI(text));
  if (merged) {
    console.log(
      `[Command] ${merged.source} → ${merged.intent} task=${merged.taskRef ?? 'none'} ` +
      `target=${merged.targetName ?? 'none'} conf=${merged.confidence.toFixed(2)}`,
    );
  }
  return merged;
}
