import { z } from 'zod';

export const ProvenanceSourceEnum = z.enum([
  'user_stated',
  'inferred',
  'document',
  'user_corrected',
  'system',
]);
export type ProvenanceSource = z.infer<typeof ProvenanceSourceEnum>;

const provenanceShape = {
  source: ProvenanceSourceEnum,
  sourceTurnId: z.string().uuid().nullable(),
  confidence: z.number().min(0).max(1),
  updatedAt: z.string().datetime(),
};

export const FieldSchema = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    value: inner.nullable(),
    ...provenanceShape,
  });

export const ArrayFieldSchema = <T extends z.ZodTypeAny>(element: T) =>
  z.object({
    value: z.array(element).default([]),
    ...provenanceShape,
  });

export const EligibilityVerdictSchema = z.object({
  outOfScope: z.boolean(),
  qualifies: z.boolean().nullable(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  routes: z.array(z.enum(['standard', 'shortage_occupation', 'recent_graduate', 'it_no_degree'])),
  computedAt: z.string().datetime(),
  rulesVersion: z.string(),
});
export type EligibilityVerdict = z.infer<typeof EligibilityVerdictSchema>;
