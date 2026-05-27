import axios, { AxiosError } from 'axios';

const BASE = 'https://graph.facebook.com/v19.0';

// ─── Language → Template mapping ─────────────────────────────────────────────
// Add a row here whenever you create & approve a new language template in Meta.
// Key   = preferredLanguage value stored on the User model (lowercase)
// Value = { templateName, langCode } used in the WhatsApp API call

// Task assignment templates (sent when a task is first created)
const ASSIGNMENT_LANG_CONFIG: Record<string, { templateName: string; langCode: string }> = {
  en: { templateName: 'task_assignment_en', langCode: 'en_US' },
  hi: { templateName: 'task_assignment_hi', langCode: 'hi' },
  mr: { templateName: 'task_assignment_mr', langCode: 'mr' },
  ta: { templateName: 'task_assignment_ta', langCode: 'ta' },  // add when approved
  te: { templateName: 'task_assignment_te', langCode: 'te' },  // add when approved
};

// Escalation templates (sent when a task goes overdue)
const ESCALATION_LANG_CONFIG: Record<string, { templateName: string; langCode: string }> = {
  en: { templateName: 'task_escalation_en', langCode: 'en_US' },
  hi: { templateName: 'task_escalation_hi', langCode: 'hi' },
  mr: { templateName: 'task_escalation_mr', langCode: 'mr' },
  ta: { templateName: 'task_escalation_ta', langCode: 'ta' },  // add when approved
  te: { templateName: 'task_escalation_te', langCode: 'te' },  // add when approved
};

/**
 * Send a task-assignment notification in the member's preferred language.
 * Falls back to English if their language hasn't been set up yet.
 *
 * @param to               Phone number (E.164 or raw)
 * @param assigneeName     Used for {{1}} in the template
 * @param taskId           Used for {{2}} in the template  (e.g. "TSK-1054")
 * @param preferredLang    Value from User.preferredLanguage (e.g. "hi", "en")
 */
export async function sendTaskAssignmentNotification(
  to:            string,
  assigneeName:  string,
  taskId:        string,
  preferredLang: string = 'en',
): Promise<void> {
  const config = ASSIGNMENT_LANG_CONFIG[preferredLang] ?? ASSIGNMENT_LANG_CONFIG['en'];
  console.log(`[WhatsApp] Assignment | language "${preferredLang}" → template "${config.templateName}"`);
  await sendWhatsAppLocalized(to, config.templateName, [assigneeName, taskId], config.langCode);
}

/**
 * Send an escalation alert in the recipient's preferred language.
 * {{1}} = recipient name (assignee or manager), {{2}} = task title
 */
export async function sendEscalationNotification(
  to:            string,
  recipientName: string,
  taskTitle:     string,
  preferredLang: string = 'en',
): Promise<void> {
  const config = ESCALATION_LANG_CONFIG[preferredLang] ?? ESCALATION_LANG_CONFIG['en'];
  console.log(`[WhatsApp] Escalation | language "${preferredLang}" → template "${config.templateName}"`);
  await sendWhatsAppLocalized(to, config.templateName, [recipientName, taskTitle], config.langCode);
}

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

// ─── Interactive Messages ─────────────────────────────────────────────────────
// These only work within the 24-hour session window (after the customer has
// messaged you first). Outside that window, use sendWhatsApp() with a template.

export interface ReplyButton {
  id:    string;  // your internal ID, e.g. "done" — returned in webhook when tapped
  title: string;  // label shown on button, max 20 chars
}

/**
 * Send up to 3 quick-reply buttons.
 * Example use: "Acknowledge task" / "Report issue" / "Request delay"
 *
 * Requires an active 24-hour session (customer messaged you first).
 */
export async function sendInteractiveButtons(
  to:      string,
  bodyText: string,
  buttons: ReplyButton[],
  headerText?: string,
  footerText?: string,
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return;

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) return;

  if (buttons.length < 1 || buttons.length > 3) {
    console.warn('[WhatsApp] sendInteractiveButtons requires 1–3 buttons');
    return;
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalisedTo,
    type:              'interactive',
    interactive: {
      type: 'button',
      ...(headerText && { header: { type: 'text', text: headerText } }),
      body: { text: bodyText },
      ...(footerText && { footer: { text: footerText } }),
      action: {
        buttons: buttons.map((btn) => ({
          type:  'reply',
          reply: { id: btn.id, title: btn.title },
        })),
      },
    },
  };

  try {
    await axios.post(`${BASE}/${phoneId}/messages`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[WhatsApp] ✅ Interactive buttons sent to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendInteractiveButtons → ${normalisedTo}`);
  }
}

export interface ListRow {
  id:           string;  // returned in webhook when selected
  title:        string;  // main label, max 24 chars
  description?: string;  // subtitle, max 72 chars
}

export interface ListSection {
  title: string;         // section heading, max 24 chars
  rows:  ListRow[];      // max 10 rows across ALL sections combined
}

/**
 * Send a list message — the "More options" / menu-style button banking apps use.
 * Shows a single button labelled `buttonLabel`; tapping it opens a scrollable list.
 *
 * Example use: task actions menu, language selection, status update options.
 * Requires an active 24-hour session (customer messaged you first).
 */
export async function sendInteractiveList(
  to:           string,
  bodyText:     string,
  buttonLabel:  string,          // text on the "open menu" button, max 20 chars
  sections:     ListSection[],
  headerText?:  string,
  footerText?:  string,
): Promise<void> {
  const phoneId = process.env.META_PHONE_ID;
  const token   = process.env.META_ACCESS_TOKEN;
  if (!phoneId || !token) return;

  const normalisedTo = normalisePhone(to);
  if (!normalisedTo) return;

  const totalRows = sections.reduce((sum, s) => sum + s.rows.length, 0);
  if (totalRows > 10) {
    console.warn('[WhatsApp] sendInteractiveList: max 10 rows total across all sections');
    return;
  }

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                normalisedTo,
    type:              'interactive',
    interactive: {
      type: 'list',
      ...(headerText && { header: { type: 'text', text: headerText } }),
      body: { text: bodyText },
      ...(footerText && { footer: { text: footerText } }),
      action: {
        button:   buttonLabel,
        sections: sections.map((sec) => ({
          title: sec.title,
          rows:  sec.rows.map((row) => ({
            id:    row.id,
            title: row.title,
            ...(row.description && { description: row.description }),
          })),
        })),
      },
    },
  };

  try {
    await axios.post(`${BASE}/${phoneId}/messages`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    console.log(`[WhatsApp] ✅ Interactive list sent to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendInteractiveList → ${normalisedTo}`);
  }
}

/**
 * Send a WhatsApp template in a specific language.
 * Use this when targeting customers in Hindi, Marathi, or other regional languages.
 * The template must have been created and approved in that language in Meta Business Manager.
 *
 * @param languageCode  BCP-47 code: 'hi' (Hindi), 'mr' (Marathi), 'en_US' (English), etc.
 */
export async function sendWhatsAppLocalized(
  to:           string,
  templateName: string,
  parameters:   string[],
  languageCode: string,
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

  console.log(`[WhatsApp] Sending "${templateName}" (${languageCode}) → ${normalisedTo}`);

  try {
    await axios.post(
      `${BASE}/${phoneId}/messages`,
      {
        messaging_product: 'whatsapp',
        to:                normalisedTo,
        type:              'template',
        template: {
          name:     templateName,
          language: { code: languageCode },
          components: parameters.length > 0
            ? [{ type: 'body', parameters: parameters.map((text) => ({ type: 'text', text })) }]
            : [],
        },
      },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    console.log(`[WhatsApp] ✅ Sent localized template to ${normalisedTo}`);
  } catch (err) {
    handleMetaError(err, `sendWhatsAppLocalized → ${normalisedTo}`);
  }
}
