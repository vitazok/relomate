import type { CaseFacts } from '@/lib/case/schema';
import { formatLeafPathCatalog } from '@/lib/case/paths';

export interface AgentContext {
  systemContext: string;
}

const SECTIONS = ['employment', 'education', 'family', 'target'] as const;

function sectionSummary(caseFacts: CaseFacts): string {
  return SECTIONS.map((s) => {
    const subtree = (caseFacts as Record<string, unknown>)[s] as Record<string, unknown> | undefined;
    const hasData = !!subtree && Object.keys(subtree).length > 0;
    return `${s}: ${hasData ? 'known' : 'not yet provided'}`;
  }).join(', ');
}

export async function buildAgentContext(input: {
  caseId: string;
  caseFacts: CaseFacts;
}): Promise<AgentContext> {
  const summary = sectionSummary(input.caseFacts);
  const factsJson = JSON.stringify(input.caseFacts, null, 2);
  const systemContext = [
    '## Current case state',
    '',
    `Sections — ${summary}.`,
    '',
    'Full case facts (each leaf carries value + provenance):',
    '```json',
    factsJson,
    '```',
    '',
    '## Valid update_case paths',
    '',
    'When you call update_case, use EXACTLY these dotted paths. Do NOT invent or',
    'rephrase a path — an unknown path makes the whole call fail. For enum leaves,',
    'pass one of the listed values verbatim.',
    '',
    formatLeafPathCatalog(),
  ].join('\n');
  return { systemContext };
}
