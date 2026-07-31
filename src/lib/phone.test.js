import { describe, expect, it } from 'vitest';
import { digitsOf, isValidPhone, phoneError } from './phone.js';

describe('digitsOf', () => {
  it('keeps only digits', () => {
    expect(digitsOf('+91 98765 43210')).toBe('919876543210');
    expect(digitsOf('(044) 2811-1111')).toBe('04428111111');
    expect(digitsOf(null)).toBe('');
  });
});

describe('phoneError', () => {
  it.each([
    '+91 98765 43210',
    '919876543210',
    '+919876543210',
    '+1 415 555 2671',
    '+44 7700 900123',
  ])('accepts %j', (raw) => {
    expect(phoneError(raw)).toBeNull();
    expect(isValidPhone(raw)).toBe(true);
  });

  it('catches the missing country code', () => {
    // The exact input that produced an undeliverable notification in
    // production: valid-looking, accepted by Meta, never delivered.
    const msg = phoneError('9619608095');
    expect(msg).toContain('country code');
    expect(msg).toContain("won't be delivered");
  });

  it('echoes back what they typed in the example', () => {
    // Showing their own number in the corrected shape beats a generic
    // placeholder — it makes the missing piece obvious at a glance.
    expect(phoneError('9619608095')).toContain('+91 96196 08095');
  });

  it('distinguishes "not a number" from "missing country code"', () => {
    expect(phoneError('not a phone')).toContain("doesn't look like a phone number");
  });

  it('rejects something far too long', () => {
    expect(phoneError('9198765432109876')).toContain('digits');
  });

  it('requires a value by default', () => {
    expect(phoneError('')).toContain('required');
    expect(phoneError('   ')).toContain('required');
  });

  it('allows an empty value when the field is optional', () => {
    // Edit keeps this optional: an existing member may legitimately have no
    // number, and clearing it should not be blocked.
    expect(phoneError('', { required: false })).toBeNull();
  });

  it('still validates a non-empty value on an optional field', () => {
    expect(phoneError('9619608095', { required: false })).toContain('country code');
  });
});
