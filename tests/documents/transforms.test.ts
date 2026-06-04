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
});
