import { NextResponse } from 'next/server';
import { z } from 'zod';
import { convertToModelMessages } from 'ai';
import { anthropic, MODEL_ID } from '@/lib/ai/provider';
import { buildAgentTurn } from '@/lib/ai/chat/agent-turn';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';

// Bound client-supplied input: the browser resends the full transcript each turn,
// so cap both the raw payload and the message count to keep model cost predictable.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MESSAGES = 100;

const BodySchema = z.object({
  caseId: z.string().uuid(),
  messages: z.array(z.unknown()).min(1).max(MAX_MESSAGES),
});

export async function POST(req: Request) {
  const rawBody = await req.text();
  if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) {
    return new NextResponse('payload too large', { status: 413 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return new NextResponse('invalid json', { status: 400 });
  }

  const parsed = BodySchema.safeParse(parsedJson);
  if (!parsed.success) return new NextResponse('invalid request', { status: 400 });
  const body = parsed.data;

  const userId = await getCurrentUserId();
  if (!userId) return new NextResponse('unauthorized', { status: 401 });

  const repo = makeRepository(db);
  const loaded = await repo.loadCase(body.caseId);
  if (loaded.case.userId !== userId) return new NextResponse('forbidden', { status: 403 });

  const userMessageId = crypto.randomUUID();
  // BodySchema only checks that messages is a non-empty array of unknowns; the per-message
  // shape can still be invalid (unknown role, malformed parts). convertToModelMessages throws
  // on those — treat it as a client error (400), not an unhandled 500 leaking a stack.
  let modelMessages;
  try {
    modelMessages = await convertToModelMessages(body.messages as never);
  } catch {
    return new NextResponse('invalid messages', { status: 400 });
  }

  const result = await buildAgentTurn({
    model: anthropic(MODEL_ID),
    repo,
    caseId: body.caseId,
    threadId: loaded.threadId,
    userId,
    userMessageId,
    caseFacts: loaded.caseFacts,
    modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
