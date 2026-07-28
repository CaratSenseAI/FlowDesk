import axios from 'axios';

// ─────────────────────────────────────────────────────────────────────────────
// What this service does
//
// Field workers reply on WhatsApp in free-form text or voice notes. They almost
// never type the exact task ID. Real messages look like:
//
//   "Task 1058 completed and I clicked the picture also"
//   "Tsk 1058 done"
//   "1058 ho gaya"
//   "मैंने काम पूरा कर दिया"
//
// Two things have to come out of that:
//   1. WHICH task they mean  → extractTaskRef()
//   2. WHAT they're saying   → analyzeMessage()
//
// analyzeMessage() runs a lightweight NVIDIA NIM model first (it understands
// phrasing keywords miss and pulls the task number out of the same pass), and
// falls back to a multilingual keyword scan plus regex extraction when no API
// key is set or the call fails.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Task reference extraction ────────────────────────────────────────────────
//
// Ordered most-specific first. Each pattern captures the bare digits.
// A 3–6 digit run is required so "2 more days" or "level 3" never match.

const TASK_REF_PATTERNS: RegExp[] = [
  // TSK-1058 / TSK 1058 / TSK1058 / tsk_1058 / Tsk.1058
  /\bTSK[\s\-_.]*(\d{3,6})\b/i,
  // "T S K 1058" — speech-to-text spelling the prefix out letter by letter
  /\bT[\s.\-]*S[\s.\-]*K[\s\-_.]*(\d{3,6})\b/i,
  // task 1058 / task no 1058 / task number 1058 / task id 1058 / task #1058
  /\btask\s*(?:number|no\.?|num|id|#)?\s*[-#:]?\s*(\d{3,6})\b/i,
  // Hindi / Marathi — टास्क 1058, कार्य क्रमांक 1058
  /(?:टास्क|कार्य|काम)\s*(?:नंबर|क्रमांक|नं\.?)?\s*[-#:]?\s*(\d{3,6})/,
  // Bare 4–6 digit number, last resort. Validated against the sender's tasks
  // before it is trusted, so a stray number can't hijack the wrong task.
  /\b(\d{4,6})\b/,
];

/**
 * Pull a task reference out of free text and normalise it to `TSK-<n>`.
 * Returns null when the message contains no plausible task number.
 */
export function extractTaskRef(text: string): string | null {
  if (!text?.trim()) return null;

  for (const pattern of TASK_REF_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) return `TSK-${parseInt(match[1], 10)}`;
  }
  return null;
}

/**
 * True when the message names a task with an actual prefix ("TSK-1058",
 * "task 1058", "टास्क 1058") rather than a bare number that merely looks like
 * one. A bare number could be a quantity, an amount, or a door number, so it
 * is treated as a weak hint — see how resolveTask() uses this.
 */
export function hasExplicitTaskRef(text: string): boolean {
  if (!text?.trim()) return false;
  // Every pattern except the trailing bare-number one.
  return TASK_REF_PATTERNS.slice(0, -1).some((p) => p.test(text));
}

// ─── Multilingual keyword banks (fallback path) ───────────────────────────────
//
// English, Hindi (romanised + Devanagari), and Marathi (romanised + Devanagari).
// Longer / more specific phrases first so "all done" beats bare "done".

const DONE_KEYWORDS: string[] = [
  // English
  'all done', 'all sorted', 'marked done', 'marked complete', 'job done',
  'work done', 'task done', 'finished', 'complete', 'completed', 'done',
  'sorted', 'fixed', 'resolved',
  // Hindi — romanised
  'ho gaya', 'hogaya', 'kar diya', 'kardiya', 'khatam kar diya', 'khatam',
  'poora kar diya', 'poora', 'pura', 'complete kar diya', 'nipta diya',
  'nipta liya', 'sab theek',
  // Hindi — Devanagari
  'हो गया', 'हो गई', 'पूरा कर दिया', 'पूरा', 'खत्म कर दिया', 'खत्म',
  'कर दिया', 'निपटा दिया', 'सब ठीक', 'पूर्ण', 'समाप्त',
  // Marathi — romanised
  'zhalay', 'zhale', 'sampale', 'sampala', 'kele', 'purna', 'sampvla',
  'sampavle', 'purna zhalay',
  // Marathi — Devanagari
  'झालंय', 'झाले', 'संपले', 'संपलं', 'केले', 'पूर्ण', 'पूर्ण झाले',
];

const ISSUE_KEYWORDS: string[] = [
  // English
  'there is a problem', 'have an issue', 'facing issue', 'facing problem',
  'not working', 'not able to', 'cannot', "can't", 'blocked', 'stuck',
  'broken', 'breaking', 'failed', 'failure', 'error', 'issue', 'problem',
  // Hindi — romanised
  'problem aa gayi', 'problem hai', 'dikkat aa gayi', 'dikkat hai',
  'mushkil hai', 'ruk gaya', 'nahi ho raha', 'nahi kar pa raha',
  'band ho gaya', 'koi problem', 'koi issue',
  // Hindi — Devanagari
  'समस्या आ गई', 'समस्या है', 'दिक्कत आ गई', 'दिक्कत है',
  'मुश्किल है', 'रुक गया', 'नहीं हो रहा', 'नहीं कर पा रहा',
  'बंद हो गया', 'कोई समस्या',
  // Marathi — romanised
  'problem aahe', 'adchan aahe', 'adchan aali', 'kahi problem',
  'chalat nahi', 'jamena',
  // Marathi — Devanagari
  'अडचण आहे', 'अडचण आली', 'समस्या आहे', 'चालत नाही',
];

const DELAY_KEYWORDS: string[] = [
  // English
  'need more time', 'more time needed', 'request delay', 'requesting delay',
  'will be late', 'running late', 'postpone', 'reschedule', 'extend deadline',
  'tomorrow', 'delay', 'late',
  // Hindi — romanised
  'thoda aur samay chahiye', 'aur samay chahiye', 'aur waqt chahiye',
  'kal tak', 'kal kar dunga', 'kal kar dungi', 'late ho jayega',
  'deri ho gayi', 'deri ho rahi hai', 'deri', 'thoda time chahiye',
  // Hindi — Devanagari
  'थोड़ा और समय चाहिए', 'और समय चाहिए', 'कल तक', 'देरी हो रही है',
  'देरी हो गई', 'देरी', 'लेट हो जाएगा', 'कल',
  // Marathi — romanised
  'thoda vel pahije', 'vel pahije', 'udya karto', 'usheer hoil',
  'usheer hot aahe', 'usheer zala', 'usheer',
  // Marathi — Devanagari
  'थोडा वेळ पाहिजे', 'वेळ पाहिजे', 'उद्या करतो', 'उशीर होईल',
  'उशीर होत आहे', 'उशीर',
];

// Phrases where the worker says they've attached / are attaching evidence.
const PROOF_KEYWORDS: string[] = [
  'photo', 'picture', 'pic', 'image', 'clicked', 'attached', 'attaching',
  'sending photo', 'sent photo', 'screenshot', 'proof', 'receipt', 'bill',
  'photo bhej', 'photo bheja', 'photo khich', 'tasveer', 'foto',
  'फोटो', 'तस्वीर', 'भेज दिया', 'भेजा',
];

// ─── Types ────────────────────────────────────────────────────────────────────

export type TaskAction = 'done' | 'issue' | 'delay' | 'progress' | null;

export interface IntentResult {
  /** What the worker is reporting. `progress` = an update with no status change. */
  action: TaskAction;
  /** Normalised `TSK-<n>` the worker referred to, or null if they didn't say. */
  taskRef: string | null;
  /** True when the worker says they attached/sent evidence (photo, bill, etc.). */
  mentionsProof: boolean;
  /** One-line paraphrase used as the activity text in the tracker. */
  summary: string;
  /** How the intent was determined — useful when debugging a misroute. */
  confidence: 'ai' | 'keyword' | 'none';
}

// ─── Stage 1: Claude ──────────────────────────────────────────────────────────

const MODEL = process.env.NVIDIA_INTENT_MODEL ?? 'meta/llama-3.1-8b-instruct';

// NVIDIA NIM exposes an OpenAI-compatible chat-completions endpoint, so this is
// a plain HTTP call with the axios client the rest of the codebase already uses.
//
// Model choice — benchmarked on real messages from the tracker:
//   meta/llama-3.1-8b-instruct    9/9 correct, ~0.7s   ← default
//   meta/llama-3.2-3b-instruct    9/9 correct, ~0.9s   ← cheaper, also fine
//   nvidia/nemotron-nano-9b-v2    1/9 correct, ~3s     ← reasoning model, emits
//                                                        chain-of-thought that
//                                                        breaks JSON parsing
const NVIDIA_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const SYSTEM_PROMPT = [
  'You classify short WhatsApp messages and voice-note transcripts from field workers',
  'reporting on assigned tasks. Messages may be in English, Hindi, Marathi, or a mix,',
  'and transcripts are often noisy or misspelled.',
  '',
  'Reply with ONLY a JSON object. No markdown fence, no commentary, no reasoning:',
  '{"action":"done|issue|delay|progress|none","taskNumber":"<digits or null>",',
  ' "mentionsProof":true|false,"summary":"<max 12 words>"}',
  '',
  'action:',
  '  done     = the task is finished',
  '  issue    = a problem or blocker is stopping them',
  '  delay    = they need more time',
  '  progress = an update with no change of state',
  '  none     = unrelated or too ambiguous to tell',
  '',
  'taskNumber: digits only, from forms like "TSK-1058", "Tsk 1058", "task 1058",',
  '"task -1058", "task number 1058", "टास्क 1058", or a bare "1058". Return null if no',
  'task number is stated — never infer or invent one. Quantities are NOT task numbers:',
  'in "need 2 more days" or "3 boxes left" there is no task number.',
  '',
  'mentionsProof: true only if they say they took, attached, or sent evidence',
  '(photo, screenshot, bill, receipt). False if they merely describe the work.',
].join('\n');

/**
 * Pull a JSON object out of a model response that may be wrapped in a markdown
 * fence or trailed by commentary. Small instruct models do this often enough
 * that a bare JSON.parse() on the raw content is not reliable.
 */
function parseLooseJson(raw: string): Record<string, unknown> | null {
  let body = raw.trim();

  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) body = fence[1].trim();

  const start = body.indexOf('{');
  const end   = body.lastIndexOf('}');
  if (start === -1 || end <= start) return null;

  try {
    return JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function classifyWithAI(text: string): Promise<IntentResult | null> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.post<{
      choices: Array<{ message: { content: string } }>;
    }>(
      NVIDIA_URL,
      {
        model: MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user',   content: `Worker message:\n"""${text}"""` },
        ],
        temperature: 0,   // classification — we want the same answer every time
        max_tokens: 200,
      },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: 15_000,
      },
    );

    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed  = parseLooseJson(content);
    if (!parsed) {
      console.warn(`[Intent] ${MODEL} returned unparseable output: "${content.slice(0, 120)}"`);
      return null;
    }

    const action = String(parsed.action ?? 'none').toLowerCase();
    const digits = String(parsed.taskNumber ?? '').replace(/\D/g, '');

    return {
      action: (['done', 'issue', 'delay', 'progress'] as const).includes(action as never)
        ? (action as TaskAction)
        : null,
      taskRef: digits ? `TSK-${parseInt(digits, 10)}` : null,
      mentionsProof: parsed.mentionsProof === true,
      summary: String(parsed.summary ?? '').trim().slice(0, 120),
      confidence: 'ai',
    };
  } catch (err) {
    // Classification is best-effort — never let it take down the webhook.
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.warn(
      '[Intent] NVIDIA call failed:',
      e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0, 150)}` : e.message,
    );
    return null;
  }
}

// ─── Stage 2: keyword fallback ────────────────────────────────────────────────

function classifyWithKeywords(text: string): IntentResult {
  const lower = text.toLowerCase();
  const hit = (bank: string[]) => bank.some((k) => lower.includes(k.toLowerCase()));

  let action: TaskAction = null;
  if (hit(DONE_KEYWORDS)) action = 'done';
  else if (hit(ISSUE_KEYWORDS)) action = 'issue';
  else if (hit(DELAY_KEYWORDS)) action = 'delay';

  return {
    action,
    taskRef: extractTaskRef(text),
    mentionsProof: hit(PROOF_KEYWORDS),
    summary: text.trim().slice(0, 120),
    confidence: action ? 'keyword' : 'none',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Work out what a worker's WhatsApp message or voice-note transcript means.
 *
 * The NVIDIA model runs first — it handles phrasing the keyword banks miss and
 * extracts the task reference in the same pass. If NVIDIA_API_KEY is unset or
 * the call fails, a multilingual keyword scan takes over so the webhook keeps
 * working with degraded accuracy rather than dropping the message.
 *
 * The regex extractor always gets the final say on the task reference when the
 * AI didn't find one — the patterns catch forms like "Tsk1058" reliably.
 */
export async function analyzeMessage(text: string): Promise<IntentResult> {
  if (!text?.trim()) {
    return { action: null, taskRef: null, mentionsProof: false, summary: '', confidence: 'none' };
  }

  const ai = await classifyWithAI(text);
  if (ai) {
    console.log(`[Intent] AI → action=${ai.action ?? 'none'} task=${ai.taskRef ?? 'none'} proof=${ai.mentionsProof}`);
    // Belt and braces: if the model missed the task number, try the regexes.
    return { ...ai, taskRef: ai.taskRef ?? extractTaskRef(text) };
  }

  const kw = classifyWithKeywords(text);
  console.log(`[Intent] Keyword → action=${kw.action ?? 'none'} task=${kw.taskRef ?? 'none'}`);
  return kw;
}
