import type { CaseFacts } from '@/lib/case/schema';

export interface AgentContext {
  caseFactsJson: string;
}

export async function buildAgentContext(input: {
  caseId: string;
  caseFacts: CaseFacts;
}): Promise<AgentContext> {
  return { caseFactsJson: JSON.stringify(input.caseFacts) };
}
