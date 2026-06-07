import { tool } from 'ai';
import { z } from 'zod';
import { inngest } from '@/lib/inngest/client';
import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import { DraftRequestResultSchema } from '@/lib/drafting/types';

const description = [
  'Start generating a cover letter draft for the current Blue Card case.',
  'Use this after the case has enough applicant, education, employment, and consulate context to draft without inventing facts.',
  'The tool creates a draft artifact and dispatches background generation; it returns immediately with the draft id.',
  'The user must review and approve the draft before it counts as ready.',
].join(' ');

export const DraftCoverLetterInputSchema = z.object({});
export type DraftCoverLetterInput = z.infer<typeof DraftCoverLetterInputSchema>;

export interface DraftCoverLetterToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  defaultSourceTurnId: string;
}

export function makeDraftCoverLetterTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftCoverLetterToolDefaults,
) {
  return tool({
    description,
    inputSchema: DraftCoverLetterInputSchema,
    async execute(_input: DraftCoverLetterInput) {
      const draftId = await drafts.insert({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        type: 'cover_letter',
      });
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.draft.requested',
        payload: {
          draftId,
          draftType: 'cover_letter',
          sourceTurnId: defaults.defaultSourceTurnId,
        },
      });
      await inngest.send({
        name: 'draft.requested',
        data: {
          draftId,
          caseId: defaults.defaultCaseId,
          userId: defaults.defaultUserId,
        },
      });
      return {
        type: 'draft_request_result' as const,
        version: 1 as const,
        data: DraftRequestResultSchema.parse({
          draftId,
          caseId: defaults.defaultCaseId,
          draftType: 'cover_letter',
          status: 'drafting',
        }),
      };
    },
  });
}
