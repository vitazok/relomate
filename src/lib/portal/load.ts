import type { drizzle } from 'drizzle-orm/node-postgres';
import type * as schema from '@/lib/db/schema';
import { makeTaskRepository } from '@/lib/tasks/repository';
import { reconcileCaseTasks } from '@/lib/tasks/service';
import { selectTopTasks, type TopTask } from '@/lib/tasks/view-model';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface PortalData {
  caseId: string;
  // Only client-visible, non-terminal tasks — the audience filter guarantees no internal work
  // (firm review, internal notes) leaks to the applicant.
  tasks: TopTask[];
}

/**
 * Load the applicant-safe portal view for a case. Reconciles system tasks first (so the
 * applicant sees fresh derived work), then projects to the `client` audience — the visibility
 * filter in `selectTopTasks` is what keeps internal tasks off this surface.
 */
export async function loadPortal(
  db: Db,
  input: { caseId: string; organizationId: string; now: Date },
): Promise<PortalData> {
  await reconcileCaseTasks(input.caseId, input.organizationId, db);
  const rows = await makeTaskRepository(db).listByCase(input.caseId);
  const tasks = selectTopTasks(rows, { audience: 'client', now: input.now });
  return { caseId: input.caseId, tasks };
}
