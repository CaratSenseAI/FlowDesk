import axios, { AxiosError } from 'axios';

const BASE = 'https://graph.facebook.com/v19.0';

/**
 * While META_TEMPLATES_APPROVED !== "true", every outbound message falls back
 * to the pre-approved `hello_world` template (no parameters).
 * Flip the env var to "true" once Meta approves task_assignment + task_escalation.
 */
function resolveTemplate(
  name: string,
  parameters: string[]
): { name: string; parameters: string[] } {
  if (process.env.META_TEMPLATES_APPROVED === 'true') {
    return { name, parameters };
  }
  return { name: 'hello_world', parameters: [] };
}

/**
 * Normalise a phone number to E.164 digits-only format required by Meta.
 * "+91 98765 43210" → "919876543210"
 */
function normalisePhone(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Translate a Meta API error into a clear console message.
 * Specifically calls out token expiry so it's impossible to miss in the logs.
 */
function handleMetaError(err: unknown, context: string): void {
  const axiosErr = err as AxiosError<{ error?: { code?: number; message?: string; error_subcode?: number } }>;
  const metaError = axiosErr.response?.data?.error;

  if (metaError?.code === 190) {
    // Token expired or invalid
    const subcode = metaError.error_subcode;
    if (subcode === 463 || subcode === 467) {
      console.error(
        `\n🚨 [WhatsApp] ACCESS TOKEN EXPIRED — ${context}\n` +
        `   Go to: Meta Developer Dashboard → WhatsApp → API Setup → Generate token\n` +
        `   Then update META_ACCESS_TOKEN in backend/.env and restart.\n` +
        `   Meta message: ${metaError.message}\n`
      );
    } else {
      console.error(`🚨 [WhatsApp] INVALID TOKEN (code 190, subcode ${subcode}) — ${context}`);
      console.error(`   Meta message: ${metaError.message}`);
    }
    return;
  }

  if (metaError) {
    console.error(`[WhatsApp] Meta API error (${context}): code=${metaError.code} — ${metaError.message}`);
    return;
  }

  console.error(`[WhatsApp] Unexpected error (${context}):`, err);
}

/**
 * Verify the token is still valid on startup.
 * Logs a clear warning so you know immediately when the server starts.
 */
export async function verifyTokenOnStartup(): Promise<void> {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token || token.startsWith('EAADxxxxxx')) {
    console.warn('[WhatsApp] META_ACCESS_TOKEN not configured — WhatsApp sends will be skipped.');
    return;
  }
  try {
    await axios.get(`${BASE}/me`, { params: { access_token: token } });
    console.log('[WhatsApp] ✅ Token verified — ready to send messages');
  } catch (err) {
    handleMetaError(err, 'startup token check');
  }
}

export async function sendWhatsApp(
  to: string,
  templateName: string,
  parameters: string[]
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return;
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number — skipping send');
    return;
  }

  const resolved = resolveTemplate(templateName, parameters);
  console.log(`[WhatsApp] Sending "${resolved.name}" → ${normalisedTo}`);

  try {
    await axios.post(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: normalisedTo,
        type: 'template',
        template: {
          name:     resolved.name,
          language: { code: 'en_US' },
          components: resolved.parameters.length > 0
            ? [{ type: 'body', parameters: resolved.parameters.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`[WhatsApp] ✅ Sent to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendWhatsApp → ${normalisedTo}`);
  }
}

export async function sendTextMessage(to: string, text: string): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;

  if (!phoneId || !token) {
    console.warn('[WhatsApp] META_PHONE_ID or META_ACCESS_TOKEN not set — skipping send');
    return;
  }

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) {
    console.warn('[WhatsApp] Invalid phone number — skipping send');
    return;
  }

  try {
    await axios.post(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to:   normalisedTo,
        type: 'text',
        text: { body: text },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  } catch (err) {
    handleMetaError(err, `sendTextMessage → ${normalisedTo}`);
  }
}
