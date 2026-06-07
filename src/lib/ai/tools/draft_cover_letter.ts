import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import {
  draftRequestDescription,
  makeDraftRequestTool,
  type DraftRequestInput,
  type DraftRequestToolDefaults,
} from '@/lib/ai/tools/draft_request';

const description = draftRequestDescription(
  'cover_letter',
  'Use this after the case has enough applicant, education, employment, and consulate context to draft without inventing facts.',
);

export type DraftCoverLetterInput = DraftRequestInput;
export type DraftCoverLetterToolDefaults = DraftRequestToolDefaults;

export function makeDraftCoverLetterTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftCoverLetterToolDefaults,
) {
  return makeDraftRequestTool('cover_letter', description, repo, drafts, defaults);
}
