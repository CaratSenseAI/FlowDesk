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
): Promise<string | null> {
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
