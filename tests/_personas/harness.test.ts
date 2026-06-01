import { describe, it, expect } from 'vitest';
import {
  loadPersona,
  toCaseFacts,
  flattenLeafValues,
  isLeafValueValid,
  deriveUpdateCalls,
  synthesizeTurnEvent,
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

describe('synthesizeTurnEvent', () => {
  it('emits an update_case tool call + result for an in-scope persona', () => {
    const ev = synthesizeTurnEvent(loadPersona('priya-strong'));
    expect(ev.toolCalls).toHaveLength(1);
    expect(ev.toolCalls[0]!.toolName).toBe('update_case');
    expect(ev.toolResults[0]!.toolName).toBe('update_case');
    const out = ev.toolResults[0]!.output as { data: { updatedPaths: string[] } };
    expect(out.data.updatedPaths).toContain('employment.annualGrossSalaryEur');
    expect(typeof ev.text).toBe('string');
  });

  it('emits an out_of_scope call and NO update_case for an out-of-scope persona', () => {
    const ev = synthesizeTurnEvent(loadPersona('out-of-scope-asylum'));
    expect(ev.toolCalls.some((c) => c.toolName === 'update_case')).toBe(false);
    expect(ev.toolCalls.some((c) => c.toolName === 'out_of_scope')).toBe(true);
  });
});
