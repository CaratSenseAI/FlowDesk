// ─────────────────────────────────────────────────────────────────────────────
// "by Friday" → a Date.
//
// Pure, with the clock injected, so every case is testable without freezing
// time globally.
//
// The governing rule is that an unrecognised phrase returns null and the caller
// asks. A deadline is a commitment someone will be measured against and
// escalated over — inventing one because the text vaguely resembled a date is
// worse than admitting we didn't understand.
// ─────────────────────────────────────────────────────────────────────────────

/** Where a date lands when no time of day was given: end of the working day. */
const DEFAULT_HOUR = 18;

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

function atTime(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Pull an explicit time out of the phrase: "5pm", "5:30 pm", "17:00".
 * Returns null when none is stated, so the caller applies DEFAULT_HOUR.
 */
function extractTime(text: string): { hour: number; minute: number } | null {
  const m = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
    ?? text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3]?.toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/**
 * The next occurrence of a weekday, strictly after today.
 *
 * "next Friday" and "Friday" are treated identically. English genuinely
 * disagrees with itself about whether "next Friday" means the coming one or the
 * one after, and for a deadline the shorter reading is the safer mistake — an
 * early deadline gets renegotiated, a late one silently misses an escalation.
 */
function nextWeekday(now: Date, target: number): Date {
  const delta = ((target - now.getDay()) + 7) % 7 || 7;
  return addDays(now, delta);
}

/**
 * Turn a date phrase into a deadline, or return null.
 *
 * Recognises: today, tomorrow, day after tomorrow, weekday names, "in N
 * days/weeks", next week, end of week, end of month, DD/MM[/YYYY],
 * DD-MM[-YYYY], YYYY-MM-DD, and "5 Jan" / "Jan 5" forms — each with an
 * optional time of day.
 */
export function parseDeadline(raw: string, now: Date = new Date()): Date | null {
  if (!raw?.trim()) return null;

  const text = raw
    .toLowerCase()
    .replace(/[.,!]+$/, '')
    .replace(/^\s*(by|before|on|due|until|till|to)\s+/i, '')
    .trim();
  if (!text) return null;

  const time = extractTime(text);
  const hour   = time?.hour   ?? DEFAULT_HOUR;
  const minute = time?.minute ?? 0;

  // ── Relative days ────────────────────────────────────────────────────────
  if (/\btoday\b|\baaj\b|\bend of (the )?day\b|\beod\b/.test(text)) {
    return atTime(now, hour, minute);
  }
  if (/\bday after tomorrow\b|\bparso\b/.test(text)) {
    return atTime(addDays(now, 2), hour, minute);
  }
  if (/\btomorrow\b|\btmrw\b|\btmr\b|\bkal\b|\budya\b/.test(text)) {
    return atTime(addDays(now, 1), hour, minute);
  }

  const inDays = text.match(/\bin\s+(\d{1,3})\s*(day|days|din)\b/);
  if (inDays) return atTime(addDays(now, parseInt(inDays[1], 10)), hour, minute);

  const inWeeks = text.match(/\bin\s+(\d{1,2})\s*(week|weeks|hafte)\b/);
  if (inWeeks) return atTime(addDays(now, parseInt(inWeeks[1], 10) * 7), hour, minute);

  if (/\bnext week\b|\bagle hafte\b/.test(text)) return atTime(addDays(now, 7), hour, minute);
  if (/\bend of (the )?week\b|\beow\b/.test(text)) return atTime(nextWeekday(now, 5), hour, minute);

  if (/\bend of (the )?month\b|\beom\b/.test(text)) {
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return atTime(last, hour, minute);
  }

  // ── Weekday names ────────────────────────────────────────────────────────
  const weekday = text.match(/\b(?:next|this|coming)?\s*(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/);
  if (weekday) return atTime(nextWeekday(now, WEEKDAYS[weekday[1]]), hour, minute);

  // ── ISO ──────────────────────────────────────────────────────────────────
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const month = parseInt(iso[2], 10) - 1;
    const day   = parseInt(iso[3], 10);
    return validated(new Date(parseInt(iso[1], 10), month, day, hour, minute), day, month);
  }

  // ── DD/MM[/YYYY] and DD-MM[-YYYY] — day first, this being an Indian product ──
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day   = parseInt(numeric[1], 10);
    const month = parseInt(numeric[2], 10) - 1;
    const year  = numeric[3] ? normaliseYear(parseInt(numeric[3], 10)) : now.getFullYear();

    const candidate = new Date(year, month, day, hour, minute);
    // A bare "05/01" already past this year means next year — nobody sets a
    // deadline in the past. An explicit year is taken at its word.
    const resolved = numeric[3] || candidate >= now
      ? candidate
      : new Date(year + 1, month, day, hour, minute);

    return validated(resolved, day, month);
  }

  // ── "5 Jan" / "Jan 5" ────────────────────────────────────────────────────
  const dayFirst   = text.match(/\b(\d{1,2})\s+([a-z]{3,9})\b/);
  const monthFirst = text.match(/\b([a-z]{3,9})\s+(\d{1,2})\b/);

  for (const [dayStr, monStr] of [
    dayFirst   ? [dayFirst[1],   dayFirst[2]]   : null,
    monthFirst ? [monthFirst[2], monthFirst[1]] : null,
  ].filter(Boolean) as [string, string][]) {
    const month = MONTHS[monStr];
    if (month === undefined) continue;

    const day = parseInt(dayStr, 10);
    const candidate = new Date(now.getFullYear(), month, day, hour, minute);
    const resolved = candidate >= now
      ? candidate
      : new Date(now.getFullYear() + 1, month, day, hour, minute);

    return validated(resolved, day, month);
  }

  return null;
}

/** "26" → 2026, "2026" → 2026. */
function normaliseYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

/**
 * Reject a date that doesn't exist.
 *
 * `new Date(2026, 1, 31)` does not fail — it quietly returns 3 March. So
 * checking for NaN is not enough: "31/02" would sail through as a real-looking
 * deadline a month off from anything the sender said. The only reliable test is
 * to read the components back and see whether the calendar kept them.
 */
function validated(d: Date, day: number, month: number): Date | null {
  if (isNaN(d.getTime())) return null;
  if (d.getDate() !== day || d.getMonth() !== month) return null;
  return d;
}
