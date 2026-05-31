import { describe, it, expect } from 'vitest';
import {
  resolveRenderer,
  UpdateCaseResult,
  ReadCaseResult,
  AddCaseNoteResult,
  OutOfScopeResult,
  EligibilityResult,
  AnabinResult,
  FallbackResult,
} from '@/components/workspace/renderers/registry';

describe('renderer registry', () => {
  it('resolves each known result type to its renderer', () => {
    expect(resolveRenderer('update_case_result')).toBe(UpdateCaseResult);
    expect(resolveRenderer('read_case_result')).toBe(ReadCaseResult);
    expect(resolveRenderer('add_case_note_result')).toBe(AddCaseNoteResult);
    expect(resolveRenderer('out_of_scope_result')).toBe(OutOfScopeResult);
  });

  it('falls back for an unknown type', () => {
    expect(resolveRenderer('something_new_result')).toBe(FallbackResult);
  });
});

describe('eligibility_result + anabin_result renderers', () => {
  it('resolves the new result types', () => {
    expect(resolveRenderer('eligibility_result')).toBe(EligibilityResult);
    expect(resolveRenderer('anabin_result')).toBe(AnabinResult);
  });

  it('EligibilityResult returns an element for each status without throwing', () => {
    const assessed = EligibilityResult({ output: { type: 'eligibility_result', version: 1, data: {
      status: 'assessed', qualifies: true, routes: ['standard'], blockers: [], warnings: [],
      figures: {
        salaryOnFile: 60000,
        standard: { annualGrossEur: 50700, legalBasis: '§18g Abs. 1', meets: true },
        reduced: { annualGrossEur: 45934.2, legalBasis: '§18g Abs. 1 S. 2', meets: true },
      },
    } } });
    const incomplete = EligibilityResult({ output: { type: 'eligibility_result', version: 1, data: {
      status: 'incomplete', missing: ['employment.annualGrossSalaryEur'],
    } } });
    expect(assessed).toBeTruthy();
    expect(incomplete).toBeTruthy();
  });

  it('AnabinResult returns an element for found and not-found without throwing', () => {
    const notFound = AnabinResult({ output: { type: 'anabin_result', version: 1, data: {
      found: false, query: 'XYZ College',
    } } });
    const found = AnabinResult({ output: { type: 'anabin_result', version: 1, data: {
      found: true, status: 'unknown', institution: 'IIT Bombay', verifiedByUser: false,
      anabinUrl: null, degrees: [],
    } } });
    expect(notFound).toBeTruthy();
    expect(found).toBeTruthy();
  });
});
