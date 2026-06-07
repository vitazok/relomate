import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import {
  draftRequestDescription,
  makeDraftRequestTool,
  type DraftRequestInput,
  type DraftRequestToolDefaults,
} from '@/lib/ai/tools/draft_request';

const description = draftRequestDescription(
  'cv',
  'Use this after the case has enough applicant identity, education, employment, and experience context to produce a useful structured CV without inventing facts.',
);

export type DraftCvInput = DraftRequestInput;
export type DraftCvToolDefaults = DraftRequestToolDefaults;

export function makeDraftCvTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftCvToolDefaults,
) {
  return makeDraftRequestTool('cv', description, repo, drafts, defaults);
}
