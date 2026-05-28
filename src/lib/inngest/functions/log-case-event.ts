import { inngest, type CaseFactsUpdatedEvent } from '@/lib/inngest/client';
import { db } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';

interface StepLike {
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
}

export async function logCaseEventHandler({
  event,
  step,
}: {
  event: CaseFactsUpdatedEvent;
  step: StepLike;
}): Promise<void> {
  await step.run('write-activity-log', async () => {
    await db.insert(schema.activityLog).values({
      caseId: event.data.caseId,
      userId: null,
      kind: 'inngest.echo',
      payload: { paths: event.data.paths, sourceTurnId: event.data.sourceTurnId },
    });
  });
}

export const logCaseEvent = inngest.createFunction(
  { id: 'log-case-event', triggers: [{ event: 'case.facts.updated' }] },
  logCaseEventHandler,
);
