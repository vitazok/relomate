import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestSchema, type TestDbHandle } from '../../_db/setup';
import { seedAnonUser } from '../../_db/seed-auth';
import { makeRepository } from '@/lib/case/repository';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import * as schema from '@/lib/db/schema';

describe('appendChatTurn', () => {
  let handle: TestDbHandle;
  let userId: string;
  let caseId: string;
  let threadId: string;

  beforeAll(async () => {
    handle = await createTestSchema();
    const seeded = await seedAnonUser(handle);
    userId = seeded.userId;
    const repo = makeRepository(handle.db, handle.schemaName);
    const created = await repo.createCase({
      userId,
      visaType: 'blue_card',
      targetCountry: 'DE',
      targetConsulate: 'bengaluru',
    });
    caseId = created.caseId;
    threadId = created.threadId;
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  it('writes one user + one assistant message and zero tool_calls when no tools fired', async () => {
    const userMessageId = crypto.randomUUID();
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'hello',
        assistantText: 'hi there',
        assistantParts: [{ type: 'text', text: 'hi there' }],
        toolCalls: [],
        toolResults: [],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );

    const messages = await handle.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.threadId, threadId));
    expect(messages).toHaveLength(2);
    const user = messages.find((m) => m.role === 'user');
    const assistant = messages.find((m) => m.role === 'assistant');
    expect(user?.id).toBe(userMessageId);
    expect(user?.content).toBe('hello');
    expect(assistant?.content).toBe('hi there');
    expect(assistant?.modelVersion).toBe('claude-sonnet-4-7');
    expect(assistant?.promptVersion).toBe('v0-stub');

    const tools = await handle.db.select().from(schema.toolCalls);
    expect(tools).toHaveLength(0);
  });

  it('writes one tool_calls row per tool result on the assistant message', async () => {
    const userMessageId = crypto.randomUUID();
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'I make 55k',
        assistantText: 'Recorded.',
        assistantParts: [{ type: 'text', text: 'Recorded.' }],
        toolCalls: [
          {
            toolCallId: 'call-1',
            toolName: 'update_case',
            input: { source: 'user_stated', confidence: 0.9, updates: {} },
          },
        ],
        toolResults: [
          {
            toolCallId: 'call-1',
            toolName: 'update_case',
            output: {
              type: 'update_case_result',
              version: 1,
              data: {
                caseId,
                updatedPaths: ['employment.annualGrossSalaryEur'],
                contradictions: [],
              },
            },
          },
        ],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );

    const tools = await handle.db.select().from(schema.toolCalls);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.toolName).toBe('update_case');
    const output = tools[0]?.output as { data: { updatedPaths: string[] } };
    expect(output.data.updatedPaths).toEqual(['employment.annualGrossSalaryEur']);
  });

  it('updates threads.lastMessageAt on every turn', async () => {
    const userMessageId = crypto.randomUUID();
    const before = await handle.db
      .select({ ts: schema.threads.lastMessageAt })
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId));
    await appendChatTurn(
      {
        threadId,
        userMessageId,
        userMessageContent: 'x',
        assistantText: 'y',
        assistantParts: [{ type: 'text', text: 'y' }],
        toolCalls: [],
        toolResults: [],
        promptVersion: 'v0-stub',
        modelVersion: 'claude-sonnet-4-7',
      },
      handle.db,
    );
    const after = await handle.db
      .select({ ts: schema.threads.lastMessageAt })
      .from(schema.threads)
      .where(eq(schema.threads.id, threadId));
    expect(after[0]?.ts).not.toBeNull();
    if (before[0]?.ts && after[0]?.ts) {
      expect(after[0].ts.getTime()).toBeGreaterThanOrEqual(before[0].ts.getTime());
    }
  });

  it('throws (and rolls back) when threadId does not exist', async () => {
    await expect(
      appendChatTurn(
        {
          threadId: '00000000-0000-0000-0000-000000000000',
          userMessageId: crypto.randomUUID(),
          userMessageContent: 'x',
          assistantText: 'y',
          assistantParts: [],
          toolCalls: [],
          toolResults: [],
          promptVersion: 'v0-stub',
          modelVersion: 'claude-sonnet-4-7',
        },
        handle.db,
      ),
    ).rejects.toThrow();
  });
});
