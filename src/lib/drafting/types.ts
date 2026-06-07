import { z } from 'zod';

export const DraftTypeEnum = z.enum(['cover_letter', 'employer_letter', 'cv']);
export type DraftType = z.infer<typeof DraftTypeEnum>;

export const DraftStatusEnum = z.enum([
  'drafting',
  'ready_for_review',
  'approved',
  'rejected',
  'failed',
]);
export type DraftStatus = z.infer<typeof DraftStatusEnum>;

export const CoverLetterContentSchema = z.object({
  title: z.string().min(1),
  recipient: z.string().min(1),
  subject: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(3).max(8),
  signoff: z.string().min(1),
});
export type CoverLetterContent = z.infer<typeof CoverLetterContentSchema>;

export const EmployerLetterContentSchema = z.object({
  title: z.string().min(1),
  employerAddress: z.string().min(1),
  recipient: z.string().min(1),
  subject: z.string().min(1),
  paragraphs: z.array(z.string().min(1)).min(3).max(8),
  signatureBlock: z.string().min(1),
  employerInstructions: z.array(z.string().min(1)).min(1).max(6),
});
export type EmployerLetterContent = z.infer<typeof EmployerLetterContentSchema>;

export const CvEntrySchema = z.object({
  label: z.string().min(1),
  organization: z.string().nullable(),
  location: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  bullets: z.array(z.string().min(1)).min(1).max(6),
});
export type CvEntry = z.infer<typeof CvEntrySchema>;

export const CvSectionSchema = z.object({
  heading: z.string().min(1),
  entries: z.array(CvEntrySchema).min(1).max(8),
});
export type CvSection = z.infer<typeof CvSectionSchema>;

export const CvContentSchema = z.object({
  title: z.string().min(1),
  personalDetails: z.array(z.string().min(1)).min(1).max(10),
  profile: z.string().min(1),
  sections: z.array(CvSectionSchema).min(2).max(8),
});
export type CvContent = z.infer<typeof CvContentSchema>;

export const DraftContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cover_letter'),
    data: CoverLetterContentSchema,
  }),
  z.object({
    type: z.literal('employer_letter'),
    data: EmployerLetterContentSchema,
  }),
  z.object({
    type: z.literal('cv'),
    data: CvContentSchema,
  }),
]);
export type DraftContent = z.infer<typeof DraftContentSchema>;

export const DRAFT_TYPE_LABELS: Record<DraftType, string> = {
  cover_letter: 'Cover letter',
  employer_letter: 'Employer letter',
  cv: 'CV',
};

export const DraftRequestResultSchema = z.object({
  draftId: z.string().uuid(),
  caseId: z.string().uuid(),
  draftType: DraftTypeEnum,
  status: DraftStatusEnum,
});
export type DraftRequestResult = z.infer<typeof DraftRequestResultSchema>;
