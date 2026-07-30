import { describe, expect, it } from 'vitest';
import { levenshtein, normaliseName, resolveName, scoreName } from '../../src/services/nameResolutionService';

const VIKRANTH_S = { id: 'U1', name: 'Vikranth Sharma' };
const VIKRANTH_R = { id: 'U2', name: 'Vikranth Rao' };
const VEDANT     = { id: 'U3', name: 'Vedant Kulkarni' };
const PRIYA      = { id: 'U4', name: 'Priya Sharma' };

describe('levenshtein', () => {
  it.each([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['vikrant', 'vikranth', 1],
    ['vedanth', 'vedant', 1],
    ['', 'abc', 3],
  ])('%j → %j is %i', (a, b, expected) => {
    expect(levenshtein(a, b)).toBe(expected);
    expect(levenshtein(b, a)).toBe(expected);   // symmetric
  });
});

describe('normaliseName', () => {
  it('strips accents, case and punctuation', () => {
    expect(normaliseName('Vikrànth  Sharma.')).toBe('vikranth sharma');
  });
});

describe('scoreName', () => {
  it('scores an exact first-name hit as certain', () => {
    expect(scoreName('Vikranth', 'Vikranth Sharma')).toBe(1);
  });

  it('scores a one-character typo high but not certain', () => {
    const s = scoreName('Vikrant', 'Vikranth Sharma');
    expect(s).toBeGreaterThan(0.82);
    expect(s).toBeLessThan(1);
  });

  it('keeps a short prefix out of the act-immediately band', () => {
    // "Vikr" is a hint, not an identification.
    expect(scoreName('Vikr', 'Vikranth Sharma')).toBeLessThan(0.82);
  });

  it('scores unrelated names low', () => {
    expect(scoreName('Vikranth', 'Priya Sharma')).toBeLessThan(0.6);
  });
});

describe('resolveName — the cases from the spec', () => {
  it('resolves an exact name with no confirmation needed', () => {
    const r = resolveName('Vedant', [VIKRANTH_S, VEDANT, PRIYA]);
    expect(r.status).toBe('matched');
    expect(r.match?.user.id).toBe('U3');
    expect(r.requiresConfirmation).toBe(false);
  });

  it('resolves "Vikrant" → "Vikranth" but asks first', () => {
    const r = resolveName('Vikrant', [VIKRANTH_S, VEDANT, PRIYA]);
    expect(r.status).toBe('matched');
    expect(r.match?.user.id).toBe('U1');
    // Tolerating a typo is allowed; acting on it silently is not.
    expect(r.requiresConfirmation).toBe(true);
  });

  it('resolves "Vedanth" → "Vedant" but asks first', () => {
    const r = resolveName('Vedanth', [VIKRANTH_S, VEDANT, PRIYA]);
    expect(r.status).toBe('matched');
    expect(r.match?.user.id).toBe('U3');
    expect(r.requiresConfirmation).toBe(true);
  });

  it('refuses to choose between two people called Vikranth', () => {
    const r = resolveName('Vikranth', [VIKRANTH_S, VIKRANTH_R, VEDANT]);
    expect(r.status).toBe('ambiguous');
    expect(r.match).toBeUndefined();
    expect(r.candidates.map((c) => c.user.id).sort()).toEqual(['U1', 'U2']);
  });

  it('a typo across two similar people is still ambiguous', () => {
    const r = resolveName('Vikrant', [VIKRANTH_S, VIKRANTH_R]);
    expect(r.status).toBe('ambiguous');
    expect(r.candidates).toHaveLength(2);
  });

  it('a full name disambiguates the pair', () => {
    const r = resolveName('Vikranth Sharma', [VIKRANTH_S, VIKRANTH_R]);
    expect(r.status).toBe('matched');
    expect(r.match?.user.id).toBe('U1');
    expect(r.requiresConfirmation).toBe(false);
  });

  it('does not let a new hire make an exact command ambiguous', () => {
    // "Vedant" is exact for U3 and merely close for a hypothetical "Vedanti".
    const r = resolveName('Vedant', [VEDANT, { id: 'U9', name: 'Vedanti Joshi' }]);
    expect(r.status).toBe('matched');
    expect(r.match?.user.id).toBe('U3');
  });
});

describe('resolveName — refusals', () => {
  it('finds nobody when the name is unrelated', () => {
    expect(resolveName('Bartholomew', [VIKRANTH_S, VEDANT]).status).toBe('not_found');
  });

  it('finds nobody in an empty candidate list', () => {
    // This is the shape of "you have no direct reports" and of "that person is
    // outside your hierarchy" — the caller never puts them in the list.
    const r = resolveName('Vikranth', []);
    expect(r.status).toBe('not_found');
    expect(r.candidates).toEqual([]);
  });

  it.each(['', '   '])('finds nobody for %j', (query) => {
    expect(resolveName(query, [VIKRANTH_S]).status).toBe('not_found');
  });
});
