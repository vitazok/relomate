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

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ContractType = z.enum(['permanent', 'fixed_term']);
const MaritalStatus = z.enum([
  'single',
  'married',
  'partnership',
  'engaged_marrying_in_germany',
  'divorced',
  'widowed',
]);
const DegreeLevel = z.enum([
  'bachelor_eqf6',
  'master_eqf7',
  'phd_eqf8',
  'tertiary_3yr_eqf6_equivalent',
  'vocational_non_eqf6',
  'other',
]);
const ModeOfStudy = z.enum(['regular', 'distance', 'online']);
const AnabinInstitutionStatus = z.enum(['H+', 'H+/-', 'H-', 'unknown']);
// Widened beyond 'blue_card' so a non-Blue-Card intent can be PERSISTED via update_case and
// the eligibility engine can genuinely flag the case out_of_scope (the engine is the sole
// setter of the verdict's outOfScope flag). MVP only ASSESSES blue_card; the other values
// exist solely to record an out-of-scope intent the agent should decline to evaluate.
const IntendedVisa = z.enum([
  'blue_card',
  'student',
  'job_seeker',
  'family_reunion',
  'asylum',
  'other',
]);
const Consulate = z.enum(['bengaluru', 'toronto']);

const Optional = <T extends z.ZodTypeAny>(inner: T) => FieldSchema(inner).optional();

export const CaseFactsSchema = z.object({
  employment: z
    .object({
      employerName: Optional(z.string()),
      employerCity: Optional(z.string()),
      jobTitle: Optional(z.string()),
      iscoCode: Optional(z.string()),
      annualGrossSalaryEur: Optional(z.number().positive()),
      contractType: Optional(ContractType),
      contractStartDate: Optional(IsoDate),
      priorExperienceYears: Optional(z.number().min(0)),
    })
    .optional(),
  education: z
    .object({
      highestDegree: Optional(DegreeLevel),
      fieldOfStudy: Optional(z.string()),
      institution: Optional(z.string()),
      completionYear: Optional(z.number().int()),
      anabinStatus: Optional(AnabinInstitutionStatus),
      modeOfStudy: Optional(ModeOfStudy),
    })
    .optional(),
  family: z
    .object({
      maritalStatus: Optional(MaritalStatus),
      spousePresent: Optional(z.boolean()),
      childrenCount: Optional(z.number().int().min(0)),
    })
    .optional(),
  target: z
    .object({
      intendedVisa: Optional(IntendedVisa),
      targetConsulate: Optional(Consulate),
      targetMoveDate: Optional(IsoDate),
    })
    .optional(),
});
export type CaseFacts = z.infer<typeof CaseFactsSchema>;
