import { describe, it, expect } from 'vitest';
import {
  resolveRenderer,
  UpdateCaseResult,
  ReadCaseResult,
  AddCaseNoteResult,
  OutOfScopeResult,
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
