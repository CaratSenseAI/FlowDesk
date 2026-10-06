// ─────────────────────────────────────────────────────────────────────────────
// A second pass over a voice note's transcript, with the business in view.
//
// Speech-to-text hears sounds; it does not know who works here. On four real
// notes a roster-less transcript said "insurance" and "a nshul arrival" for
// Anshul. Given the staff list, a language model maps "a nshul arrival" back
// to Anshul Raibole — and, as importantly, says "unsure" for "insurance"
// instead of picking somebody. This step makes that correction before the
// command parser sees the text.
//
// It never acts. It returns a cleaned instruction and how sure it is; every
// spoken command is still confirmed by the sender before anything changes.
// ─────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import { MODEL, NVIDIA_CHAT_EXTRAS, NVIDIA_URL, parseLooseJson, retryOnce } from './intentService';
import { dropThreat } from './commandService';

export interface RepairedTranscript {
  /** The instruction rewritten cleanly in Roman script, names as on the roster. */
  text: string;
  person: string | null;
  confidence: number;
  unsure: string | null;
}

const REPAIR_PROMPT = [
  'You repair speech-to-text output for a WhatsApp task bot. The app is called FlowDesk.',
  'The speaker is a manager giving ONE instruction or asking ONE question, in Hindi, English or Hinglish.',
  'The transcript comes from a short compressed voice note and is often wrong, especially NAMES and product words.',
  '',
  'Using the business context below:',
  '- Work out who is meant by SOUND, not spelling: choose the STAFF name that sounds closest to the garbled name. If two are equally close, or nothing is close, set person to null. Never invent a person.',
  '- Rewrite the instruction as the speaker most plausibly said it, in ROMAN script (Hinglish or English). The rewritten text MUST contain the staff name, exactly as on the STAFF list, e.g. "Anshul Raibole ko kal tak godown check karna hai" or "Task for Anshul Raibole: check the godown". Keep numbers, dates and product words. Do not add work that was not said. Remove abuse and filler.',
  '- If the words are too garbled to say what the work is, keep the best reading and explain in "unsure".',
  '',
  'Reply with ONLY JSON, no markdown:',
  '{"text":"<clean instruction>","person":"<STAFF name or null>","confidence":<0-1>,"unsure":"<what you could not recover, or null>"}',
].join('\n');

/**
 * The text the command parser should read for a repaired voice note.
 *
 * Normally the repaired sentence. If the model identified the person but
 * left their name out of the sentence — it does, sometimes — the name is put
 * back in the one shape the rule parser reads without a model: "Task for X: …".
 * A question ("… ke tasks", "status") is left alone.
 */
export function instructionFrom(r: RepairedTranscript): string {
  r = { ...r, text: dropThreat(r.text) };
  if (!r.person) return r.text;
  const first = r.person.split(/\s+/)[0].toLowerCase();
  if (r.text.toLowerCase().includes(first)) return r.text;
  if (/\?|\b(?:status|tasks?|pending|kitne|kya\s+chal)\b/i.test(r.text)) return `${r.person}: ${r.text}`;
  return `Task for ${r.person}: ${r.text.replace(/^task\s*[:\-]?\s*/i, '')}`;
}

/** Pure: read the model's answer. Exported for tests. */
export function readRepair(raw: string, original: string): RepairedTranscript | null {
  const j = parseLooseJson(raw);
  if (!j) return null;
  const text = String(j.text ?? '').replace(/\s+/g, ' ').trim();
  const conf = Number(j.confidence);
  const person = j.person && String(j.person).toLowerCase() !== 'null' ? String(j.person).trim() : null;
  const unsure = j.unsure && String(j.unsure).toLowerCase() !== 'null' ? String(j.unsure).trim() : null;
  return {
    text: text.length >= 2 ? text : original,
    person,
    confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
    unsure,
  };
}

/**
 * Repair a transcript. Returns null when there is no model, the call fails, or
 * the answer is unusable — the caller then carries on with the raw transcript,
 * exactly as before this step existed.
 */
export async function repairTranscript(transcript: string, context: string): Promise<RepairedTranscript | null> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey || !transcript.trim()) return null;
  try {
    const { data } = await retryOnce(() => axios.post<{ choices: Array<{ message: { content: string } }> }>(
      NVIDIA_URL,
      {
        model: MODEL, ...NVIDIA_CHAT_EXTRAS, temperature: 0, max_tokens: 300,
        messages: [
          { role: 'system', content: `${REPAIR_PROMPT}\n\n${context}` },
          { role: 'user',   content: `Transcript:\n"""${transcript}"""` },
        ],
      },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15_000 },
    ));
    const out = readRepair(data.choices?.[0]?.message?.content ?? '', transcript);
    if (out) console.log(`[VoiceRepair] "${transcript.slice(0, 60)}" → "${out.text.slice(0, 80)}" person=${out.person ?? 'none'} conf=${out.confidence}`);
    return out;
  } catch (err) {
    const e = err as { response?: { status?: number }; message?: string };
    console.warn('[VoiceRepair] failed:', e.response?.status ?? e.message);
    return null;
  }
}
