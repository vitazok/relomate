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

  it('preserves Toronto as a valid target consulate', () => {
    const flat = flattenLeafValues(toCaseFacts(loadPersona('toronto-strong-pretravel')));
    const map = Object.fromEntries(flat.map((l) => [l.path, l.value]));
    expect(map['target.targetConsulate']).toBe('toronto');
    expect(isLeafValueValid('target.targetConsulate', 'toronto')).toBe(true);
  });
});

describe('isLeafValueValid', () => {
  it('accepts a valid enum value and rejects an invalid one', () => {
    expect(isLeafValueValid('target.intendedVisa', 'blue_card')).toBe(true);
    // 'asylum' is now a VALID intendedVisa value (the enum was widened so the engine can flag
    // out-of-scope through persisted facts — see #3); a truly invalid enum value is still rejected.
    expect(isLeafValueValid('target.intendedVisa', 'asylum')).toBe(true);
    expect(isLeafValueValid('target.intendedVisa', 'not-a-real-visa')).toBe(false);
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

  it('bundles the now-valid out-of-scope visa value (no isolated invalid leaf)', () => {
    const calls = deriveUpdateCalls(loadPersona('out-of-scope-asylum'));
    // Since the IntendedVisa enum was widened (#3), intendedVisa='asylum' is a VALID leaf and
    // bundles into call 0 like any other — there is no longer an isolated invalid-leaf call.
    expect(calls).toHaveLength(1);
    expect(calls[0]!.updates['target.intendedVisa']).toBe('asylum');
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
