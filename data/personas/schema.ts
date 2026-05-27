import { z } from 'zod';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso2 = z.string().length(2);

const PersonaProfileSchema = z.object({
  fullName: z.string(),
  dateOfBirth: IsoDate,
  nationality: Iso2,
  passportNumber: z.string(),
  passportExpiry: IsoDate,
  currentAddress: z
    .object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string().optional(),
      country: Iso2,
      postalCode: z.string(),
    })
    .optional(),
});

const PersonaEducationSchema = z
  .object({
    highestDegree: z.string().nullable(),
    fieldOfStudy: z.string().nullable(),
    institution: z.string().nullable(),
    completionYear: z.number().int().nullable(),
    anabinStatus: z.enum(['H+', 'H+/-', 'H-', 'unknown']).nullable(),
    modeOfStudy: z.enum(['regular', 'distance', 'online', 'full_time']).nullable(),
  })
  .partial()
  .optional();

const PersonaEmploymentSchema = z
  .object({
    employerName: z.string(),
    employerCity: z.string(),
    jobTitle: z.string(),
    iscoCode: z.string(),
    annualGrossSalaryEur: z.number(),
    contractType: z.enum(['permanent', 'fixed_term']),
    contractStartDate: z.string(),
    priorExperienceYears: z.number().nullable(),
  })
  .partial()
  .optional();

const PersonaFamilySchema = z
  .object({
    maritalStatus: z.string(),
    spouse: z.unknown().nullable().optional(),
    children: z.array(z.unknown()).optional(),
  })
  .passthrough()
  .optional();

const PersonaTargetSchema = z
  .object({
    consulate: z.string(),
    moveDate: IsoDate.nullable(),
    visaType: z.string(),
  })
  .partial()
  .optional();

const PersonaCaseFactsSchema = z
  .object({
    education: PersonaEducationSchema,
    employment: PersonaEmploymentSchema,
    family: PersonaFamilySchema,
    target: PersonaTargetSchema,
  })
  .passthrough();

export const PersonaExpectedSchema = z.object({
  outOfScope: z.boolean().optional(),
  eligible: z.boolean().optional(),
  route: z.string().nullable().optional(),
  blockers: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
  reason: z.string().nullable().optional(),
});

export const PersonaSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string(),
  profile: PersonaProfileSchema,
  caseFacts: PersonaCaseFactsSchema,
  expected: PersonaExpectedSchema,
});

export type Persona = z.infer<typeof PersonaSchema>;
