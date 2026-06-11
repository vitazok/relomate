import { describe, expect, it, vi } from 'vitest';
import { makeFillVidexFormTool } from '@/lib/ai/tools/fill_videx_form';
import { loadPersona, toCaseFacts, toProfile } from '../_personas/harness';

const CASE_ID = 'c0000000-0000-4000-8000-000000000000';
const TODAY = new Date('2026-06-11T00:00:00.000Z');

describe('fill_videx_form tool', () => {
  it('returns a read-only VIDEX completeness report for the active case', async () => {
    const persona = loadPersona('priya-strong');
    const repo = {
      loadCase: vi.fn().mockResolvedValue({
        profile: toProfile(persona),
        caseFacts: toCaseFacts(persona),
      }),
    };
    const tool = makeFillVidexFormTool(repo as never, {
      defaultCaseId: CASE_ID,
      now: () => TODAY,
    });

    const out = (await tool.execute!({}, {} as never)) as {
      type: string;
      version: number;
      data: {
        formOutput: { mode: string; consulateId: string | null };
        total: number;
        filled: number;
        values: Record<string, unknown>;
        missing: unknown[];
      };
    };

    expect(repo.loadCase).toHaveBeenCalledWith(CASE_ID);
    expect(out.type).toBe('videx_completeness_result');
    expect(out.version).toBe(1);
    expect(out.data.formOutput).toMatchObject({ mode: 'csp_integrated', consulateId: 'bengaluru' });
    expect(out.data.total).toBe(37);
    expect(out.data.filled).toBeGreaterThan(20);
    expect(out.data.values.travelDocNumber).toBe('M1234567');
    expect(out.data.missing.length).toBeGreaterThan(0);
  });
});
