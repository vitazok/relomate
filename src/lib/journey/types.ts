import { z } from 'zod';

// ---- Manifest (config/rules/journey.yaml) ----

export const JourneyStep = z.object({
  id: z.string(),
  label: z.string(),
  paths: z.array(z.string()).min(1),
  cite: z.string().nullable().default(null),
});

export const JourneyPhase = z.object({
  id: z.enum(['eligibility', 'documents', 'drafts', 'package']),
  label: z.string(),
  locked: z.boolean().default(false),
  headline: z.enum(['verdict', 'none']).default('none'),
  source: z.enum(['steps', 'documents']).default('steps'),
  comingSoon: z.string().nullable().default(null),
  steps: z.array(JourneyStep).default([]),
});

export const JourneyManifest = z.object({
  schemaVersion: z.literal(1),
  phases: z.array(JourneyPhase).min(1),
});

export type JourneyStep = z.infer<typeof JourneyStep>;
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

export const StepProgress = z.object({
  id: z.string(),
  label: z.string(),
  state: z.enum(['complete', 'incomplete']),
  value: z.string().nullable(),
  group: z.string().nullable(),
  requirementCitation: RequirementCitation.nullable(),
  answerProvenance: AnswerProvenance.nullable(),
  document: DocumentProgress.nullable(),
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
export type StepProgress = z.infer<typeof StepProgress>;
export type PhaseProgress = z.infer<typeof PhaseProgress>;
export type JourneyProgress = z.infer<typeof JourneyProgress>;
