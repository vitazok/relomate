import { describe, it, expect, vi } from 'vitest';
import { makeAddCaseNoteTool } from '@/lib/ai/tools/add_case_note';

const defaults = {
  defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
  defaultUserId: 'u0000000-0000-4000-8000-000000000000',
  defaultSourceTurnId: 't0000000-0000-4000-8000-000000000000',
};

describe('add_case_note tool', () => {
  it('exposes a tool with description and zod input', () => {
    const tool = makeAddCaseNoteTool({ appendActivity: vi.fn() }, defaults);
    expect((tool.description ?? '').length).toBeGreaterThan(40);
    expect(tool.inputSchema).toBeDefined();
  });

  it('appends a case.note.added activity row and returns noted:true', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const tool = makeAddCaseNoteTool({ appendActivity }, defaults);
    const out = await tool.execute!({ note: 'user anxious about timeline' }, {} as never);

    expect(appendActivity).toHaveBeenCalledOnce();
    expect(appendActivity.mock.calls[0]![0]).toEqual({
      caseId: defaults.defaultCaseId,
      userId: defaults.defaultUserId,
      kind: 'case.note.added',
      payload: { note: 'user anxious about timeline', sourceTurnId: defaults.defaultSourceTurnId },
    });
    expect(out).toEqual({ type: 'add_case_note_result', version: 1, data: { noted: true } });
  });
});
