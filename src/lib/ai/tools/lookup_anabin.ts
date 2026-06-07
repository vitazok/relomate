import { tool } from 'ai';
import { z } from 'zod';
import { getAnabinInstitutionByName } from '@/lib/rules/loader';

const description = [
  'Look up the German recognition status (Anabin) of a foreign higher-education institution.',
  'Call this when a degree\'s recognition is in question — before concluding anything about',
  'whether a qualification counts for the Blue Card.',
  'If the institution is not in our database (found:false) or is present but unrated',
  '(status:"unknown"), explain that a ZAB individual assessment / statement and consulate',
  'clarification are the path forward — do not guess a status.',
  'This is read-only; persist any conclusion separately with update_case.',
].join(' ');

export const LookupAnabinInputSchema = z.object({
  institution: z.string().min(1),
});
export type LookupAnabinInput = z.infer<typeof LookupAnabinInputSchema>;

export function makeLookupAnabinTool() {
  return tool({
    description,
    inputSchema: LookupAnabinInputSchema,
    // The SINGLE tool-block cache breakpoint lives here. lookup_anabin is registered
    // LAST in agent-turn.ts, so marking it caches the entire static tools prefix in one
    // breakpoint (Anthropic max is 4; all other tools carry none). Keep it last.
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async execute(input: LookupAnabinInput) {
      const inst = getAnabinInstitutionByName(input.institution);
      if (!inst) {
        return {
          type: 'anabin_result' as const,
          version: 1 as const,
          data: { found: false as const, query: input.institution },
        };
      }
      return {
        type: 'anabin_result' as const,
        version: 1 as const,
        data: {
          found: true as const,
          status: inst.institutionStatus,
          institution: inst.name,
          verifiedByUser: inst.verifiedByUser,
          anabinUrl: inst.anabinUrl ?? null,
          degrees: inst.degrees,
        },
      };
    },
  });
}
