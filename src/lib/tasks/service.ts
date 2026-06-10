import type { drizzle } from 'drizzle-orm/node-postgres';
import type * as schema from '@/lib/db/schema';
import { makeDocumentRepository } from '@/lib/documents/repository';
import { makeDraftRepository } from '@/lib/drafting/repository';
import { makeApprovalRepository } from '@/lib/approvals/repository';
import { makeTaskRepository, type ReconcileResult } from '@/lib/tasks/repository';
import { deriveSystemTasks } from '@/lib/tasks/generate';

type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Load the canonical artifact state for a case, derive the desired open system tasks, and
 * reconcile them into the tasks table. Idempotent — safe to call on every case read; a steady
 * state produces `{ created: 0, updated: 0, resolved: 0 }`. This is the single integration
 * seam the firm console / case page calls; the derive + reconcile halves stay independently
 * unit-tested.
 */
export async function reconcileCaseTasks(
  caseId: string,
  organizationId: string,
  db?: Db,
): Promise<ReconcileResult> {
  const documents = await makeDocumentRepository(db).listByCase(caseId);
  const drafts = await makeDraftRepository(db).listByCase(caseId);
  const approvals = await makeApprovalRepository(db).listPending(caseId);

  const desired = deriveSystemTasks({
    documents: documents.map((d) => ({ id: d.id, fileName: d.fileName, status: d.status })),
    drafts: drafts.map((d) => ({ id: d.id, type: d.type, status: d.status })),
    approvals: approvals.map((a) => ({
      id: a.id,
      subjectType: a.subjectType,
      status: a.status,
      requiredRole: a.requiredRole,
      visibility: a.visibility,
      dueAt: a.dueAt,
    })),
  });

  return await makeTaskRepository(db).reconcileSystemTasks(caseId, organizationId, desired);
}
