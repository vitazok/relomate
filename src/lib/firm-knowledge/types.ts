import { z } from 'zod';

export const FirmKnowledgeSourceTypeSchema = z.enum([
  'official_source',
  'firm_playbook',
  'template',
  'prior_approved_example',
  'internal_note',
]);
export type FirmKnowledgeSourceType = z.infer<typeof FirmKnowledgeSourceTypeSchema>;

export const FirmKnowledgeSourceMetadataSchema = z
  .object({
    sourceUrls: z.array(z.string().url()).optional(),
    notes: z.array(z.string()).optional(),
    ownerRole: z.string().optional(),
  })
  .passthrough();
export type FirmKnowledgeSourceMetadata = z.infer<typeof FirmKnowledgeSourceMetadataSchema>;

export const FirmKnowledgeEntryMetadataSchema = z
  .object({
    sourceUrls: z.array(z.string().url()).optional(),
    verifiedByUser: z.boolean().optional(),
    lastCheckedAt: z.string().datetime().optional(),
  })
  .passthrough();
export type FirmKnowledgeEntryMetadata = z.infer<typeof FirmKnowledgeEntryMetadataSchema>;

