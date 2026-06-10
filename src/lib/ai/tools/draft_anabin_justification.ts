import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import {
  draftRequestDescription,
  makeDraftRequestTool,
  type DraftRequestInput,
  type DraftRequestToolDefaults,
} from '@/lib/ai/tools/draft_request';

const description = draftRequestDescription(
  'anabin_justification',
  'Use this after an Anabin lookup leaves the institution or degree recognition unknown, unrated, not found, or likely to need ZAB/consulate clarification; the draft must preserve uncertainty instead of asserting recognition.',
);

export type DraftAnabinJustificationInput = DraftRequestInput;
export type DraftAnabinJustificationToolDefaults = DraftRequestToolDefaults;

export function makeDraftAnabinJustificationTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftAnabinJustificationToolDefaults,
) {
  return makeDraftRequestTool('anabin_justification', description, repo, drafts, defaults);
}
