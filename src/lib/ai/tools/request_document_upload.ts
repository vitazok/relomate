import { tool } from 'ai';
import { z } from 'zod';
import { getDocumentSpine } from '@/lib/extraction/schema';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/heic,image/webp';

const description = [
  'Ask the user to upload a document so it can be read and added to their case.',
  'Pass the `spineItemId` (e.g. "passport") when you know which document you need;',
  'omit it for a generic upload prompt. This renders an upload control in the chat;',
  'it does NOT itself read or store anything — extraction happens after the user uploads.',
].join(' ');

export const RequestDocumentUploadInputSchema = z.object({
  spineItemId: z.string().optional(),
});
export type RequestDocumentUploadInput = z.infer<typeof RequestDocumentUploadInputSchema>;

export function makeRequestDocumentUploadTool() {
  return tool({
    description,
    inputSchema: RequestDocumentUploadInputSchema,
    async execute(input: RequestDocumentUploadInput) {
      const spine = getDocumentSpine();
      const match = input.spineItemId ? spine.find((s) => s.id === input.spineItemId) : undefined;
      return {
        type: 'document_upload_request' as const,
        version: 1 as const,
        data: {
          spineItemId: match?.id ?? null,
          label: match?.label ?? 'Upload a document',
          accept: ACCEPT,
        },
      };
    },
  });
}
