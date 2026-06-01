import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const url = z.string().url();
const range2 = z.tuple([z.number(), z.number()]);

export const BlueCardThresholdEntry = z.object({
  effectiveFrom: isoDate,
  effectiveUntil: isoDate,
  standard: z.object({
    annualGrossEur: z.number(),
    legalBasis: z.string(),
    pensionCeilingPercent: z.number(),
  }),
  reduced: z.object({
    annualGrossEur: z.number(),
    legalBasis: z.string(),
    pensionCeilingPercent: z.number(),
    appliesTo: z.array(
      z.enum(['shortage_occupation', 'recent_graduate', 'it_specialist_no_degree']),
    ),
  }),
});

export const ShortageIscoEntry = z.object({
  code: z.string(),
  description: z.string(),
});

export const BlueCardRules = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(url),
  lastVerified: isoDate,
  thresholds: z.array(BlueCardThresholdEntry).min(1),
  shortageOccupationsIscoGroups: z.array(ShortageIscoEntry).min(1),
  recentGraduateRule: z.object({
    legalBasis: z.string(),
    maxYearsSinceDegree: z.number().int().positive(),
  }),
  itNoDegreeRule: z.object({
    legalBasis: z.string(),
    iscoGroups: z.array(z.string()).min(1),
    minYearsExperience: z.number().int().positive(),
    experienceWithinLastYears: z.number().int().positive(),
    inForceSince: isoDate,
  }),
  federalEmploymentAgencyApproval: z.object({
    notRequiredIfSalaryAtLeast: z.number(),
    requiredFor: z.array(z.string()).min(1),
    typicalDelayWeeks: range2,
  }),
  generalRequirements: z.object({
    minContractDurationMonths: z.number().int().positive(),
    jobMustMatchQualification: z.boolean(),
  }),
  permanentResidencyPath: z.object({
    withB1German: z.object({
      monthsRequired: z.number().int().positive(),
      legalBasis: z.string(),
    }),
    withoutB1German: z.object({
      monthsRequired: z.number().int().positive(),
      note: z.string(),
    }),
  }),
  contractValidityCoverage: z.object({
    durationMonths: z.number().int().positive(),
    fallback: z.string(),
  }),
});

export const FamilyRules = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(url),
  lastVerified: isoDate,
  blueCardSpouse: z.object({
    legalBasis: z.array(z.string()).min(1),
    germanLanguageRequirement: z.literal('none'),
    workAuthorization: z.literal('full_unrestricted_from_day_one'),
    waitingPeriodMonths: z.number().int().nonnegative(),
    marriageBeforeBlueCardRequired: z.boolean(),
    minimumAge: z.number().int().positive(),
    proofOfAccommodationRequired: z.boolean(),
    proofOfSubsistenceRequired: z.boolean(),
  }),
  blueCardChildrenUnder18: z.object({
    legalBasis: z.string(),
    bothParentsRightOfCustodyRequired: z.boolean(),
    maxAge: z.number().int().positive(),
    germanLanguageRequirement: z.literal('none'),
  }),
  parents: z.object({
    legalBasis: z.string(),
    generalRule: z.literal('not_eligible_under_blue_card'),
    exception: z.string(),
    note: z.string(),
  }),
  documentsRequired: z.array(z.string()).min(1),
});

export const ConsulateRules = z.object({
  officialName: z.string(),
  url: url,
  jurisdictionStates: z.array(z.string()).min(1),
  appointmentBookingPartner: z.string(),
  visaFeeEur: z.number(),
  visaFeePaymentMethod: z.string(),
  documentSetsRequired: z.number().int().positive(),
  biometricPhotos: z.object({
    count: z.number().int().positive(),
    sizeRequirement: z.string(),
    maxAgeMonths: z.number().int().positive(),
    spec: z.string(),
  }),
  applicationForm: z.string(),
  noStapling: z.boolean(),
  documentLanguages: z.array(z.string()).min(1),
  translationRequired: z.boolean(),
  contactPhone: z.string(),
  visaServiceHotline: z.string(),
  passportRequirements: z.object({
    minRemainingValidityMonths: z.number().int().positive(),
    maxAgeYears: z.number().int().positive(),
    minBlankPages: z.number().int().nonnegative(),
  }),
  indianApplicantSpecific: z.object({
    distanceLearningClarificationRequired: z.boolean(),
    markSheetsAllSemestersRequired: z.boolean(),
    marriageCertificateNeedsApostille: z.boolean(),
    birthCertificateNeedsApostille: z.boolean(),
  }),
});

export const ConsulatesFile = z.object({
  schemaVersion: z.literal(1),
  lastVerified: isoDate,
  bengaluru: ConsulateRules,
});

const ApostilleStep = z.object({
  step: z.number().int().positive(),
  action: z.string(),
  typicalDurationDays: range2,
});

const ApostilleEducationalStep = ApostilleStep.extend({
  stateAuthorityForKarnataka: z.string().optional(),
  authority: z.string().optional(),
  bengaluruRpo: z.boolean().optional(),
  directSubmission: z.boolean().optional(),
  authorizedAgencyServiceFeeInr: z.number().optional(),
  scanningFeeInrPerPage: z.number().optional(),
  stampFeeInr: z.number().optional(),
  typicalCostInr: range2.optional(),
});

export const ApostilleRules = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(url),
  lastVerified: isoDate,
  india: z.object({
    hagueConventionMember: z.boolean(),
    memberSince: isoDate,
    apostilleAccepted: z.boolean(),
    embassyLegalizationRequired: z.boolean(),
    educationalDocumentsFlow: z.array(ApostilleEducationalStep).min(1),
    personalDocumentsFlow: z.array(ApostilleStep).min(1),
    totalEducationalDurationWeeks: range2,
    totalPersonalDurationWeeks: range2,
    recommendedStartTiming: z.string(),
    rationale: z.string(),
  }),
});

export const ShortageMapping = z.object({
  keywords: z.array(z.string()).min(1),
  isco: z.string(),
  iscoGroup: z.string(),
  isShortageOccupation: z.boolean(),
});

export const ShortageOccupationsRules = z.object({
  schemaVersion: z.literal(1),
  mappings: z.array(ShortageMapping).min(1),
});

export const AnabinDegreeEntry = z.object({
  level: z.string(),
  field: z.string(),
  rating: z.enum(['entspricht', 'gleichwertig', 'nicht entspricht']),
});

export const AnabinInstitution = z.object({
  id: z.string(),
  name: z.string(),
  country: z.string().length(2),
  institutionStatus: z.enum(['H+', 'H+/-', 'H-', 'unknown']),
  verifiedByUser: z.boolean(),
  note: z.string().optional(),
  anabinUrl: z.string().url().optional(),
  degrees: z.array(AnabinDegreeEntry),
});

export const AnabinSeed = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(url),
  lastVerified: isoDate,
  institutions: z.array(AnabinInstitution).min(1),
});

export const RouteId = z.enum([
  'standard',
  'shortage_occupation',
  'recent_graduate',
  'it_no_degree',
]);

export const DocumentApplicableTo = z.enum(['applicant', 'spouse', 'child', 'all']);

export const DocumentSectionId = z.enum([
  'identity',
  'employment',
  'qualifications',
  'family',
  'other',
]);

export const DocumentCondition = z.object({
  path: z.string(),
  in: z.array(z.string()).min(1).optional(),
  equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const DocumentItem = z.object({
  id: z.string(),
  section: DocumentSectionId,
  label: z.string(),
  details: z.string(),
  applicableTo: DocumentApplicableTo,
  copies: z.number().int().positive(),
  translationRequired: z.boolean(),
  apostilleRequired: z.boolean(),
  sourceUrl: url,
  routes: z.array(RouteId).nullable().default(null),
  condition: DocumentCondition.optional(),
});

export const DocumentSection = z.object({
  title: z.string(),
});

export const DocumentRules = z.object({
  schemaVersion: z.literal(1),
  sources: z.array(url),
  lastVerified: isoDate,
  sections: z.record(DocumentSectionId, DocumentSection),
  items: z.array(DocumentItem).min(1),
  familyItems: z.object({
    spouse: z.array(DocumentItem).min(1),
    child: z.array(DocumentItem).min(1),
  }),
});

export type BlueCardRules = z.infer<typeof BlueCardRules>;
export type FamilyRules = z.infer<typeof FamilyRules>;
export type ConsulateRules = z.infer<typeof ConsulateRules>;
export type ConsulatesFile = z.infer<typeof ConsulatesFile>;
export type ApostilleRules = z.infer<typeof ApostilleRules>;
export type ShortageOccupationsRules = z.infer<typeof ShortageOccupationsRules>;
export type ShortageMapping = z.infer<typeof ShortageMapping>;
export type AnabinSeed = z.infer<typeof AnabinSeed>;
export type AnabinInstitution = z.infer<typeof AnabinInstitution>;
export type RouteId = z.infer<typeof RouteId>;
export type DocumentApplicableTo = z.infer<typeof DocumentApplicableTo>;
export type DocumentSectionId = z.infer<typeof DocumentSectionId>;
export type DocumentCondition = z.infer<typeof DocumentCondition>;
export type DocumentItem = z.infer<typeof DocumentItem>;
export type DocumentRules = z.infer<typeof DocumentRules>;
