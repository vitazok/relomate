import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRegenerateDraftTool } from '@/lib/ai/tools/regenerate_draft';

const send = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({ inngest: { send: (...args: unknown[]) => send(...args) } }));

describe('regenerate_draft tool', () => {
  beforeEach(() => {
    send.mockClear();
  });

  it('creates a new draft version, dispatches framed generation, and logs safe metadata', async () => {
    const appendActivity = vi.fn().mockResolvedValue(undefined);
    const getById = vi.fn().mockResolvedValue({
      id: 'd1111111-1111-4111-8111-111111111111',
      caseId: 'c0000000-0000-4000-8000-000000000000',
      type: 'cover_letter',
    });
    const insert = vi.fn().mockResolvedValue('d2222222-2222-4222-8222-222222222222');
    const tool = makeRegenerateDraftTool(
      { appendActivity },
      { getById, insert },
      {
        defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
        defaultUserId: 'u0000000-0000-4000-8000-000000000000',
        defaultSourceTurnId: 'm0000000-0000-4000-8000-000000000000',
      },
    );

    const result = await tool.execute!(
      {
        draftId: 'd1111111-1111-4111-8111-111111111111',
        framingInstruction: 'Make the tone more formal and preserve uncertainty.',
      },
      { toolCallId: 't', messages: [] },
    );

    expect(insert).toHaveBeenCalledWith({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      userId: 'u0000000-0000-4000-8000-000000000000',
      type: 'cover_letter',
    });
    expect(appendActivity).toHaveBeenCalledWith({
      caseId: 'c0000000-0000-4000-8000-000000000000',
      userId: 'u0000000-0000-4000-8000-000000000000',
      kind: 'case.draft.requested',
      payload: {
        draftId: 'd2222222-2222-4222-8222-222222222222',
        sourceDraftId: 'd1111111-1111-4111-8111-111111111111',
        draftType: 'cover_letter',
        sourceTurnId: 'm0000000-0000-4000-8000-000000000000',
        framingProvided: true,
      },
    });
    expect(JSON.stringify(appendActivity.mock.calls[0]?.[0])).not.toContain('more formal');
    expect(send).toHaveBeenCalledWith({
      name: 'draft.requested',
      data: {
        draftId: 'd2222222-2222-4222-8222-222222222222',
        caseId: 'c0000000-0000-4000-8000-000000000000',
        userId: 'u0000000-0000-4000-8000-000000000000',
        framingInstruction: 'Make the tone more formal and preserve uncertainty.',
      },
    });
    expect(result).toMatchObject({
      type: 'draft_request_result',
      version: 1,
      data: {
        draftId: 'd2222222-2222-4222-8222-222222222222',
        draftType: 'cover_letter',
        status: 'drafting',
      },
    });
  });

  it('rejects drafts outside the current case', async () => {
    const tool = makeRegenerateDraftTool(
      { appendActivity: vi.fn() },
      {
        getById: vi.fn().mockResolvedValue({
          id: 'd1111111-1111-4111-8111-111111111111',
          caseId: 'other-case',
          type: 'cover_letter',
        }),
        insert: vi.fn(),
      },
      {
        defaultCaseId: 'c0000000-0000-4000-8000-000000000000',
        defaultUserId: 'u0000000-0000-4000-8000-000000000000',
        defaultSourceTurnId: 'm0000000-0000-4000-8000-000000000000',
      },
    );

    await expect(
      tool.execute!(
        {
          draftId: 'd1111111-1111-4111-8111-111111111111',
          framingInstruction: 'Try again.',
        },
        { toolCallId: 't', messages: [] },
      ),
    ).rejects.toThrow(/Draft not found/);
  });
});
