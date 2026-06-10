import { generateObject } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import {
  AnabinJustificationContentSchema,
  CoverLetterContentSchema,
  CvContentSchema,
  EmployerLetterContentSchema,
  type AnabinJustificationContent,
  type CoverLetterContent,
  type CvContent,
  type DraftContent,
  type DraftType,
  type EmployerLetterContent,
} from '@/lib/drafting/types';

export const COVER_LETTER_PROMPT_VERSION = 'draft_cover_letter/v0';
export const EMPLOYER_LETTER_PROMPT_VERSION = 'draft_employer_letter/v0';
export const CV_PROMPT_VERSION = 'draft_cv/v0';
export const ANABIN_JUSTIFICATION_PROMPT_VERSION = 'draft_anabin_justification/v0';

export interface DraftGeneratorInput {
  caseId: string;
  profile: Profile | null;
  caseFacts: CaseFacts;
  framingInstruction?: string;
}

export interface GeneratedCoverLetter {
  content: CoverLetterContent;
  modelVersion: string;
  promptVersion: string;
}

export interface GeneratedEmployerLetter {
  content: EmployerLetterContent;
  modelVersion: string;
  promptVersion: string;
}

export interface GeneratedCv {
  content: CvContent;
  modelVersion: string;
  promptVersion: string;
}

export interface GeneratedAnabinJustification {
  content: AnabinJustificationContent;
  modelVersion: string;
  promptVersion: string;
}

export interface GeneratedDraft {
  content: DraftContent;
  modelVersion: string;
  promptVersion: string;
}

export interface DraftGenerator {
  generateCoverLetter(input: DraftGeneratorInput): Promise<GeneratedCoverLetter>;
  generateEmployerLetter(input: DraftGeneratorInput): Promise<GeneratedEmployerLetter>;
  generateCv(input: DraftGeneratorInput): Promise<GeneratedCv>;
  generateAnabinJustification(input: DraftGeneratorInput): Promise<GeneratedAnabinJustification>;
}

function baseContext(input: DraftGeneratorInput): string {
  return [
    `Case id: ${input.caseId}`,
    'Profile JSON:',
    JSON.stringify(input.profile ?? { schemaVersion: 1 }, null, 2),
    'Case facts JSON:',
    JSON.stringify(input.caseFacts, null, 2),
  ].join('\n');
}

function framingContext(input: DraftGeneratorInput): string[] {
  const instruction = input.framingInstruction?.trim();
  if (!instruction) return [];
  return [
    'Framing instruction from the reviewer:',
    instruction,
    'Follow the framing instruction only when it is consistent with the facts and hard rules above.',
    '',
  ];
}

function buildCoverLetterPrompt(input: DraftGeneratorInput): string {
  return [
    'Draft a concise English cover letter for an EU Blue Card application at the German consulate in Bengaluru.',
    'Use only the provided profile and case facts. Do not invent names, dates, employers, degrees, salary figures, or document status.',
    'If a detail is missing, use a bracketed placeholder such as [employer address] or write around the missing detail.',
    'Do not quote legal thresholds, fees, processing times, or guarantees. Deterministic rule tools own those figures.',
    'Keep the tone professional, factual, and not legal-advice-like.',
    '',
    ...framingContext(input),
    baseContext(input),
  ].join('\n');
}

function buildEmployerLetterPrompt(input: DraftGeneratorInput): string {
  return [
    'Draft a concise English employer letter template for an EU Blue Card application at the German consulate in Bengaluru.',
    'The employer will print/sign it. Use only the provided profile and case facts.',
    'Do not invent names, dates, addresses, salary figures, contract terms, job duties, or document status.',
    'If an employer-side detail is missing, use a bracketed placeholder such as [employer letterhead address] or [authorized signatory].',
    'Do not quote legal thresholds, fees, processing times, or guarantees. Deterministic rule tools own those figures.',
    'The body should confirm employment offer/current employment, role, work location, start date/contract type if known, and that details should be checked by the employer before signing.',
    '',
    ...framingContext(input),
    baseContext(input),
  ].join('\n');
}

function buildCvPrompt(input: DraftGeneratorInput): string {
  return [
    'Draft a structured English CV for a German consulate EU Blue Card file.',
    'Use a clean reverse-chronological format suitable for printing. Use only the provided profile and case facts.',
    'Do not invent employers, dates, degrees, skills, publications, salary figures, or document status.',
    'If a detail is missing, use a bracketed placeholder or omit it when omission is clearer.',
    'Keep bullets factual and short. Do not include legal conclusions or qualification guarantees.',
    '',
    ...framingContext(input),
    baseContext(input),
  ].join('\n');
}

function buildAnabinJustificationPrompt(input: DraftGeneratorInput): string {
  return [
    'Draft a concise English Anabin recognition justification memo for an EU Blue Card case.',
    'Use this only for Anabin-unknown, missing, or ZAB-statement paths; do not claim H+ or equivalent recognition unless it is explicitly present in the provided facts.',
    'Use only the provided profile and case facts. Do not invent institutions, degrees, dates, recognition statuses, consulate positions, or document status.',
    'If a recognition detail is missing or unknown, say that it is unknown and identify the exact evidence or clarification needed.',
    'Do not quote legal thresholds, fees, processing times, or guarantees. Deterministic rule tools own those figures.',
    'Keep the tone factual and suitable for consultant/reviewer review before any applicant-facing use.',
    '',
    ...framingContext(input),
    baseContext(input),
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
    async generateEmployerLetter(input) {
      const { object } = await generateObject({
        model: anthropic(MODEL_ID),
        schema: EmployerLetterContentSchema,
        messages: [{ role: 'user', content: buildEmployerLetterPrompt(input) }],
      });
      return {
        content: object,
        modelVersion: MODEL_ID,
        promptVersion: EMPLOYER_LETTER_PROMPT_VERSION,
      };
    },
    async generateCv(input) {
      const { object } = await generateObject({
        model: anthropic(MODEL_ID),
        schema: CvContentSchema,
        messages: [{ role: 'user', content: buildCvPrompt(input) }],
      });
      return {
        content: object,
        modelVersion: MODEL_ID,
        promptVersion: CV_PROMPT_VERSION,
      };
    },
    async generateAnabinJustification(input) {
      const { object } = await generateObject({
        model: anthropic(MODEL_ID),
        schema: AnabinJustificationContentSchema,
        messages: [{ role: 'user', content: buildAnabinJustificationPrompt(input) }],
      });
      return {
        content: object,
        modelVersion: MODEL_ID,
        promptVersion: ANABIN_JUSTIFICATION_PROMPT_VERSION,
      };
    },
  };
}

export async function generateDraftByType(
  generator: DraftGenerator,
  type: DraftType,
  input: DraftGeneratorInput,
): Promise<GeneratedDraft> {
  switch (type) {
    case 'cover_letter': {
      const generated = await generator.generateCoverLetter(input);
      return { ...generated, content: { type, data: generated.content } };
    }
    case 'employer_letter': {
      const generated = await generator.generateEmployerLetter(input);
      return { ...generated, content: { type, data: generated.content } };
    }
    case 'cv': {
      const generated = await generator.generateCv(input);
      return { ...generated, content: { type, data: generated.content } };
    }
    case 'anabin_justification': {
      const generated = await generator.generateAnabinJustification(input);
      return { ...generated, content: { type, data: generated.content } };
    }
  }
}
