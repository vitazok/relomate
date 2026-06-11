import { describe, expect, it, vi } from 'vitest';
import { makeRequestMissingFieldTool } from '@/lib/ai/tools/request_missing_field';
import { loadPersona, toCaseFacts, toProfile } from '../_personas/harness';

const CASE_ID = 'c0000000-0000-4000-8000-000000000000';
const TODAY = new Date('2026-06-11T00:00:00.000Z');

describe('request_missing_field tool', () => {
  it('asks for a targeted actionable missing form field', async () => {
    const persona = loadPersona('priya-strong');
    const caseFacts = toCaseFacts(persona);
    delete caseFacts.target?.targetMoveDate;
    const repo = {
      loadCase: vi.fn().mockResolvedValue({
        profile: toProfile(persona),
        caseFacts,
      }),
    };
    const tool = makeRequestMissingFieldTool(repo as never, {
      defaultCaseId: CASE_ID,
      now: () => TODAY,
    });

    const out = (await tool.execute!({ fieldNumber: 29 }, {} as never)) as {
      type: string;
      version: number;
      data: {
        status: string;
        question: string;
        field: { fieldNumber: number; label: string; sourcePaths: string[] };
      };
    };

    expect(repo.loadCase).toHaveBeenCalledWith(CASE_ID);
    expect(out.type).toBe('missing_form_field_request');
    expect(out.version).toBe(1);
    expect(out.data.status).toBe('question');
    expect(out.data.question).toContain('Intended date of arrival');
    expect(out.data.field).toMatchObject({
      fieldNumber: 29,
      label: 'Intended date of arrival',
      sourcePaths: ['target.targetMoveDate'],
    });
  });

  it('asks for consulate first when the form route is unknown', async () => {
    const repo = {
      loadCase: vi.fn().mockResolvedValue({
        profile: null,
        caseFacts: {},
      }),
    };
    const tool = makeRequestMissingFieldTool(repo as never, {
      defaultCaseId: CASE_ID,
      now: () => TODAY,
    });

    const out = (await tool.execute!({}, {} as never)) as {
      data: { status: string; question: string; field: null };
    };

    expect(out.data).toEqual({
      status: 'missing_consulate',
      formOutput: { mode: 'unknown', consulateId: null, source: 'missing_consulate' },
      question: 'Which German consulate is handling this case?',
      field: null,
    });
  });
});
