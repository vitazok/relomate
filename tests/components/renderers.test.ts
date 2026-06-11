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
  DraftRequestResult,
  VidexCompletenessResult,
  MissingFormFieldRequest,
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

describe('document renderers', () => {
  it('resolves document_upload_request to a non-fallback renderer', () => {
    const r = resolveRenderer('document_upload_request');
    expect(r).not.toBe(FallbackResult);
  });
  it('resolves document_extraction_status to a non-fallback renderer', () => {
    const r = resolveRenderer('document_extraction_status');
    expect(r).not.toBe(FallbackResult);
  });
});

describe('draft renderers', () => {
  it('resolves draft_request_result to the draft renderer', () => {
    expect(resolveRenderer('draft_request_result')).toBe(DraftRequestResult);
  });
});

describe('VIDEX renderer', () => {
  it('resolves videx_completeness_result to the VIDEX renderer', () => {
    expect(resolveRenderer('videx_completeness_result')).toBe(VidexCompletenessResult);
  });

  it('renders a compact completeness summary without throwing', () => {
    const result = VidexCompletenessResult({
      output: {
        type: 'videx_completeness_result',
        version: 1,
        data: {
          formOutput: { mode: 'videx_online', consulateId: 'toronto' },
          total: 37,
          filled: 26,
          missing: [{ fieldNumber: 14, label: 'Date of issue of travel document' }],
        },
      },
    });
    expect(result).toBeTruthy();
  });
});

describe('missing form field renderer', () => {
  it('resolves missing_form_field_request to the field-request renderer', () => {
    expect(resolveRenderer('missing_form_field_request')).toBe(MissingFormFieldRequest);
  });

  it('renders a structured question without throwing', () => {
    const result = MissingFormFieldRequest({
      output: {
        type: 'missing_form_field_request',
        version: 1,
        data: {
          status: 'question',
          question: 'What should I use for "Intended date of arrival" on the VIDEX online form?',
          field: {
            fieldNumber: 29,
            label: 'Intended date of arrival',
            sourcePaths: ['target.targetMoveDate'],
          },
        },
      },
    });
    expect(result).toBeTruthy();
  });
});
