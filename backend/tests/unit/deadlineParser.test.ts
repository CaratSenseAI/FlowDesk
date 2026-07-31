import { describe, expect, it } from 'vitest';
import { parseDeadline } from '../../src/services/deadlineParser';

// Wednesday 5 August 2026, 10:00 local. A midweek anchor so "Friday" and
// "Monday" fall on opposite sides of the weekend.
const NOW = new Date(2026, 7, 5, 10, 0, 0);

/** "2026-08-07 18:00" — local, so the assertions don't depend on the TZ. */
function stamp(d: Date | null): string | null {
  if (!d) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

describe('relative days', () => {
  it.each([
    ['today',                '2026-08-05 18:00'],
    ['tomorrow',             '2026-08-06 18:00'],
    ['by tomorrow',          '2026-08-06 18:00'],
    ['day after tomorrow',   '2026-08-07 18:00'],
    ['in 3 days',            '2026-08-08 18:00'],
    ['in 2 weeks',           '2026-08-19 18:00'],
    ['next week',            '2026-08-12 18:00'],
    ['end of week',          '2026-08-07 18:00'],
    ['end of month',         '2026-08-31 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });
});

describe('weekday names', () => {
  it.each([
    ['friday',       '2026-08-07 18:00'],
    ['Friday',       '2026-08-07 18:00'],
    ['fri',          '2026-08-07 18:00'],
    ['by Friday',    '2026-08-07 18:00'],
    ['monday',       '2026-08-10 18:00'],
    ['next Monday',  '2026-08-10 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it('always moves forward, never to today', () => {
    // NOW is a Wednesday. "Wednesday" has to mean next week's, not this
    // morning — a deadline in the past escalates the instant it is set.
    expect(stamp(parseDeadline('wednesday', NOW))).toBe('2026-08-12 18:00');
  });
});

describe('explicit dates', () => {
  it.each([
    ['15/08',        '2026-08-15 18:00'],
    ['15-08',        '2026-08-15 18:00'],
    ['15/08/2026',   '2026-08-15 18:00'],
    ['15-08-26',     '2026-08-15 18:00'],
    ['2026-08-15',   '2026-08-15 18:00'],
    ['15 Aug',       '2026-08-15 18:00'],
    ['Aug 15',       '2026-08-15 18:00'],
    ['15 August',    '2026-08-15 18:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });

  it('rolls a bare date that has already passed into next year', () => {
    expect(stamp(parseDeadline('15/01', NOW))).toBe('2027-01-15 18:00');
  });

  it('takes an explicit year at its word', () => {
    expect(stamp(parseDeadline('15/01/2026', NOW))).toBe('2026-01-15 18:00');
  });
});

describe('times of day', () => {
  it.each([
    ['tomorrow 5pm',        '2026-08-06 17:00'],
    ['tomorrow at 9am',     '2026-08-06 09:00'],
    ['friday 17:30',        '2026-08-07 17:30'],
    ['tomorrow 12am',       '2026-08-06 00:00'],
    ['tomorrow 12pm',       '2026-08-06 12:00'],
  ])('%j → %s', (text, expected) => {
    expect(stamp(parseDeadline(text, NOW))).toBe(expected);
  });
});

describe('refusing to guess', () => {
  it.each([
    '', '   ', 'sometime', 'when you can', 'asap', 'soon',
    'whenever it suits you', 'next sprint',
  ])('%j is not a date', (text) => {
    expect(parseDeadline(text, NOW)).toBeNull();
  });

  it('rejects a day that does not exist', () => {
    // new Date(2026, 1, 31) silently becomes 3 March. Returning that would be
    // a deadline a month away from anything the sender said.
    expect(parseDeadline('31/02', NOW)).toBeNull();
    expect(parseDeadline('32/01', NOW)).toBeNull();
  });
});
