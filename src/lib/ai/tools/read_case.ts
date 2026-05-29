import { tool } from 'ai';
import { z } from 'zod';
import { getAtPath } from '@/lib/case/paths';
import type { CaseFacts } from '@/lib/case/schema';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Read the current case facts. Most case state is already provided to you in your context,',
  'so call this only when you need the FULL detail or provenance of a specific section or path',
  'that the context summary may have abbreviated.',
  'Pass `section` to read one subtree (employment | education | family | target),',
  'or `paths` to read specific dotted leaves (e.g. "employment.annualGrossSalaryEur").',
  'With no arguments it returns the entire case facts object.',
  'This tool is read-only — it never changes the case.',
].join(' ');

export const ReadCaseInputSchema = z.object({
  section: z.enum(['employment', 'education', 'family', 'target']).optional(),
  paths: z.array(z.string()).optional(),
});
export type ReadCaseInput = z.infer<typeof ReadCaseInputSchema>;

export interface ReadCaseToolDefaults {
  defaultCaseId: string;
}

export function makeReadCaseTool(
  repo: Pick<Repository, 'loadCase'>,
  defaults: ReadCaseToolDefaults,
) {
  return tool({
    description,
    inputSchema: ReadCaseInputSchema,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async execute(input: ReadCaseInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      const facts = loaded.caseFacts;

      if (input.paths && input.paths.length > 0) {
        const values: Record<string, unknown> = {};
        for (const p of input.paths) {
          values[p] = getAtPath(facts as Record<string, unknown>, p) ?? null;
        }
        return {
          type: 'read_case_result' as const,
          version: 1 as const,
          data: { kind: 'paths' as const, values },
        };
      }

      if (input.section) {
        return {
          type: 'read_case_result' as const,
          version: 1 as const,
          data: {
            kind: 'section' as const,
            section: input.section,
            value: (facts as Record<string, unknown>)[input.section] ?? null,
          },
        };
      }

      return {
        type: 'read_case_result' as const,
        version: 1 as const,
        data: { kind: 'full' as const, facts },
      };
    },
  });
}
