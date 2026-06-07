import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import * as schema from '@/lib/db/schema';

let handle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return handle.db; } }));

const step = { run: <T>(_id: string, fn: () => Promise<T>) => fn() };

describe('generateDraft handler', () => {
  let caseId: string;
  let userId: string;

  beforeAll(async () => {
    handle = await createTestSchema();
    userId = (await seedAnonUser(handle)).userId;
    caseId = (await makeRepository(handle.db, handle.schemaName)
      .createCase({ userId, visaType: 'blue_card', targetCountry: 'DE' })).caseId;
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it('generates cover letter content, creates approval, and logs safe metadata', async () => {
    const { generateDraftHandler } = await import('@/lib/inngest/functions/generate-draft');
    const drafts = makeDraftRepository(handle.db);
    const draftId = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    const generator = {
      generateCoverLetter: vi.fn().mockResolvedValue({
        content: {
          title: 'Cover letter',
          recipient: 'German Consulate Bengaluru',
          subject: 'EU Blue Card application',
          paragraphs: ['One', 'Two', 'Three'],
          signoff: 'Sincerely',
        },
        modelVersion: 'm',
        promptVersion: 'p',
      }),
    };

    await generateDraftHandler({
      event: { name: 'draft.requested', data: { draftId, caseId, userId } },
      step,
      deps: { generator },
    });

    const draft = await drafts.getById(draftId);
    expect(draft?.status).toBe('ready_for_review');
    expect(draft?.content?.type).toBe('cover_letter');
    expect(await makeApprovalRepository(handle.db).getBySubject('draft', draftId)).toMatchObject({
      status: 'pending',
      caseId,
    });

    const rows = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.kind, 'case.draft.ready_for_review'));
    const serialized = JSON.stringify(rows.map((r) => r.payload));
    expect(serialized).toContain(draftId);
    expect(serialized).not.toContain('German Consulate Bengaluru');
  });

  it('marks failed when generation throws', async () => {
    const { generateDraftHandler } = await import('@/lib/inngest/functions/generate-draft');
    const drafts = makeDraftRepository(handle.db);
    const draftId = await drafts.insert({ caseId, userId, type: 'cover_letter' });

    await generateDraftHandler({
      event: { name: 'draft.requested', data: { draftId, caseId, userId } },
      step,
      deps: {
        generator: {
          generateCoverLetter: vi.fn().mockRejectedValue(new Error('model down')),
        },
      },
    });

    const draft = await drafts.getById(draftId);
    expect(draft?.status).toBe('failed');
    expect(draft?.error).toMatch(/model down/);
  });
});
