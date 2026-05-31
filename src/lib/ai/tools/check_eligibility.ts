import { tool } from 'ai';
import { z } from 'zod';
import type { Repository } from '@/lib/case/repository';
import type { Profile } from '@/lib/profile/schema';
import { evaluateEligibility } from '@/lib/rules/eligibility';
import { assessReadiness } from '@/lib/rules/eligibility-readiness';
import { summarizeFigures } from '@/lib/rules/eligibility-figures';

const description = [
  'Run the deterministic Blue Card eligibility check against the current case facts.',
  'Call this once employment and education facts are plausibly on file; the tool reports',
  'exactly which facts are still missing if it cannot yet decide, so it is safe to call early.',
  'It reads the current case itself — you pass no arguments.',
  'Present the result by pointing the user at the rendered card; NEVER restate the euro figures',
  'in your prose. The card is the source of truth for numbers.',
].join(' ');

export const CheckEligibilityInputSchema = z.object({});
export type CheckEligibilityInput = z.infer<typeof CheckEligibilityInputSchema>;

export interface CheckEligibilityToolDefaults {
  defaultCaseId: string;
  defaultUserId: string;
  now?: () => Date;
}

export function makeCheckEligibilityTool(
  repo: Pick<Repository, 'loadCase' | 'appendActivity'>,
  defaults: CheckEligibilityToolDefaults,
) {
  const now = defaults.now ?? (() => new Date());
  return tool({
    description,
    inputSchema: CheckEligibilityInputSchema,
    async execute(_input: CheckEligibilityInput) {
      const loaded = await repo.loadCase(defaults.defaultCaseId);
      const facts = loaded.caseFacts;
      const profile: Profile = loaded.profile ?? { schemaVersion: 1 };
      const today = now();

      const verdict = evaluateEligibility(facts, profile, today);

      // Out-of-scope wins over incomplete: a non-Blue-Card visa is a scope refusal,
      // not an eligibility event — no activity row (mirrors the out_of_scope tool).
      if (verdict.outOfScope) {
        return {
          type: 'eligibility_result' as const,
          version: 1 as const,
          data: { status: 'out_of_scope' as const, reason: 'intended visa is not Blue Card' },
        };
      }

      const readiness = assessReadiness(facts);
      if (!readiness.ready) {
        await repo.appendActivity({
          caseId: defaults.defaultCaseId,
          userId: defaults.defaultUserId,
          kind: 'case.eligibility.checked',
          payload: { status: 'incomplete', missing: readiness.missing },
        });
        return {
          type: 'eligibility_result' as const,
          version: 1 as const,
          data: { status: 'incomplete' as const, missing: readiness.missing },
        };
      }

      const figures = summarizeFigures(facts, today);
      await repo.appendActivity({
        caseId: defaults.defaultCaseId,
        userId: defaults.defaultUserId,
        kind: 'case.eligibility.checked',
        // PII rule: codes/paths only — no salary figure in the log.
        payload: { status: 'assessed', routes: verdict.routes, blockers: verdict.blockers },
      });
      return {
        type: 'eligibility_result' as const,
        version: 1 as const,
        data: {
          status: 'assessed' as const,
          qualifies: verdict.qualifies,
          routes: verdict.routes,
          blockers: verdict.blockers,
          warnings: verdict.warnings,
          figures,
          computedAt: verdict.computedAt,
          rulesVersion: verdict.rulesVersion,
        },
      };
    },
  });
}
