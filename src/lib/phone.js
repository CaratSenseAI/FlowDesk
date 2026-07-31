// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp number validation, in one place.
//
// The Add and Edit member forms each had their own copy of a phone regex, and
// both accepted a bare national number like "9619608095". Meta's response to
// that is the worst available one: the send is ACCEPTED and a message id comes
// back, and delivery only fails seconds later in a status webhook. So a member
// saved that way looked completely fine — they could message in, because
// inbound matching only compares the last ten digits — right up until the first
// task assignment silently went nowhere.
//
// The backend now repairs bare numbers on send, so existing records still work.
// This stops new ones being created, and says why.
// ─────────────────────────────────────────────────────────────────────────────

/** Just the digits: "+91 98765 43210" → "919876543210". */
export function digitsOf(raw) {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * An E.164 number is a country code followed by a national number. In practice
 * that lands between 11 and 15 digits — India is 12 (91 + 10), the US and UK
 * are 11 and 12. Ten digits or fewer means the country code is missing, which
 * is the case worth catching, because it is what people type by habit.
 */
const MIN_DIGITS = 11;
const MAX_DIGITS = 15;

/**
 * Why this number can't be used, or null when it's fine.
 *
 * Returns a sentence rather than a boolean so both forms show the same wording,
 * and so the "you forgot the country code" case is distinguishable from
 * "that isn't a phone number" — they need different fixes.
 */
export function phoneError(raw, { required = true } = {}) {
  const trimmed = String(raw ?? '').trim();

  if (!trimmed) {
    return required
      ? 'WhatsApp number is required — task alerts are sent here.'
      : null;
  }

  if (!/^\+?[\d\s\-()]+$/.test(trimmed)) {
    return 'That doesn\'t look like a phone number. Use digits, spaces and an optional leading +.';
  }

  const digits = digitsOf(trimmed);

  if (digits.length <= 10) {
    return `Include the country code — e.g. +91 ${digits.slice(0, 5) || '98765'} ${digits.slice(5, 10) || '43210'}. Without it, WhatsApp alerts won't be delivered.`;
  }

  if (digits.length < MIN_DIGITS || digits.length > MAX_DIGITS) {
    return `That number has ${digits.length} digits. A full number with country code has ${MIN_DIGITS}–${MAX_DIGITS}.`;
  }

  return null;
}

/** Convenience for enabling UI that doesn't need to explain itself. */
export function isValidPhone(raw, opts) {
  return phoneError(raw, opts) === null;
}
