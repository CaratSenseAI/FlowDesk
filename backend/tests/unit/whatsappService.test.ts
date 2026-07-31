import { describe, expect, it } from 'vitest';
import { normalisePhone } from '../../src/services/whatsappService';

// The bug this pins down: a number saved as "9619608095" was sent to Meta
// exactly as typed. Meta ACCEPTED it and returned a message id, then failed
// delivery seconds later in a status webhook — so the assignee got nothing
// while the manager was told the reassignment had worked.

describe('normalisePhone', () => {
  it.each([
    ['+91 98765 43210', '919876543210'],
    ['919876543210',    '919876543210'],
    ['+919876543210',   '919876543210'],
    ['91-98765-43210',  '919876543210'],
  ])('%j → %j', (raw, expected) => {
    expect(normalisePhone(raw)).toBe(expected);
  });

  it('adds the country code to a bare national number', () => {
    expect(normalisePhone('9619608095')).toBe('919619608095');
  });

  it('strips the domestic trunk prefix', () => {
    expect(normalisePhone('09619608095')).toBe('919619608095');
  });

  it('never double-prefixes a number that already has a country code', () => {
    // The length check is what guarantees this: anything carrying a country
    // code is longer than ten digits.
    expect(normalisePhone('919619608095')).toBe('919619608095');
    expect(normalisePhone('+919619608095')).toBe('919619608095');
  });

  it('leaves a non-Indian number alone', () => {
    expect(normalisePhone('+1 415 555 2671')).toBe('14155552671');
    expect(normalisePhone('+44 7700 900123')).toBe('447700900123');
  });

  it.each(['', '   ', 'not a phone'])('%j yields nothing to send to', (raw) => {
    expect(normalisePhone(raw)).toBe('');
  });
});
