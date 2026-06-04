import { z } from 'zod';

export const ALLOWED_UPLOAD_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/heic',
  'image/webp',
] as const;

export const ALLOWED_UPLOAD_ACCEPT = ALLOWED_UPLOAD_TYPES.join(',');

export const DocumentStatusEnum = z.enum([
  'pending_upload',
  'uploaded',
  'classifying',
  'extracting',
  'awaiting_confirmation',
  'failed',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusEnum>;

export const ExtractionProviderEnum = z.enum(['reducto', 'anthropic_vision']);
export type ExtractionProviderName = z.infer<typeof ExtractionProviderEnum>;

export const ExtractedFieldSchema = z.object({
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
});

export const ExtractedDataSchema = z.object({
  fields: z.record(z.string(), ExtractedFieldSchema),
  provider: ExtractionProviderEnum,
  modelVersion: z.string(),
  raw: z.unknown().optional(),
});
export type ExtractedData = z.infer<typeof ExtractedDataSchema>;

export const ClassificationSchema = z.object({
  type: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type Classification = z.infer<typeof ClassificationSchema>;
