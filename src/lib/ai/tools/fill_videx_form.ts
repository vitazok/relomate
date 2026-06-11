import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';
import { assessVidexCompleteness } from '@/lib/drafting/videx';
import { requiredFormOutputForCase } from '@/lib/forms/output';

const description = [
  'Assess route-aware form readiness from the current case file.',
  'This is read-only and does not generate a PDF. It reports whether the target consulate',
  'uses an integrated Consular Services Portal form or the online VIDEX flow, then returns',
  'the fields that can be filled from Profile/CaseFacts today plus fields that still need',
  'source data, schema support, or a manual signature.',
].join(' ');

export const FillVidexFormInputSchema = z.object({});
export type FillVidexFormInput = z.infer<typeof FillVidexFormInputSchema>;

export interface FillVidexFormToolDefaults {
  defaultCaseId: string;
  now?: () => Date;
}

export function makeFillVidexFormTool(
  repo: Pick<Repository, 'loadCase'>,
  defaults: FillVidexFormToolDefaults,
) {
  const now = defaults.now ?? (() => new Date());
  return tool({
    description,
    inputSchema: FillVidexFormInputSchema,
    async execute(_input: FillVidexFormInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      return {
        type: 'videx_completeness_result' as const,
        version: 1 as const,
        data: {
          formOutput: requiredFormOutputForCase(loaded.caseFacts),
          ...assessVidexCompleteness({
            profile: loaded.profile,
            caseFacts: loaded.caseFacts,
            today: now(),
          }),
        },
      };
    },
  });
}
