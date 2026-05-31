import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Record a free-text observation about the case that is NOT a structured fact —',
  'for example "user is anxious about the timeline" or "user mentioned a prior visa refusal, follow up".',
  'Use update_case for structured facts; use this only for annotations worth remembering.',
  'The note is appended to the case activity log. It does not change any case fact.',
].join(' ');

export const AddCaseNoteInputSchema = z.object({
  note: z.string().min(1),
});
export type AddCaseNoteInput = z.infer<typeof AddCaseNoteInputSchema>;

export interface AddCaseNoteToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  defaultSourceTurnId: string;
}

export function makeAddCaseNoteTool(
  repo: Pick<Repository, 'appendActivity'>,
  defaults: AddCaseNoteToolDefaults,
) {
  return tool({
    description,
    inputSchema: AddCaseNoteInputSchema,
    async execute(input: AddCaseNoteInput) {
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.note.added',
        payload: { note: input.note, sourceTurnId: defaults.defaultSourceTurnId },
      });
      return {
        type: 'add_case_note_result' as const,
        version: 1 as const,
        data: { noted: true },
      };
    },
  });
}
