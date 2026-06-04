import { describe, it, expect } from 'vitest';
import { makeRequestDocumentUploadTool, RequestDocumentUploadInputSchema } from '@/lib/ai/tools/request_document_upload';

describe('request_document_upload tool', () => {
  it('returns a document_upload_request output for a known spine id', async () => {
    const tool = makeRequestDocumentUploadTool();
    const out = await tool.execute!({ spineItemId: 'passport' }, {} as never);
    expect(out).toEqual({
      type: 'document_upload_request',
      version: 1,
      data: { spineItemId: 'passport', label: 'Valid passport', accept: expect.any(String) },
    });
  });

  it('handles no spine id (generic upload prompt)', async () => {
    const tool = makeRequestDocumentUploadTool();
    const out = (await tool.execute!({}, {} as never)) as {
      data: { spineItemId: string | null; label: string };
    };
    expect(out.data.spineItemId).toBeNull();
    expect(out.data.label).toBeTruthy();
  });

  it('falls back to a generic prompt for an unknown spine id', async () => {
    const tool = makeRequestDocumentUploadTool();
    const out = (await tool.execute!({ spineItemId: 'not-a-real-id' }, {} as never)) as {
      data: { spineItemId: string | null; label: string };
    };
    expect(out.data.spineItemId).toBeNull();
    expect(out.data.label).toBe('Upload a document');
  });

  it('validates input schema', () => {
    expect(RequestDocumentUploadInputSchema.safeParse({ spineItemId: 'passport' }).success).toBe(true);
    expect(RequestDocumentUploadInputSchema.safeParse({}).success).toBe(true);
  });
});
