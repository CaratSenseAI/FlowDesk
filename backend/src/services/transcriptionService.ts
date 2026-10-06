import axios from 'axios';
import FormData from 'form-data';

// ─── Notes on NVIDIA Parakeet ─────────────────────────────────────────────────
//
// The original intent was to use nvidia/parakeet-1.1b-rnnt-multilingual-asr from
// build.nvidia.com.  After investigation, NVIDIA's Parakeet/ASR models are gRPC-
// only (Riva protocol, port 50051). There is NO public REST HTTP endpoint at
// integrate.api.nvidia.com/v1/audio/transcriptions for these models.
//
// We therefore use Groq's Whisper API instead:
//   • Same OpenAI-compatible multipart/form-data interface
//   • Free tier: 7 200 audio minutes / day
//   • Supports Hindi, English, Marathi (Whisper large-v3-turbo)
//   • ~200× real-time speed — 5-second voice note transcribed in < 0.1 s
//
// Env vars:
//   GROQ_API_KEY   — get free at console.groq.com  (primary)
//   OPENAI_API_KEY — falls back to OpenAI Whisper if no Groq key (paid)
//
// ─── Model options ────────────────────────────────────────────────────────────
//   whisper-large-v3-turbo   fast, great multilingual    ← default
//   whisper-large-v3         slightly more accurate
//   distil-whisper-large-v3  fastest, English-heavy
//
// Set GROQ_ASR_MODEL in .env to override.

const GROQ_URL   = 'https://api.groq.com/openai/v1/audio/transcriptions';
const SARVAM_URL = 'https://api.sarvam.ai/speech-to-text';

// ─── Sarvam Saaras (primary when SARVAM_API_KEY is set) ───────────────────────
//
// Measured on four real TDM voice notes on 6 Oct 2026, the same four that
// Whisper turned into "insurance", "Unchained Arrival" and "NSHU":
//   Groq whisper-large-v3-turbo, no hint      name right in 0 of 4
//   Groq whisper-large-v3-turbo, names hint   name right in 2 of 4
//   Sarvam saaras:v4, no hint                 name right in 2 of 4
//   Sarvam saaras:v4, team names as keyterms  name right in 3 of 4, and the task
//                                             itself right ("check the godown")
// The fourth note stays unreadable to every model tried. Results were identical
// run to run. Saaras is trained on Indian speech and treats Hinglish as normal.
// `keyterms` (a JSON array, v4 only) biases it towards the team's names; the
// API refuses more than 50 terms or any duplicate, so the list is built capped
// and de-duplicated, and a refused request is retried once without it. The
// REST endpoint takes clips up to 30 seconds; anything longer, or any failure,
// falls back to Groq below so a voice note is never lost to an outage.

async function transcribeWithSarvam(buffer: Buffer, mimeType: string, keyterms: string[]): Promise<string | null> {
  const key = process.env.SARVAM_API_KEY;
  if (!key) return null;
  const model = process.env.SARVAM_ASR_MODEL ?? 'saaras:v4';
  const terms = model === 'saaras:v4' ? keyterms.slice(0, 50) : [];

  const send = (withTerms: boolean) => {
    const form = new FormData();
    form.append('file', buffer, { filename: `voice_note.${mimeToExt(mimeType)}`, contentType: mimeType.split(';')[0].trim() });
    form.append('model', model);
    form.append('language_code', 'unknown');
    if (withTerms && terms.length > 0) form.append('keyterms', JSON.stringify(terms));
    return axios.post<{ transcript?: string; language_code?: string }>(
      SARVAM_URL, form,
      { headers: { 'api-subscription-key': key, ...form.getHeaders() }, timeout: 30_000 },
    );
  };

  try {
    console.log(`[Transcribe] Sarvam ${model} | ${buffer.length} bytes | ${terms.length} keyterms`);
    let data;
    try {
      ({ data } = await send(true));
    } catch (err) {
      // A 400 is the request being refused — almost always the key terms.
      // Better a transcript without the name hint than no Sarvam at all.
      const status = (err as { response?: { status?: number; data?: unknown } }).response?.status;
      if (status !== 400 || terms.length === 0) throw err;
      console.warn('[Transcribe] Sarvam refused the request with keyterms, retrying without:',
        JSON.stringify((err as { response?: { data?: unknown } }).response?.data).slice(0, 160));
      ({ data } = await send(false));
    }
    const transcript = (data.transcript ?? '').trim();
    if (!transcript) { console.warn('[Transcribe] Sarvam returned an empty transcript'); return null; }
    console.log(`[Transcribe] ✅ Sarvam (${data.language_code ?? '?'}) "${transcript.slice(0, 120)}"`);
    return transcript;
  } catch (err) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    console.warn('[Transcribe] Sarvam failed, falling back to Groq:',
      e.response ? `${e.response.status} ${JSON.stringify(e.response.data).slice(0, 160)}` : e.message);
    return null;
  }
}
const OPENAI_URL = 'https://api.openai.com/v1/audio/transcriptions';

// Map MIME → file extension so Groq knows the container format
const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg':   'ogg',   // WhatsApp voice notes (OGG Opus)
  'audio/mpeg':  'mp3',
  'audio/mp4':   'm4a',
  'audio/wav':   'wav',
  'audio/x-wav': 'wav',
  'audio/flac':  'flac',
  'audio/webm':  'webm',
  'audio/aac':   'aac',
  'video/ogg':   'ogg',
  'video/webm':  'webm',
};

function mimeToExt(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  return MIME_TO_EXT[base] ?? 'ogg';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Transcribe audio bytes using Groq Whisper (or OpenAI Whisper as fallback).
 *
 * WhatsApp sends voice notes as OGG Opus — no format conversion needed;
 * both Groq and OpenAI accept it directly.
 *
 * @param buffer    Raw audio bytes from downloadWhatsAppMedia()
 * @param mimeType  MIME type string from Meta's media metadata
 * @returns         Transcript string, or null if no key is configured / on error
 */
export async function transcribeAudio(
  buffer:   Buffer,
  mimeType: string,
  /**
   * Names Whisper should be able to spell — the team. Passed as its prompt,
   * which biases recognition towards these words. Measured on real notes:
   * "NSHU" became "Anshul Raibole" with the hint. Kept to names only — a
   * longer vocabulary made the model hallucinate the prompt back.
   */
  names: string[] = [],
): Promise<string | null> {
  const viaSarvam = await transcribeWithSarvam(buffer, mimeType, names);
  if (viaSarvam) return viaSarvam;

  const groqKey   = process.env.GROQ_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!groqKey && !openaiKey) {
    console.warn('[Transcribe] No GROQ_API_KEY or OPENAI_API_KEY set — skipping transcription');
    return null;
  }

  const useGroq  = !!groqKey;
  const apiKey   = useGroq ? groqKey! : openaiKey!;
  const endpoint = useGroq ? GROQ_URL : OPENAI_URL;
  const model    = useGroq
    ? (process.env.GROQ_ASR_MODEL ?? 'whisper-large-v3-turbo')
    : 'whisper-1';

  const ext      = mimeToExt(mimeType);
  const filename = `voice_note.${ext}`;

  try {
    const form = new FormData();
    form.append('file', buffer, {
      filename,
      contentType: mimeType.split(';')[0].trim(),
    });
    form.append('model', model);
    if (names.length > 0) form.append('prompt', `${names.slice(0, 30).join(', ')}.`);
    // Leave 'language' unset → auto-detect (handles EN/HI/MR mixing)

    console.log(`[Transcribe] ${useGroq ? 'Groq' : 'OpenAI'} Whisper | ${buffer.length} bytes (${ext}) → ${model}`);

    const { data } = await axios.post<{ text: string }>(
      endpoint,
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 45_000,
      },
    );

    const transcript = (data.text ?? '').trim();
    if (!transcript) {
      console.warn('[Transcribe] Got empty transcript');
      return null;
    }

    console.log(`[Transcribe] ✅ "${transcript.slice(0, 120)}${transcript.length > 120 ? '…' : ''}"`);
    return transcript;

  } catch (err: unknown) {
    const e = err as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    if (e.response) {
      console.error(`[Transcribe] API error ${e.response.status}:`, e.response.data);
    } else {
      console.error('[Transcribe] Request failed:', e.message);
    }
    return null;
  }
}
