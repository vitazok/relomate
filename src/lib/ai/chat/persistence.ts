import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface ToolCallInput {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolCallOutput {
  toolCallId: string;
  toolName: string;
  output?: unknown;
  error?: string;
}

export interface AppendChatTurnInput {
  threadId: string;
  userId: string;
  userMessageId: string;
  userMessageContent: string;
  assistantText: string;
  assistantParts: unknown;
  toolCalls: ToolCallInput[];
  toolResults: ToolCallOutput[];
  promptVersion: string;
  modelVersion: string;
}

export async function appendChatTurn(
  input: AppendChatTurnInput,
  db?: Db,
): Promise<{ assistantMessageId: string }> {
  const dbInstance = db ?? defaultDb;
  const assistantMessageId = crypto.randomUUID();

  await dbInstance.transaction(async (tx) => {
    await tx.insert(schema.messages).values({
      id: input.userMessageId,
      threadId: input.threadId,
      userId: input.userId,
      role: 'user',
      content: input.userMessageContent,
      parts: null,
      channel: 'web',
    });

    await tx.insert(schema.messages).values({
      id: assistantMessageId,
      threadId: input.threadId,
      userId: input.userId,
      role: 'assistant',
      content: input.assistantText,
      parts: input.assistantParts as never,
      channel: 'web',
      modelVersion: input.modelVersion,
      promptVersion: input.promptVersion,
    });

    if (input.toolCalls.length > 0) {
      const resultByCallId = new Map(input.toolResults.map((r) => [r.toolCallId, r]));
      for (const call of input.toolCalls) {
        const result = resultByCallId.get(call.toolCallId);
        await tx.insert(schema.toolCalls).values({
          messageId: assistantMessageId,
          toolName: call.toolName,
          input: call.input as never,
          output: (result?.output ?? null) as never,
          error: result?.error ?? null,
          durationMs: null,
        });
      }
    }

    await tx
      .update(schema.threads)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.threads.id, input.threadId));
  });

  return { assistantMessageId };
}
