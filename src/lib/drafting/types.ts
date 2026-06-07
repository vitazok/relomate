import { z } from 'zod';

export const DraftTypeEnum = z.enum(['cover_letter']);
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

export const DraftContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cover_letter'),
    data: CoverLetterContentSchema,
  }),
]);
export type DraftContent = z.infer<typeof DraftContentSchema>;

export const DraftRequestResultSchema = z.object({
  draftId: z.string().uuid(),
  caseId: z.string().uuid(),
  draftType: DraftTypeEnum,
  status: DraftStatusEnum,
});
export type DraftRequestResult = z.infer<typeof DraftRequestResultSchema>;
