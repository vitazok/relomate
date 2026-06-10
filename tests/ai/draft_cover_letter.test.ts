import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDraftCoverLetterTool } from '@/lib/ai/tools/draft_cover_letter';
import { makeDraftEmployerLetterTool } from '@/lib/ai/tools/draft_employer_letter';
import { makeDraftCvTool } from '@/lib/ai/tools/draft_cv';
import { makeDraftAnabinJustificationTool } from '@/lib/ai/tools/draft_anabin_justification';
import type { DraftType } from '@/lib/drafting/types';

const send = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));

describe('draft request tools', () => {
  beforeEach(() => {
    send.mockClear();
  });

  it.each([
    ['cover_letter' as const, makeDraftCoverLetterTool],
    ['employer_letter' as const, makeDraftEmployerLetterTool],
    ['cv' as const, makeDraftCvTool],
    ['anabin_justification' as const, makeDraftAnabinJustificationTool],
  ])('creates a %s draft row, dispatches generation, logs request, and returns typed output', async (type: DraftType, factory) => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const insert = vi.fn().mockResolvedValue('d0000000-0000-4000-8000-000000000000');
    const draftTool = factory(
      { appendActivity },
      { insert },
      {
        defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
        defaultUserId: 'u0000000-0000-4000-8000-000000000000',
        defaultSourceTurnId: 'm0000000-0000-4000-8000-000000000000',
      },
    );

    const result = await draftTool.execute!({}, { toolCallId: 't', messages: [] });

    expect(insert).toHaveBeenCalledWith({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      userId: 'u0000000-0000-4000-8000-000000000000',
      type,
    });
    expect(appendActivity).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      name: 'draft.requested',
      data: {
        draftId: 'd0000000-0000-4000-8000-000000000000',
        caseId: 'c0000000-0000-4000-8000-000000000000',
        userId: 'u0000000-0000-4000-8000-000000000000',
      },
    });
    expect(result).toEqual({
      type: 'draft_request_result',
      version: 1,
      data: {
        draftId: 'd0000000-0000-4000-8000-000000000000',
        caseId: 'c0000000-0000-4000-8000-000000000000',
        draftType: type,
        status: 'drafting',
      },
    });
  });
});
