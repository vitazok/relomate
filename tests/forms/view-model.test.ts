import { describe, expect, it } from 'vitest';
import { buildFormsWorkspaceViewModel } from '@/lib/forms/view-model';
import { loadPersona, toCaseFacts, toProfile } from '../_personas/harness';

const TODAY = new Date('2026-06-11T00:00:00.000Z');

describe('buildFormsWorkspaceViewModel', () => {
  it('builds Bengaluru CSP readiness without enabling generated output', () => {
    const persona = loadPersona('priya-strong');
    const vm = buildFormsWorkspaceViewModel({
      profile: toProfile(persona),
      caseFacts: toCaseFacts(persona),
      today: TODAY,
    });

    expect(vm.formOutput.mode).toBe('csp_integrated');
    expect(vm.modeLabel).toBe('CSP integrated');
    expect(vm.headline).toBe('Consular Services Portal readiness');
    expect(vm.ctaLabel).toBe('Open form guidance');
    expect(vm.ctaEnabled).toBe(false);
    expect(vm.filled).toBeGreaterThan(20);
    expect(vm.total).toBe(37);
    expect(vm.missingSystemSupport.map((field) => field.fieldNumber)).toContain(14);
    expect(vm.manualSignature.map((field) => field.fieldNumber)).toEqual([37]);
  });

  it('builds Toronto VIDEX readiness from the same field map', () => {
    const persona = loadPersona('toronto-strong-pretravel');
    const vm = buildFormsWorkspaceViewModel({
      profile: toProfile(persona),
      caseFacts: toCaseFacts(persona),
      today: TODAY,
    });

    expect(vm.formOutput.mode).toBe('videx_online');
    expect(vm.modeLabel).toBe('VIDEX online');
    expect(vm.headline).toBe('VIDEX readiness');
    expect(vm.ctaLabel).toBe('Generate preview');
    expect(vm.ctaEnabled).toBe(false);
    expect(vm.consulate?.verifiedByUser).toBe(false);
  });

  it('keeps the route unknown until target consulate is on file', () => {
    const vm = buildFormsWorkspaceViewModel({
      profile: null,
      caseFacts: {},
      today: TODAY,
    });

    expect(vm.formOutput).toEqual({
      mode: 'unknown',
      consulateId: null,
      source: 'missing_consulate',
    });
    expect(vm.headline).toBe('Select a consulate to determine the form route');
    expect(vm.consulate).toBeNull();
  });
});
