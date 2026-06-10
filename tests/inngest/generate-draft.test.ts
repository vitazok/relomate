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

function mockGenerator(overrides: Record<string, unknown> = {}) {
  return {
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
    generateEmployerLetter: vi.fn().mockResolvedValue({
      content: {
        title: 'Employer letter',
        employerAddress: '[employer letterhead address]',
        recipient: 'German Consulate Bengaluru',
        subject: 'Employment confirmation',
        paragraphs: ['One', 'Two', 'Three'],
        signatureBlock: '[authorized signatory]',
        employerInstructions: ['Check all facts before signing.'],
      },
      modelVersion: 'm',
      promptVersion: 'p',
    }),
    generateCv: vi.fn().mockResolvedValue({
      content: {
        title: 'Curriculum Vitae',
        personalDetails: ['[full name]'],
        profile: 'Skilled professional.',
        sections: [
          {
            heading: 'Professional experience',
            entries: [{
              label: 'Senior Software Engineer',
              organization: 'Acme GmbH',
              location: 'Munich',
              start: '2026-09',
              end: null,
              bullets: ['Works on software systems.'],
            }],
          },
          {
            heading: 'Education',
            entries: [{
              label: 'Computer Science',
              organization: 'IIT Bombay',
              location: null,
              start: null,
              end: '2016',
              bullets: ['Degree completed.'],
            }],
          },
        ],
      },
      modelVersion: 'm',
      promptVersion: 'p',
    }),
    generateAnabinJustification: vi.fn().mockResolvedValue({
      content: {
        title: 'Anabin recognition justification',
        subject: 'Recognition evidence for EU Blue Card file',
        institutionStatus: 'Institution status is unknown in the seeded Anabin result.',
        degreeStatus: 'Degree equivalence is not confirmed on the current record.',
        paragraphs: ['One', 'Two', 'Three'],
        recommendedNextSteps: ['Request ZAB statement or consulate clarification.'],
      },
      modelVersion: 'm',
      promptVersion: 'p',
    }),
    ...overrides,
  };
}

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
    const generator = mockGenerator();

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

  it.each([
    ['employer_letter' as const, 'generateEmployerLetter' as const],
    ['cv' as const, 'generateCv' as const],
    ['anabin_justification' as const, 'generateAnabinJustification' as const],
  ])('generates %s content through the typed dispatcher', async (type, method) => {
    const { generateDraftHandler } = await import('@/lib/inngest/functions/generate-draft');
    const drafts = makeDraftRepository(handle.db);
    const draftId = await drafts.insert({ caseId, userId, type });
    const generator = mockGenerator();

    await generateDraftHandler({
      event: { name: 'draft.requested', data: { draftId, caseId, userId } },
      step,
      deps: { generator },
    });

    const draft = await drafts.getById(draftId);
    expect(generator[method]).toHaveBeenCalledOnce();
    expect(draft?.status).toBe('ready_for_review');
    expect(draft?.content?.type).toBe(type);
  });

  it('passes regeneration framing instructions into the generator', async () => {
    const { generateDraftHandler } = await import('@/lib/inngest/functions/generate-draft');
    const drafts = makeDraftRepository(handle.db);
    const draftId = await drafts.insert({ caseId, userId, type: 'cover_letter' });
    const generator = mockGenerator();

    await generateDraftHandler({
      event: {
        name: 'draft.requested',
        data: {
          draftId,
          caseId,
          userId,
          framingInstruction: 'Make the tone more formal.',
        },
      },
      step,
      deps: { generator },
    });

    expect(generator.generateCoverLetter).toHaveBeenCalledWith(
      expect.objectContaining({ framingInstruction: 'Make the tone more formal.' }),
    );
  });

  it('marks failed when generation throws', async () => {
    const { generateDraftHandler } = await import('@/lib/inngest/functions/generate-draft');
    const drafts = makeDraftRepository(handle.db);
    const draftId = await drafts.insert({ caseId, userId, type: 'cover_letter' });

    await generateDraftHandler({
      event: { name: 'draft.requested', data: { draftId, caseId, userId } },
      step,
      deps: {
        generator: mockGenerator({
          generateCoverLetter: vi.fn().mockRejectedValue(new Error('model down')),
        }),
      },
    });

    const draft = await drafts.getById(draftId);
    expect(draft?.status).toBe('failed');
    expect(draft?.error).toMatch(/model down/);
  });
});
