import { generateObject } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import {
  CoverLetterContentSchema,
  type CoverLetterContent,
} from '@/lib/drafting/types';

export const COVER_LETTER_PROMPT_VERSION = 'draft_cover_letter/v0';

export interface DraftGeneratorInput {
  caseId: string;
  profile: Profile | null;
  caseFacts: CaseFacts;
}

export interface GeneratedCoverLetter {
  content: CoverLetterContent;
  modelVersion: string;
  promptVersion: string;
}

export interface DraftGenerator {
  generateCoverLetter(input: DraftGeneratorInput): Promise<GeneratedCoverLetter>;
}

function buildCoverLetterPrompt(input: DraftGeneratorInput): string {
  return [
    'Draft a concise English cover letter for an EU Blue Card application at the German consulate in Bengaluru.',
    'Use only the provided profile and case facts. Do not invent names, dates, employers, degrees, salary figures, or document status.',
    'If a detail is missing, use a bracketed placeholder such as [employer address] or write around the missing detail.',
    'Do not quote legal thresholds, fees, processing times, or guarantees. Deterministic rule tools own those figures.',
    'Keep the tone professional, factual, and not legal-advice-like.',
    '',
    `Case id: ${input.caseId}`,
    'Profile JSON:',
    JSON.stringify(input.profile ?? { schemaVersion: 1 }, null, 2),
    'Case facts JSON:',
    JSON.stringify(input.caseFacts, null, 2),
  ].join('\n');
}

export function makeAiDraftGenerator(): DraftGenerator {
  return {
    async generateCoverLetter(input) {
      const { object } = await generateObject({
        model: anthropic(MODEL_ID),
        schema: CoverLetterContentSchema,
        messages: [{ role: 'user', content: buildCoverLetterPrompt(input) }],
      });
      return {
        content: object,
        modelVersion: MODEL_ID,
        promptVersion: COVER_LETTER_PROMPT_VERSION,
      };
    },
  };
}
