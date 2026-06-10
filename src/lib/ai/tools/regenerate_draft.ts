import { tool } from 'ai';
import { z } from 'zod';
import { inngest } from '@/lib/inngest/client';
import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import { DraftRequestResultSchema } from '@/lib/drafting/types';

export const RegenerateDraftInputSchema = z.object({
  draftId: z.string().uuid(),
  framingInstruction: z.string().trim().min(1).max(1200),
});
export type RegenerateDraftInput = z.infer<typeof RegenerateDraftInputSchema>;

export interface RegenerateDraftToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  defaultSourceTurnId: string;
}

export function makeRegenerateDraftTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'getById' | 'insert'>,
  defaults: RegenerateDraftToolDefaults,
) {
  return tool({
    description: [
      'Regenerate an existing draft artifact with reviewer framing instructions.',
      'Use this when the user asks for a new version of a cover letter, employer letter, CV, or Anabin justification.',
      'The draftId must be an existing draft in the current case.',
      'The framingInstruction should describe tone, emphasis, omissions, or corrections, but must not ask the model to invent facts or legal conclusions.',
      'The tool creates a new draft version and dispatches background generation; it returns immediately with the new draft id.',
    ].join(' '),
    inputSchema: RegenerateDraftInputSchema,
    async execute(input: RegenerateDraftInput) {
      const source = await drafts.getById(input.draftId);
      if (!source || source.caseId !== defaults.defaultCaseId) {
        throw new Error('Draft not found for this case.');
      }

      const draftId = await drafts.insert({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        type: source.type,
      });
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.draft.requested',
        payload: {
          draftId,
          sourceDraftId: source.id,
          draftType: source.type,
          sourceTurnId: defaults.defaultSourceTurnId,
          framingProvided: true,
        },
      });
      await inngest.send({
        name: 'draft.requested',
        data: {
          draftId,
          caseId: defaults.defaultCaseId,
          userId: defaults.defaultUserId,
          framingInstruction: input.framingInstruction,
        },
      });
      return {
        type: 'draft_request_result' as const,
        version: 1 as const,
        data: DraftRequestResultSchema.parse({
          draftId,
          caseId: defaults.defaultCaseId,
          draftType: source.type,
          status: 'drafting',
        }),
      };
    },
  });
}
