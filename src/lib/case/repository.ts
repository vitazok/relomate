import { eq, sql } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { CaseFactsSchema, type CaseFacts } from '@/lib/case/schema';
import { ProfileSchema, type Profile } from '@/lib/profile/schema';
import { validateLeafPath, validateLeafValue, setAtPath, getAtPath } from '@/lib/case/paths';
import type {
  UpdateCaseInput,
  UpdateCaseResult,
  ContradictionReport,
} from '@/lib/case/types';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreateCaseInput {
  userId: string;
  organizationId?: string | null;
  visaType: string;
  targetCountry: string;
  targetConsulate?: string | null;
  targetMoveDate?: string | null;
}

export interface LoadedCase {
  case: {
    id: string;
    userId: string;
    organizationId: string;
    primaryApplicantUserId: string;
    assignedConsultantId: string | null;
    reviewerId: string | null;
    stage: string;
    priority: string;
    targetSubmissionDate: Date | null;
    submittedAt: Date | null;
    closedAt: Date | null;
    status: string;
    visaType: string;
    targetCountry: string;
    targetConsulate: string | null;
    targetMoveDate: string | null;
  };
  profile: Profile | null;
  caseFacts: CaseFacts;
  threadId: string;
}

export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string; threadId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
  applyUpdate(input: UpdateCaseInput): Promise<UpdateCaseResult>;
  appendActivity(input: AppendActivityInput): Promise<void>;
}

export interface AppendActivityInput {
  caseId: string;
  userId: string;
  kind: string;
  payload: Record<string, unknown>;
}

/**
 * Build a repository scoped to a Drizzle client. The optional `schemaName`
 * is informational only — the actual Postgres schema is selected by the
 * pool's search_path (set at pool construction in tests, defaults to
 * `public` in prod).
 */
export function makeRepository(db?: Db, _schemaName: string | null = null): Repository {
  const dbInstance = db ?? defaultDb;
  return {
    async createCase(input) {
      return await dbInstance.transaction(async (tx) => {
        let organizationId = input.organizationId ?? null;
        if (!organizationId) {
          const [owner] = await tx
            .select({ organizationId: schema.users.organizationId })
            .from(schema.users)
            .where(eq(schema.users.id, input.userId));
          if (!owner) throw new Error(`user not found: ${input.userId}`);
          organizationId = owner.organizationId;
        }

        const [row] = await tx
          .insert(schema.cases)
          .values({
            userId: input.userId,
            organizationId,
            primaryApplicantUserId: input.userId,
            status: 'draft',
            visaType: input.visaType,
            targetCountry: input.targetCountry,
            targetConsulate: input.targetConsulate ?? null,
            targetMoveDate: input.targetMoveDate ?? null,
          })
          .returning({ id: schema.cases.id });
        if (!row) throw new Error('createCase: insert returned no row');
        await tx.insert(schema.caseFacts).values({ caseId: row.id, data: {} as CaseFacts });
        await tx.insert(schema.caseParticipants).values({
          caseId: row.id,
          organizationId,
          userId: input.userId,
          role: 'applicant',
          invitationStatus: 'active',
          visibility: 'shared',
          relation: { kind: 'primary_applicant' },
        });
        const [thread] = await tx
          .insert(schema.threads)
          .values({ caseId: row.id, title: null })
          .returning({ id: schema.threads.id });
        if (!thread) throw new Error('createCase: thread insert returned no row');
        return { caseId: row.id, threadId: thread.id };
      });
    },

    async loadCase(caseId) {
      const cases = await dbInstance.select().from(schema.cases).where(eq(schema.cases.id, caseId));
      if (cases.length === 0) throw new Error(`case not found: ${caseId}`);
      const c = cases[0]!;
      const facts = await dbInstance.select().from(schema.caseFacts).where(eq(schema.caseFacts.caseId, caseId));
      const factsRow = facts[0];
      const parsedFacts = CaseFactsSchema.parse(factsRow?.data ?? {});
      const profiles = await dbInstance.select().from(schema.profiles).where(eq(schema.profiles.userId, c.userId));
      const profileRow = profiles[0];
      const parsedProfile = profileRow ? ProfileSchema.parse(profileRow.data) : null;
      const threadRows = await dbInstance
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(eq(schema.threads.caseId, caseId));
      const threadId = threadRows[0]?.id;
      if (!threadId) throw new Error(`thread not found for case ${caseId}`);
      return {
        case: {
          id: c.id,
          userId: c.userId,
          organizationId: c.organizationId,
          primaryApplicantUserId: c.primaryApplicantUserId,
          assignedConsultantId: c.assignedConsultantId,
          reviewerId: c.reviewerId,
          stage: c.stage,
          priority: c.priority,
          targetSubmissionDate: c.targetSubmissionDate,
          submittedAt: c.submittedAt,
          closedAt: c.closedAt,
          status: c.status,
          visaType: c.visaType,
          targetCountry: c.targetCountry,
          targetMoveDate: c.targetMoveDate,
          targetConsulate: c.targetConsulate,
        },
        profile: parsedProfile,
        caseFacts: parsedFacts,
        threadId,
      };
    },

    async applyUpdate(input) {
      const { caseId, source, sourceTurnId, confidence, updates } = input;

      const flat = Object.entries(updates).map(([path, newValue]) => {
        const resolved = validateLeafPath(path);
        validateLeafValue(resolved.inner, newValue);
        return { path, newValue, kind: resolved.kind };
      });

      const updatedAt = new Date().toISOString();
      const contradictions: ContradictionReport[] = [];

      await dbInstance.transaction(async (tx) => {
        // Resolve the owning user up front so we can take locks in a consistent global order:
        // users → case_facts → profiles. (Acquiring the user lock AFTER case_facts would let
        // two concurrent same-user transactions on different cases deadlock.)
        const caseRows = await tx
          .select({ userId: schema.cases.userId })
          .from(schema.cases)
          .where(eq(schema.cases.id, caseId));
        const caseRow = caseRows[0];
        if (!caseRow) throw new Error(`case not found: ${caseId}`);
        const userId = caseRow.userId;

        // Profile rows are keyed by user, not case, so two cases of the same user touch the
        // same profile. Their case_facts FOR UPDATE locks are on DIFFERENT rows and don't
        // serialize them, and FOR UPDATE on a not-yet-existing profiles row locks nothing —
        // so without this both would snapshot an empty profile and the second upsert would
        // clobber the first's write. Lock the always-present users row to serialize the
        // profile read-modify-write across concurrent same-user transactions.
        await tx
          .select({ id: schema.users.id })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .for('update');

        const factsRows = await tx
          .select({ data: schema.caseFacts.data })
          .from(schema.caseFacts)
          .where(eq(schema.caseFacts.caseId, caseId))
          .for('update');
        const factsRow = factsRows[0];
        if (!factsRow) throw new Error(`case_facts not found for case ${caseId}`);

        const profileRows = await tx
          .select({ data: schema.profiles.data })
          .from(schema.profiles)
          .where(eq(schema.profiles.userId, userId))
          .for('update');
        const profileRow = profileRows[0];

        let nextFacts: CaseFacts = (factsRow.data ?? {}) as CaseFacts;
        let nextProfile: Profile = (profileRow?.data ?? { schemaVersion: 1 }) as Profile;

        for (const { path, newValue, kind } of flat) {
          const wrapper = {
            value: newValue,
            source,
            sourceTurnId,
            confidence,
            updatedAt,
          };
          const target =
            kind === 'case'
              ? (nextFacts as Record<string, unknown>)
              : (nextProfile as unknown as Record<string, unknown>);
          const existing = getAtPath(target, path) as
            | { value: unknown; confidence: number }
            | undefined;
          if (existing && existing.confidence >= confidence && !deepEqual(existing.value, newValue)) {
            contradictions.push({
              path,
              previousValue: existing.value,
              previousConfidence: existing.confidence,
              newValue,
              newConfidence: confidence,
            });
          }
          const merged = setAtPath(target, path, wrapper);
          if (kind === 'case') nextFacts = merged as CaseFacts;
          else nextProfile = merged as unknown as Profile;

          const oldValueLog = existing?.value ?? null;
          if (kind === 'case') {
            await tx.insert(schema.caseChanges).values({
              caseId,
              fieldPath: path,
              oldValue: oldValueLog,
              newValue,
              source,
              sourceTurnId,
              confidence: String(confidence),
            });
          } else {
            await tx.insert(schema.profileChanges).values({
              userId,
              fieldPath: path,
              oldValue: oldValueLog,
              newValue,
              source,
              sourceTurnId,
              confidence: String(confidence),
            });
          }
        }

        // Safety belt: refuse to write a malformed JSONB.
        CaseFactsSchema.parse(nextFacts);

        await tx
          .update(schema.caseFacts)
          .set({ data: nextFacts, updatedAt: new Date() })
          .where(eq(schema.caseFacts.caseId, caseId));

        const wroteProfilePath = flat.some((f) => f.kind === 'profile');
        if (wroteProfilePath) {
          ProfileSchema.parse(nextProfile);
          await tx
            .insert(schema.profiles)
            .values({ userId, data: nextProfile })
            .onConflictDoUpdate({
              target: schema.profiles.userId,
              set: { data: nextProfile, updatedAt: new Date() },
            });
        }

        const payload = {
          kind: 'case.facts.updated' as const,
          paths: flat.map((f) => f.path),
          source,
          sourceTurnId,
          contradictions: contradictions.length,
        };
        await tx.insert(schema.activityLog).values({
          caseId,
          userId,
          kind: 'case.facts.updated',
          payload,
        });

        // Touch sql import so it's not unused if drizzle changes the FOR UPDATE API.
        void sql;
      });

      return {
        caseId,
        updatedPaths: flat.map((f) => f.path),
        contradictions,
      };
    },

    async appendActivity(input) {
      await dbInstance.insert(schema.activityLog).values({
        caseId: input.caseId,
        userId: input.userId,
        kind: input.kind,
        payload: input.payload,
      });
    },
  };
}

// Structural equality that is INSENSITIVE to object key order — the LLM may re-emit the
// same object-valued leaf (e.g. currentAddress) with keys in a different order, which
// JSON.stringify would treat as different and surface as a spurious contradiction.
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  const aIsArr = Array.isArray(a);
  const bIsArr = Array.isArray(b);
  if (aIsArr !== bIsArr) return false;
  if (aIsArr && bIsArr) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao);
  const bKeys = Object.keys(bo);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}
