import { tool } from 'ai';
import { z } from 'zod';
import { inngest } from '@/lib/inngest/client';
import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import {
  DRAFT_TYPE_LABELS,
  DraftRequestResultSchema,
  type DraftType,
} from '@/lib/drafting/types';

export const DraftRequestInputSchema = z.object({});
export type DraftRequestInput = z.infer<typeof DraftRequestInputSchema>;

export interface DraftRequestToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  defaultSourceTurnId: string;
}

export function makeDraftRequestTool(
  type: DraftType,
  description: string,
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftRequestToolDefaults,
) {
  return tool({
    description,
    inputSchema: DraftRequestInputSchema,
    async execute(_input: DraftRequestInput) {
      const draftId = await drafts.insert({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        type,
      });
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.draft.requested',
        payload: {
          draftId,
          draftType: type,
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
          draftType: type,
          status: 'drafting',
        }),
      };
    },
  });
}

export function draftRequestDescription(type: DraftType, readiness: string): string {
  const label = DRAFT_TYPE_LABELS[type];
  const sentenceLabel = type === 'cv' ? label : label.toLowerCase();
  return [
    `Start generating a ${sentenceLabel} draft for the current Blue Card case.`,
    readiness,
    'The tool creates a draft artifact and dispatches background generation; it returns immediately with the draft id.',
    `The user must review and approve the ${sentenceLabel} before it counts as ready.`,
  ].join(' ');
}
