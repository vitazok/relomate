import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedAnonUser } from '../_db/seed-auth';
import { encodeSession } from '@/lib/auth/cookie';
import { makeRepository } from '@/lib/case/repository';
import * as schema from '@/lib/db/schema';
import type * as AiModule from 'ai';

const cookieStore = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    get: (name: string) => {
      const v = cookieStore.get(name);
      return v ? { name, value: v } : undefined;
    },
    set: (name: string, value: string) => { cookieStore.set(name, value); },
    delete: (name: string) => { cookieStore.delete(name); },
  }),
}));

const inngestSendSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/inngest/client', () => ({
  inngest: { send: inngestSendSpy },
}));

let testHandle: TestDbHandle;
vi.mock('@/lib/db/client', () => ({
  get db() { return testHandle.db; },
}));

// Mock streamText to call onFinish synchronously with a fixture and return a no-op stream response.
let streamTextOnFinish: ((event: unknown) => Promise<void>) | undefined;
let streamTextFixture: unknown = {};
vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('ai');
  return {
    ...actual,
    streamText: vi.fn((opts: { onFinish?: (e: unknown) => Promise<void> }) => {
      streamTextOnFinish = opts.onFinish;
      return {
        toUIMessageStreamResponse: () => new Response(new ReadableStream(), { status: 200 }),
      };
    }),
  };
});

describe('POST /api/chat', () => {
  let userId: string;
  let caseId: string;
  let threadId: string;

  beforeAll(async () => {
    testHandle = await createTestSchema();
    const seeded = await seedAnonUser(testHandle);
    userId = seeded.userId;
    const repo = makeRepository(testHandle.db, testHandle.schemaName);
    const created = await repo.createCase({
      userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    caseId = created.caseId;
    threadId = created.threadId;
  }, 30_000);

  afterAll(async () => { if (testHandle) await testHandle.cleanup(); });
  beforeEach(() => { cookieStore.clear(); vi.clearAllMocks(); streamTextOnFinish = undefined; streamTextFixture = {}; });

  it('returns 401 when no session cookie present', async () => {
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] }],
      }),
    }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caseId is owned by a different user', async () => {
    const otherSeeded = await seedAnonUser(testHandle);
    cookieStore.set(
      'visa_session',
      encodeSession({ userId: otherSeeded.userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'x' }] }],
      }),
    }));
    expect(res.status).toBe(403);
  });

  it('persists user + assistant rows and emits inngest event when update_case fires', async () => {
    cookieStore.set(
      'visa_session',
      encodeSession({ userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'I make 55k' }] }],
      }),
    }));
    expect(res.status).toBe(200);
    if (!streamTextOnFinish) throw new Error('streamText onFinish was not captured');

    // Simulate the AI SDK calling onFinish at the end of the stream.
    await streamTextOnFinish({
      text: 'Recorded.',
      content: [{ type: 'text', text: 'Recorded.' }],
      toolCalls: [
        { toolCallId: 'call-1', toolName: 'update_case', input: { source: 'user_stated', confidence: 0.9, updates: { 'employment.annualGrossSalaryEur': 55000 } } },
      ],
      toolResults: [
        { toolCallId: 'call-1', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [] } } },
      ],
      steps: [
        {
          text: '',
          content: [],
          toolCalls: [
            { toolCallId: 'call-1', toolName: 'update_case', input: { source: 'user_stated', confidence: 0.9, updates: { 'employment.annualGrossSalaryEur': 55000 } } },
          ],
          toolResults: [
            { toolCallId: 'call-1', toolName: 'update_case', output: { type: 'update_case_result', version: 1, data: { caseId, updatedPaths: ['employment.annualGrossSalaryEur'], contradictions: [] } } },
          ],
        },
        { text: 'Recorded.', content: [{ type: 'text', text: 'Recorded.' }], toolCalls: [], toolResults: [] },
      ],
    });

    const messages = await testHandle.db.select().from(schema.messages).where(eq(schema.messages.threadId, threadId));
    expect(messages.length).toBeGreaterThanOrEqual(2);
    const tools = await testHandle.db.select().from(schema.toolCalls);
    expect(tools.length).toBeGreaterThanOrEqual(1);

    expect(inngestSendSpy).toHaveBeenCalledOnce();
    const sent = inngestSendSpy.mock.calls[0]![0];
    expect(sent.name).toBe('case.facts.updated');
    expect(sent.data.caseId).toBe(caseId);
    expect(sent.data.paths).toEqual(['employment.annualGrossSalaryEur']);
  });

  it('does not emit an inngest event when the assistant fired no tools', async () => {
    cookieStore.set(
      'visa_session',
      encodeSession({ userId, iat: Date.now(), exp: Date.now() + 60_000 }),
    );
    const { POST } = await import('@/app/api/chat/route');
    const res = await POST(new Request('http://localhost/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        caseId,
        messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] }],
      }),
    }));
    expect(res.status).toBe(200);

    await streamTextOnFinish!({
      text: 'Hi!',
      content: [{ type: 'text', text: 'Hi!' }],
      toolCalls: [],
      toolResults: [],
      steps: [{ text: 'Hi!', content: [{ type: 'text', text: 'Hi!' }], toolCalls: [], toolResults: [] }],
    });

    expect(inngestSendSpy).not.toHaveBeenCalled();
  });
});
