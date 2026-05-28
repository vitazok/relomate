import { notFound, redirect } from 'next/navigation';
import { eq, asc } from 'drizzle-orm';
import { Layout } from '@/components/workspace/Layout';
import { makeRepository } from '@/lib/case/repository';
import { getCurrentUserId } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import type { UIMessage } from 'ai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const repo = makeRepository();
  let loaded;
  try {
    loaded = await repo.loadCase(id);
  } catch (err) {
    console.error('[CasePage] loadCase threw for', { id, userId, err });
    notFound();
  }

  if (loaded.case.userId !== userId) {
    console.error('[CasePage] ownership mismatch', { id, caseUserId: loaded.case.userId, cookieUserId: userId });
    redirect('/');
  }

  const recent = await db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.threadId, loaded.threadId))
    .orderBy(asc(schema.messages.createdAt))
    .limit(50);

  const initialMessages: UIMessage[] = recent.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'assistant' | 'system',
    parts: (m.parts as UIMessage['parts']) ?? [{ type: 'text', text: m.content }],
  }));

  return (
    <Layout caseId={loaded.case.id} caseFacts={loaded.caseFacts} initialMessages={initialMessages} />
  );
}
