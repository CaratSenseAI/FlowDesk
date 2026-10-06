// ─────────────────────────────────────────────────────────────────────────────
// Listening to a voice note with the staff list in view.
//
// A speech model hears sounds and writes the nearest words it knows, so
// "task for Anshul" became "task for insurance" — and no later step can turn
// "insurance" back into a person. A model that hears the AUDIO while holding
// the 25 names it could be has no such problem: on the four real notes that
// defeated Whisper (0 of 4) and Sarvam-plus-repair (3 of 4), Gemini with the
// roster named the right person in all four, in one call of about 3 seconds.
//
// So this is the first thing tried for a voice note. It returns what was
// heard and a clean one-line instruction the existing command parser already
// reads. It never acts: every spoken command is still confirmed by the sender.
//
// It is careful with the provider. One attempt per note, no retries, and after
// a rate-limit or auth refusal it stands down for a while and the older
// pipeline (Sarvam, then Whisper) takes over. A free-tier key that is hammered
// gets throttled or blocked; a voice note is never worth that.
// ─────────────────────────────────────────────────────────────────────────────
import axios from 'axios';
import { parseLooseJson } from './intentService';
import { renderListeningContext } from './businessContext';
import type { RepairedTranscript } from './voiceRepairService';

export interface Listened {
  /** What was said, Roman script. Shown back to the sender as "I heard: …". */
  heard: string;
  /** The same contract the repair step returns, so the caller treats both alike. */
  understood: RepairedTranscript;
}

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const COOL_OFF_MS = 15 * 60 * 1000;
let standDownUntil = 0;

export function geminiModel(): string {
  return process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
}

/** Test hook: clear the stand-down timer. */
export function __resetListenBackoff(): void { standDownUntil = 0; }

const LISTEN_PROMPT = [
  'You are listening to a WhatsApp voice note sent to FlowDesk, a task bot.',
  'The speaker talks in Hindi, English or Hinglish. The note is ONE of:',
  '  (a) an instruction giving work to ONE staff member,',
  '  (b) a question about tasks or status ("Rishi ke tasks", "team status", "TSK-4 ka status"),',
  '  (c) a worker reporting on their own task (done / started / a problem / needs more time).',
  '',
  'Return ONLY a JSON object with these fields:',
  '  "heard": what was said, in ROMAN script, as spoken (do not translate Hindi to English). Spell a staff name as on the STAFF list when that is clearly who was meant.',
  '  "person": the STAFF member the note is addressed to or about, EXACTLY as written on the STAFF list. Choose by SOUND. If two names are equally close, or none is close, use null. Never invent a person.',
  '  "instruction": the note as ONE clean line in Roman script:',
  '       for (a): "Task for <STAFF name>: <the work>" and, if a time was said, end with it exactly as spoken ("kal tak", "aaj shaam tak", "by Friday").',
  '       for (b) or (c): the sentence as said, cleaned up, with any ticket number like "TSK-4" kept.',
  '     Leave out abuse, threats and filler. Do not add work that was not said.',
  '  "confidence": 0 to 1 — how sure you are that "person" and "instruction" are right.',
  '  "unsure": what you could not make out, or null.',
].join('\n');

/** Pure: read the model's answer. Exported for tests. */
export function readListen(raw: string): Listened | null {
  const j = parseLooseJson(raw);
  if (!j) return null;
  const clean = (v: unknown) => {
    const s = String(v ?? '').replace(/\s+/g, ' ').trim();
    return s && s.toLowerCase() !== 'null' ? s : null;
  };
  const heard = clean(j.heard);
  const instruction = clean(j.instruction) ?? heard;
  if (!heard || !instruction) return null;
  const conf = Number(j.confidence);
  return {
    heard,
    understood: {
      text: instruction,
      person: clean(j.person),
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      unsure: clean(j.unsure),
    },
  };
}

/**
 * Listen to a voice note. Returns null when there is no key, the provider is
 * standing down, the call fails, or the answer is unusable — the caller then
 * falls back to plain transcription, exactly as before this step existed.
 */
export async function listenToVoiceNote(buffer: Buffer, mimeType: string, staffNames: string[]): Promise<Listened | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (Date.now() < standDownUntil) {
    console.log('[Listen] Gemini standing down after an earlier refusal — using the fallback');
    return null;
  }

  try {
    const { data } = await axios.post<{
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }>(
      `${GEMINI_BASE}/${geminiModel()}:generateContent`,
      {
        contents: [{
          parts: [
            { text: `${LISTEN_PROMPT}\n\n${renderListeningContext(staffNames)}` },
            { inline_data: { mime_type: mimeType.split(';')[0].trim() || 'audio/ogg', data: buffer.toString('base64') } },
          ],
        }],
        generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: 'application/json' },
      },
      { headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, timeout: 25_000 },
    );

    const out = readListen(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
    if (!out) { console.warn('[Listen] Gemini answered, but not with usable JSON'); return null; }
    console.log(`[Listen] ✅ Gemini "${out.heard.slice(0, 80)}" → "${out.understood.text.slice(0, 80)}" person=${out.understood.person ?? 'none'} conf=${out.understood.confidence}`);
    return out;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = e.response?.status;
    // Rate-limited, forbidden or unauthorised: stop asking for a while. Trying
    // again on the next note is how a throttled key becomes a blocked one.
    if (status === 429 || status === 403 || status === 401) {
      standDownUntil = Date.now() + COOL_OFF_MS;
      console.warn(`[Listen] Gemini refused (${status}) — standing down for 15 min:`, JSON.stringify(e.response?.data).slice(0, 200));
    } else {
      console.warn('[Listen] Gemini failed, using the fallback:', status ?? e.message);
    }
    return null;
  }
}
