import { tool } from 'ai';
import {
  UpdateCaseInputSchemaForLLM,
  type UpdateCaseInputForLLM,
  type UpdateCaseResult,
} from '@/lib/case/types';
import { formatLeafPathCatalog } from '@/lib/case/paths';
import type { Repository } from '@/lib/case/repository';

const description = [
  'Persist one or more leaf-level updates to the case facts or user profile.',
  'Updates is a flat object whose keys are dotted paths into the case/profile tree.',
  'Use EXACTLY one of the valid paths listed below — any other key makes the whole call fail.',
  'For an enum path, pass one of its listed values verbatim.',
  'All updates in one call share a single source/confidence.',
  'Returns the list of updated paths and any contradictions detected against existing values.',
  'NEVER pass year-specific thresholds, fees, or processing times via this tool.',
  'NEVER fabricate paths — if a fact has no matching path, ask the user instead of guessing.',
  '\n\nValid paths:\n' + formatLeafPathCatalog(),
].join(' ');

export interface UpdateCaseToolDefaults {
  defaultCaseId: string;
  defaultSourceTurnId: string;
}

export function makeUpdateCaseTool(
  repo: Pick<Repository, 'applyUpdate'>,
  defaults: UpdateCaseToolDefaults,
) {
  return tool({
    description,
    inputSchema: UpdateCaseInputSchemaForLLM,
    async execute(input: UpdateCaseInputForLLM) {
      const result: UpdateCaseResult = await repo.applyUpdate({
        ...input,
        caseId: defaults.defaultCaseId,
        sourceTurnId: defaults.defaultSourceTurnId,
      });
      return {
        type: 'update_case_result' as const,
        version: 1 as const,
        data: result,
      };
    },
  });
}
