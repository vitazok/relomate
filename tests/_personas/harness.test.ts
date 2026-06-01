import { describe, it, expect } from 'vitest';
import {
  loadPersona,
  toCaseFacts,
  flattenLeafValues,
  isLeafValueValid,
  deriveUpdateCalls,
} from './harness';

describe('flattenLeafValues', () => {
  it('flattens wrapped leaves to {path, value} dropping provenance', () => {
    const flat = flattenLeafValues(toCaseFacts(loadPersona('priya-strong')));
    const map = Object.fromEntries(flat.map((l) => [l.path, l.value]));
    expect(map['employment.annualGrossSalaryEur']).toBe(48500);
    expect(map['education.anabinStatus']).toBe('H+');
    expect(map['target.targetConsulate']).toBe('bengaluru');
  });
});

describe('isLeafValueValid', () => {
  it('accepts a valid enum value and rejects an invalid one', () => {
    expect(isLeafValueValid('target.intendedVisa', 'blue_card')).toBe(true);
    expect(isLeafValueValid('target.intendedVisa', 'asylum')).toBe(false);
    expect(isLeafValueValid('employment.annualGrossSalaryEur', 48500)).toBe(true);
  });
});

describe('deriveUpdateCalls', () => {
  it('bundles all valid leaves into a single call for an in-scope persona', () => {
    const calls = deriveUpdateCalls(loadPersona('priya-strong'));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.source).toBe('user_stated');
    expect(calls[0]!.confidence).toBe(1);
    expect(calls[0]!.updates['employment.annualGrossSalaryEur']).toBe(48500);
    expect(calls[0]!.updates['target.intendedVisa']).toBe('blue_card');
  });

  it('isolates an invalid-enum leaf into its own single-path call (out-of-scope persona)', () => {
    const calls = deriveUpdateCalls(loadPersona('out-of-scope-asylum'));
    // First call = the valid bundle; subsequent calls = one isolated invalid leaf each.
    const isolated = calls.slice(1);
    expect(isolated).toHaveLength(1);
    const asylumCall = isolated.find((c) => 'target.intendedVisa' in c.updates);
    expect(asylumCall).toBeDefined();
    expect(Object.keys(asylumCall!.updates)).toEqual(['target.intendedVisa']);
    expect(asylumCall!.updates['target.intendedVisa']).toBe('asylum');
    // the valid bundle must NOT contain the invalid leaf
    expect('target.intendedVisa' in calls[0]!.updates).toBe(false);
  });
});
