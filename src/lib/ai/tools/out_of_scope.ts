import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Decline a request that falls outside what this assistant does.',
  'This assistant only helps with EU Blue Card applications to Germany via the Bengaluru consulate.',
  'Use this when the user asks for something unsupported (apartment hunting, banking, other visa types,',
  'other destination countries, legal representation, etc.).',
  'Provide a short user-facing `reason` and an optional `category`.',
  'This does NOT decide eligibility — it only records that a request was declined.',
].join(' ');

export const OutOfScopeInputSchema = z.object({
  reason: z.string().min(1),
  category: z.string().optional(),
});
export type OutOfScopeInput = z.infer<typeof OutOfScopeInputSchema>;

export interface OutOfScopeToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
}

export function makeOutOfScopeTool(
  repo: Pick<Repository, 'appendActivity'>,
  defaults: OutOfScopeToolDefaults,
) {
  return tool({
    description,
    inputSchema: OutOfScopeInputSchema,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async execute(input: OutOfScopeInput) {
      const category = input.category ?? null;
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.out_of_scope',
        payload: { reason: input.reason, category },
      });
      return {
        type: 'out_of_scope_result' as const,
        version: 1 as const,
        data: { reason: input.reason, category },
      };
    },
  });
}
