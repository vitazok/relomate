import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { approveDraftCore, rejectDraftCore } from '@/lib/drafting/approval-core';
import * as schema from '@/lib/db/schema';

let handle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({ get db() { return handle.db; } }));

const baseContent = {
  type: 'cover_letter' as const,
  data: {
    title: 'Cover letter',
    recipient: 'German Consulate Bengaluru',
    subject: 'EU Blue Card application',
    paragraphs: ['One', 'Two', 'Three'],
    signoff: 'Sincerely',
  },
};

describe('draft approval core', () => {
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

  function deps() {
    return {
      repo: makeRepository(handle.db, handle.schemaName),
      drafts: makeDraftRepository(handle.db),
      approvals: makeApprovalRepository(handle.db),
    };
  }

  async function readyDraft() {
    const d = deps();
    const draftId = await d.drafts.insert({ caseId, userId, type: 'cover_letter' });
    await d.drafts.setReady(draftId, {
      content: baseContent,
      modelVersion: 'm',
      promptVersion: 'p',
    });
    const approvalId = await d.approvals.createPending({
      caseId,
      userId,
      subjectType: 'draft',
      subjectId: draftId,
    });
    return { draftId, approvalId };
  }

  it('approves edited content, resolves approval, and logs keys only', async () => {
    const { draftId, approvalId } = await readyDraft();
    const edited = { ...baseContent.data, paragraphs: ['One', 'Two changed', 'Three'] };
    const res = await approveDraftCore(deps(), {
      caseId,
      userId,
      draftId,
      content: { type: 'cover_letter', data: edited },
    });
    expect(res.ok).toBe(true);

    const draft = await makeDraftRepository(handle.db).getById(draftId);
    expect(draft?.status).toBe('approved');
    expect(draft?.approvedBy).toBe(userId);

    const approval = await makeApprovalRepository(handle.db).getById(approvalId);
    expect(approval?.status).toBe('approved');
    expect(approval?.decision?.editedPaths).toEqual(['draft.cover_letter.content']);

    const rows = await handle.db
      .select()
      .from(schema.activityLog)
      .where(eq(schema.activityLog.kind, 'case.draft.approved'));
    const serialized = JSON.stringify(rows.map((r) => r.payload));
    expect(serialized).toContain('cover_letter');
    expect(serialized).not.toContain('Two changed');
  });

  it('rejects a pending draft approval', async () => {
    const { draftId, approvalId } = await readyDraft();
    const res = await rejectDraftCore(deps(), {
      caseId,
      userId,
      draftId,
      reason: 'Tone is wrong',
    });
    expect(res.ok).toBe(true);
    expect((await makeDraftRepository(handle.db).getById(draftId))?.status).toBe('rejected');
    const approval = await makeApprovalRepository(handle.db).getById(approvalId);
    expect(approval?.status).toBe('rejected');
    expect(approval?.decision?.rejectedReason).toBe('Tone is wrong');
  });
});
