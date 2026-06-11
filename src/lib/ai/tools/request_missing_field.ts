import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';
import { buildFormsWorkspaceViewModel, type MissingFormFieldView } from '@/lib/forms/view-model';

const description = [
  'Ask the user for one missing form field from the current route-aware Forms readiness report.',
  'This is read-only: it does not write case facts. Use it after fill_videx_form identifies',
  'missing user-provided source data, or when the user asks what to provide next for form readiness.',
  'After the user answers, call update_case with the exact source path(s) returned in this result.',
  'Do not use this for fields marked not_modelled or manual_signature; those are not user-answer gaps.',
].join(' ');

export const RequestMissingFieldInputSchema = z.object({
  fieldNumber: z.number().int().min(1).max(37).optional(),
});
export type RequestMissingFieldInput = z.infer<typeof RequestMissingFieldInputSchema>;

export interface RequestMissingFieldToolDefaults {
  defaultCaseId: string;
  now?: () => Date;
}

function questionFor(field: MissingFormFieldView, modeLabel: string): string {
  return `What should I use for "${field.label}" on the ${modeLabel} form?`;
}

export function makeRequestMissingFieldTool(
  repo: Pick<Repository, 'loadCase'>,
  defaults: RequestMissingFieldToolDefaults,
) {
  const now = defaults.now ?? (() => new Date());
  return tool({
    description,
    inputSchema: RequestMissingFieldInputSchema,
    async execute(input: RequestMissingFieldInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      const forms = buildFormsWorkspaceViewModel({
        profile: loaded.profile,
        caseFacts: loaded.caseFacts,
        today: now(),
      });

      if (forms.formOutput.source !== 'consulate_rules') {
        return {
          type: 'missing_form_field_request' as const,
          version: 1 as const,
          data: {
            status: 'missing_consulate' as const,
            formOutput: forms.formOutput,
            question: 'Which German consulate is handling this case?',
            field: null,
          },
        };
      }

      const field = input.fieldNumber
        ? forms.missingUserInput.find((candidate) => candidate.fieldNumber === input.fieldNumber)
        : forms.missingUserInput[0];

      if (!field) {
        return {
          type: 'missing_form_field_request' as const,
          version: 1 as const,
          data: {
            status: 'no_missing_user_fields' as const,
            formOutput: forms.formOutput,
            question: null,
            field: null,
          },
        };
      }

      return {
        type: 'missing_form_field_request' as const,
        version: 1 as const,
        data: {
          status: 'question' as const,
          formOutput: forms.formOutput,
          question: questionFor(field, forms.modeLabel),
          field: {
            fieldNumber: field.fieldNumber,
            label: field.label,
            sourcePaths: field.sourcePaths,
            reason: field.reason,
          },
        },
      };
    },
  });
}
