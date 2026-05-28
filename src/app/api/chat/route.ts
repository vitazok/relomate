import { NextResponse } from 'next/server';
import { z } from 'zod';
import { streamText, convertToModelMessages, stepCountIs, type LanguageModel } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import { systemPrompt, PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { inngest } from '@/lib/inngest/client';

export const runtime = 'nodejs';

const BodySchema = z.object({
  caseId: z.string().uuid(),
  messages: z.array(z.unknown()).min(1),
});

function extractLastUserText(messages: { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content.find((p: { type?: string; text?: string }) => p?.type === 'text');
        if (text && typeof text.text === 'string') return text.text;
      }
    }
  }
  return '';
}

export async function POST(req: Request) {
  const body = BodySchema.parse(await req.json());
  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const repo = makeRepository(db);
  const loaded = await repo.loadCase(body.caseId);
  if (loaded.case.userId !== userId) return new NextResponse('forbidden', { status: 403 });

  const userMessageId = crypto.randomUUID();
  const modelMessages = await convertToModelMessages(body.messages as never);
  await buildAgentContext({ caseId: body.caseId, caseFacts: loaded.caseFacts });

  const result = streamText({
    // reason: @ai-sdk/anthropic@3 returns LanguageModelV3 while ai@5 expects LanguageModelV2; same runtime shape.
    model: anthropic(MODEL_ID) as unknown as LanguageModel,
    system: systemPrompt,
    messages: modelMessages,
    tools: {
      update_case: makeUpdateCaseTool(repo, {
        defaultCaseId: body.caseId,
        defaultSourceTurnId: userMessageId,
      }),
    },
    stopWhen: stepCountIs(5),
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
    async onFinish(event) {
      try {
        await appendChatTurn(
          {
            threadId: loaded.threadId,
            userMessageId,
            userMessageContent: extractLastUserText(modelMessages as never),
            assistantText: event.text,
            assistantParts: event.content,
            toolCalls: event.toolCalls.map((c) => ({
              toolCallId: c.toolCallId,
              toolName: c.toolName,
              input: c.input,
            })),
            toolResults: event.toolResults.map((r) => ({
              toolCallId: r.toolCallId,
              toolName: r.toolName,
              output: r.output,
            })),
            promptVersion: PROMPT_VERSION,
            modelVersion: MODEL_ID,
          },
          db,
        );
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateResults = event.toolResults.filter((r) => r.toolName === 'update_case');
      for (const result of updateResults) {
        const data = (result.output as { data?: { updatedPaths?: string[] } })?.data;
        try {
          await inngest.send({
            name: 'case.facts.updated',
            data: {
              caseId: body.caseId,
              paths: data?.updatedPaths ?? [],
              sourceTurnId: userMessageId,
            },
          });
        } catch (err) {
          console.error('inngest emit failed', err);
        }
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
