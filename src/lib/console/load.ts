import { and, eq, inArray } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { makeRepository } from '@/lib/case/repository';
import {
  ORGANIZATION_ROLES,
  type OrganizationRole,
} from '@/lib/auth/authorization';
import {
  bucketizeConsoleCases,
  type ConsoleBuckets,
  type ConsoleCaseInput,
} from '@/lib/console/view-model';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface ConsoleMembership {
  organizationId: string;
  role: OrganizationRole;
}

function parseRole(role: string | null): OrganizationRole | null {
  return ORGANIZATION_ROLES.includes(role as OrganizationRole) ? (role as OrganizationRole) : null;
}

/**
 * Resolve the viewer's active organization membership. Returns the first active membership; in
 * MVP a user belongs to exactly one firm. Null if the user has no active membership.
 */
export async function resolveMembership(
  db: Db,
  userId: string,
): Promise<ConsoleMembership | null> {
  const rows = await db
    .select({ organizationId: schema.organizationMembers.organizationId, role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(
      and(
        eq(schema.organizationMembers.userId, userId),
        eq(schema.organizationMembers.status, 'active'),
      ),
    );
  for (const row of rows) {
    const role = parseRole(row.role);
    if (role) return { organizationId: row.organizationId, role };
  }
  return null;
}

export interface ConsoleData {
  organizationId: string;
  role: OrganizationRole;
  buckets: ConsoleBuckets;
}

/**
 * Load the firm console buckets for a viewer's organization. Joins per-case open-task signals
 * (blocking present, earliest due) onto the case rows, then defers all bucketing to the pure
 * `bucketizeConsoleCases`. `now` is parameterized so overdue evaluation is testable.
 */
export async function loadConsole(
  db: Db,
  membership: ConsoleMembership,
  viewerUserId: string,
  now: Date,
): Promise<ConsoleData> {
  const repo = makeRepository(db);
  const cases = await repo.listByOrganization(membership.organizationId);

  // Pull open tasks for the org once and fold per-case signals in memory — avoids N+1 and keeps
  // the bucketing pure. Terminal tasks (done/cancelled) are excluded.
  const openTasks = cases.length
    ? await db
        .select({
          caseId: schema.tasks.caseId,
          blocking: schema.tasks.blocking,
          dueAt: schema.tasks.dueAt,
        })
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.organizationId, membership.organizationId),
            inArray(schema.tasks.status, ['open', 'in_progress', 'blocked']),
          ),
        )
    : [];

  const blockingByCase = new Set<string>();
  const earliestDueByCase = new Map<string, Date>();
  for (const t of openTasks) {
    if (t.blocking) blockingByCase.add(t.caseId);
    if (t.dueAt) {
      const current = earliestDueByCase.get(t.caseId);
      if (!current || t.dueAt.getTime() < current.getTime()) {
        earliestDueByCase.set(t.caseId, t.dueAt);
      }
    }
  }

  const inputs: ConsoleCaseInput[] = cases.map((c) => ({
    id: c.id,
    status: c.status,
    assignedConsultantId: c.assignedConsultantId,
    reviewerId: c.reviewerId,
    targetSubmissionDate: c.targetSubmissionDate,
    hasBlockingTask: blockingByCase.has(c.id),
    earliestTaskDueAt: earliestDueByCase.get(c.id) ?? null,
    primaryApplicantUserId: c.primaryApplicantUserId,
    updatedAt: c.updatedAt,
  }));

  const buckets = bucketizeConsoleCases(inputs, { viewerUserId, now });
  return { organizationId: membership.organizationId, role: membership.role, buckets };
}
