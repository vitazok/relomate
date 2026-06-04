import { describe, it, expect } from 'vitest';
import { applyTransform } from '@/lib/documents/transforms';

describe('transforms', () => {
  it('composeFullName joins given + surname', () => {
    const out = applyTransform('composeFullName', [
      { key: 'surname', value: 'Sharma', part: 'surname' },
      { key: 'givenNames', value: 'Priya', part: 'given' },
    ]);
    expect(out).toBe('Priya Sharma');
  });

  it('composeFullName tolerates a missing part', () => {
    const out = applyTransform('composeFullName', [{ key: 'surname', value: 'Sharma', part: 'surname' }]);
    expect(out).toBe('Sharma');
  });

  it('composeFullName returns null when nothing usable', () => {
    expect(applyTransform('composeFullName', [{ key: 'surname', value: '', part: 'surname' }])).toBeNull();
  });

  it('toIso2 maps a known nationality name (case-insensitive)', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'India' }])).toBe('IN');
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'indian' }])).toBe('IN');
  });

  it('toIso2 passes through a valid 2-letter code', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'de' }])).toBe('DE');
  });

  it('toIso2 returns null for an unknown nationality', () => {
    expect(applyTransform('toIso2', [{ key: 'nationality', value: 'Atlantis' }])).toBeNull();
  });

  it('an unknown transform name throws', () => {
    expect(() => applyTransform('nope', [{ key: 'x', value: 'y' }])).toThrow(/unknown transform/i);
  });

  it('normalizeDate passes through ISO YYYY-MM-DD', () => {
    expect(applyTransform('normalizeDate', [{ key: 'dateOfBirth', value: '1990-04-12' }])).toBe('1990-04-12');
  });

  it('normalizeDate parses "15 JAN 1990" style', () => {
    expect(applyTransform('normalizeDate', [{ key: 'dateOfBirth', value: '15 JAN 1990' }])).toBe('1990-01-15');
  });

  it('normalizeDate parses "15 Jan 1990" and "1 Jan 1990"', () => {
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '15 Jan 1990' }])).toBe('1990-01-15');
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '1 Jan 1990' }])).toBe('1990-01-01');
  });

  it('normalizeDate parses DD/MM/YYYY (day-first, the ICAO/India convention)', () => {
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '12/04/1990' }])).toBe('1990-04-12');
  });

  it('normalizeDate parses DD.MM.YYYY and DD-MM-YYYY', () => {
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '12.04.1990' }])).toBe('1990-04-12');
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '12-04-1990' }])).toBe('1990-04-12');
  });

  it('normalizeDate returns null for an unparseable value', () => {
    expect(applyTransform('normalizeDate', [{ key: 'd', value: 'sometime in 1990' }])).toBeNull();
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '' }])).toBeNull();
    expect(applyTransform('normalizeDate', [{ key: 'd', value: 42 }])).toBeNull();
  });

  it('normalizeDate rejects an out-of-range date', () => {
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '32/01/1990' }])).toBeNull();
    expect(applyTransform('normalizeDate', [{ key: 'd', value: '1990-13-01' }])).toBeNull();
  });
});
