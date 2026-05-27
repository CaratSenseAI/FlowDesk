import axios from 'axios';

// ─── Multilingual keyword banks ───────────────────────────────────────────────
//
// Each array covers English, Hindi (romanised + Devanagari), and Marathi
// (romanised + Devanagari) to catch the natural way field workers
// describe task status in voice notes.
//
// ⚠️  Order matters within each bank — longer / more specific phrases first.

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

// ─── Types ────────────────────────────────────────────────────────────────────

export type VoiceAction = 'done' | 'issue' | 'delay' | null;

export interface IntentResult {
  action:     VoiceAction;
  /** How the intent was detected — useful for logging / debugging */
  confidence: 'keyword' | 'semantic' | 'none';
}

// ─── Stage 1: keyword scan ────────────────────────────────────────────────────

function keywordMatch(text: string): VoiceAction {
  const lower = text.toLowerCase();

  // Check longest phrases first so "all done" beats bare "done"
  if (DONE_KEYWORDS.some((k)  => lower.includes(k.toLowerCase()))) return 'done';
  if (ISSUE_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'issue';
  if (DELAY_KEYWORDS.some((k) => lower.includes(k.toLowerCase()))) return 'delay';

  return null;
}

// ─── Stage 2: Claude Haiku semantic fallback ──────────────────────────────────
//
// Called only when keyword matching draws a blank.
// Very cheap (~50 tokens in, 1 token out) so effectively free at scale.
// Requires ANTHROPIC_API_KEY in env — silently skipped if not set.

async function semanticMatch(transcript: string): Promise<VoiceAction> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const { data } = await axios.post<{
      content: Array<{ type: string; text: string }>;
    }>(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 5,
        system: [
          'You classify a field worker\'s voice note about a task into ONE of four categories.',
          'Reply with EXACTLY one word — no punctuation, no explanation:',
          '  done   → task is completed / finished',
          '  issue  → task has a problem, blocker, or error',
          '  delay  → worker needs more time / will be late',
          '  none   → cannot determine (ambiguous or unrelated)',
          'The note may be in English, Hindi, Marathi, or a mix.',
        ].join('\n'),
        messages: [
          {
            role:    'user',
            content: `Voice note transcript:\n"${transcript}"`,
          },
        ],
      },
      {
        headers: {
          'x-api-key':         apiKey,
          'anthropic-version': '2023-06-01',
          'content-type':      'application/json',
        },
        timeout: 12_000,
      },
    );

    const reply = (data.content[0]?.text ?? '').trim().toLowerCase();
    console.log(`[Intent] Claude Haiku → "${reply}"`);

    if (reply === 'done')  return 'done';
    if (reply === 'issue') return 'issue';
    if (reply === 'delay') return 'delay';
    return null;

  } catch (err) {
    // Semantic classification is best-effort — never let it crash the pipeline
    console.warn('[Intent] Claude Haiku call failed:', (err as Error).message);
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Two-stage intent detection for a voice-note transcript.
 *
 * Stage 1 — fast multilingual keyword scan (English / Hindi / Marathi).
 *            Covers ~90% of real-world voice notes with zero latency / cost.
 *
 * Stage 2 — Claude Haiku semantic classification.
 *            Catches "I've wrapped up the work" / "sab nipta liya" style phrasing
 *            that keywords miss. Only runs when Stage 1 draws a blank.
 *            Skipped silently if ANTHROPIC_API_KEY is not set.
 *
 * @param transcript  Text returned by the NVIDIA ASR service
 * @returns           { action, confidence } — action is null if genuinely ambiguous
 */
export async function detectVoiceIntent(transcript: string): Promise<IntentResult> {
  if (!transcript?.trim()) {
    return { action: null, confidence: 'none' };
  }

  // Stage 1 — keyword
  const kwAction = keywordMatch(transcript);
  if (kwAction) {
    console.log(`[Intent] Keyword match → ${kwAction}`);
    return { action: kwAction, confidence: 'keyword' };
  }

  // Stage 2 — semantic (optional)
  const semAction = await semanticMatch(transcript);
  if (semAction) {
    return { action: semAction, confidence: 'semantic' };
  }

  return { action: null, confidence: 'none' };
}
