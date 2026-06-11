import { describe, expect, it } from 'vitest';
import { requiredFormOutputForCase } from '@/lib/forms/output';
import { loadPersona, toCaseFacts } from '../_personas/harness';

describe('requiredFormOutputForCase', () => {
  it('returns CSP-integrated mode for Bengaluru cases', () => {
    const persona = loadPersona('priya-strong');

    expect(requiredFormOutputForCase(toCaseFacts(persona))).toEqual({
      mode: 'csp_integrated',
      consulateId: 'bengaluru',
      source: 'consulate_rules',
    });
  });

  it('returns VIDEX-online mode for Toronto cases', () => {
    const persona = loadPersona('toronto-strong-pretravel');

    expect(requiredFormOutputForCase(toCaseFacts(persona))).toEqual({
      mode: 'videx_online',
      consulateId: 'toronto',
      source: 'consulate_rules',
    });
  });

  it('returns unknown when the target consulate is not on file', () => {
    expect(requiredFormOutputForCase({})).toEqual({
      mode: 'unknown',
      consulateId: null,
      source: 'missing_consulate',
    });
  });
});
