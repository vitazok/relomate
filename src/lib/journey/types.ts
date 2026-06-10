import { z } from 'zod';
import { DraftTypeEnum } from '@/lib/drafting/types';
import { RouteId } from '@/lib/rules/types';

// ---- Manifest (config/rules/journey.yaml) ----

export const JourneyStep = z.object({
  id: z.string(),
  label: z.string(),
  paths: z.array(z.string()).min(1),
  cite: z.string().nullable().default(null),
});

export const DraftRequiredWhen = z
  .object({
    blockersAny: z.array(z.string()).min(1).optional(),
    warningsAny: z.array(z.string()).min(1).optional(),
  })
  .refine((c) => c.blockersAny !== undefined || c.warningsAny !== undefined, {
    message: 'requiredWhen must specify blockersAny or warningsAny',
  });

export const JourneyDraftRequirement = z.object({
  type: DraftTypeEnum,
  label: z.string(),
  routes: z.array(RouteId).nullable().default(null),
  requiredWhen: DraftRequiredWhen.optional(),
});

export const JourneyPhase = z.object({
  id: z.enum(['eligibility', 'documents', 'drafts', 'package']),
  label: z.string(),
  locked: z.boolean().default(false),
  headline: z.enum(['verdict', 'none']).default('none'),
  source: z.enum(['steps', 'documents', 'drafts']).default('steps'),
  comingSoon: z.string().nullable().default(null),
  steps: z.array(JourneyStep).default([]),
  draftRequirements: z.array(JourneyDraftRequirement).default([]),
});

export const JourneyManifest = z.object({
  schemaVersion: z.literal(1),
  phases: z.array(JourneyPhase).min(1),
});

export type JourneyStep = z.infer<typeof JourneyStep>;
export type DraftRequiredWhen = z.infer<typeof DraftRequiredWhen>;
export type JourneyDraftRequirement = z.infer<typeof JourneyDraftRequirement>;
export type JourneyPhase = z.infer<typeof JourneyPhase>;
export type JourneyManifest = z.infer<typeof JourneyManifest>;

// ---- Computed projection (computeJourneyProgress output) ----

export const RequirementCitation = z.object({
  explainer: z.string(),
  legalBasis: z.string().nullable(),
  sourceUrl: z.string(),
  lastVerified: z.string(),
});

export const AnswerProvenance = z.object({
  label: z.string(),
  updatedAt: z.string().nullable(),
});

export const DocumentProgress = z.object({
  id: z.string(),
  fileName: z.string(),
  status: z.enum([
    'pending_upload',
    'uploaded',
    'classifying',
    'extracting',
    'awaiting_confirmation',
    'confirmed',
    'rejected',
    'failed',
  ]),
  reviewHref: z.string().nullable(),
});

export const DraftProgress = z.object({
  id: z.string(),
  type: z.enum(['cover_letter', 'employer_letter', 'cv', 'anabin_justification']),
  status: z.enum(['drafting', 'ready_for_review', 'approved', 'rejected', 'failed']),
  reviewHref: z.string().nullable(),
});

export const StepProgress = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(['complete', 'incomplete']),
  value: z.string().nullable(),
  group: z.string().nullable(),
  requirementCitation: RequirementCitation.nullable(),
  answerProvenance: AnswerProvenance.nullable(),
  document: DocumentProgress.nullable(),
  draft: DraftProgress.nullable(),
  action: z
    .object({ kind: z.literal('upload'), enabled: z.boolean(), spineItemId: z.string() })
    .nullable(),
});

export const PhaseProgress = z.object({
  id: z.enum(['eligibility', 'documents', 'drafts', 'package']),
  label: z.string(),
  status: z.enum(['done', 'active', 'todo', 'locked']),
  completed: z.number().int(),
  total: z.number().int(),
  comingSoon: z.string().nullable(),
  steps: z.array(StepProgress),
});

export const JourneyProgress = z.object({
  phases: z.array(PhaseProgress),
  overallPct: z.number().int().min(0).max(100),
});

export type RequirementCitation = z.infer<typeof RequirementCitation>;
export type AnswerProvenance = z.infer<typeof AnswerProvenance>;
export type DocumentProgress = z.infer<typeof DocumentProgress>;
export type DraftProgress = z.infer<typeof DraftProgress>;
export type StepProgress = z.infer<typeof StepProgress>;
export type PhaseProgress = z.infer<typeof PhaseProgress>;
export type JourneyProgress = z.infer<typeof JourneyProgress>;
