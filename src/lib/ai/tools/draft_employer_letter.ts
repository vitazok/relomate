import type { Repository } from '@/lib/case/repository';
import type { DraftRepository } from '@/lib/drafting/repository';
import {
  draftRequestDescription,
  makeDraftRequestTool,
  type DraftRequestInput,
  type DraftRequestToolDefaults,
} from '@/lib/ai/tools/draft_request';

const description = draftRequestDescription(
  'employer_letter',
  'Use this after employer name, role, work location, contract start/context, and applicant identity are plausibly on file; missing employer letterhead/signatory details will be left as placeholders.',
);

export type DraftEmployerLetterInput = DraftRequestInput;
export type DraftEmployerLetterToolDefaults = DraftRequestToolDefaults;

export function makeDraftEmployerLetterTool(
  repo: Pick<Repository, 'appendActivity'>,
  drafts: Pick<DraftRepository, 'insert'>,
  defaults: DraftEmployerLetterToolDefaults,
) {
  return makeDraftRequestTool('employer_letter', description, repo, drafts, defaults);
}
