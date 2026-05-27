import { eq } from 'drizzle-orm';
import type { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '@/lib/db/schema';
import { CaseFactsSchema, type CaseFacts } from '@/lib/case/schema';
import { ProfileSchema, type Profile } from '@/lib/profile/schema';

type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface CreateCaseInput {
  userId: string;
  visaType: string;
  targetCountry: string;
  targetConsulate?: string | null;
  targetMoveDate?: string | null;
}

export interface LoadedCase {
  case: {
    id: string;
    userId: string;
    status: string;
    visaType: string;
    targetCountry: string;
    targetConsulate: string | null;
    targetMoveDate: string | null;
  };
  profile: Profile | null;
  caseFacts: CaseFacts;
}

export interface Repository {
  createCase(input: CreateCaseInput): Promise<{ caseId: string }>;
  loadCase(caseId: string): Promise<LoadedCase>;
}

function getDefaultDb(): Db {
  // Lazy import to avoid triggering env validation in test imports
  return require('@/lib/db/client').db;
}

/**
 * Build a repository scoped to a Drizzle client. The optional `schemaName`
 * is informational only — the actual Postgres schema is selected by the
 * pool's search_path (set at pool construction in tests, defaults to
 * `public` in prod).
 */
export function makeRepository(db?: Db, schemaName: string | null = null): Repository {
  const dbInstance = db ?? getDefaultDb();
  return {
    async createCase(input) {
      const [row] = await dbInstance
        .insert(schema.cases)
        .values({
          userId: input.userId,
          status: 'draft',
          visaType: input.visaType,
          targetCountry: input.targetCountry,
          targetConsulate: input.targetConsulate ?? null,
          targetMoveDate: input.targetMoveDate ?? null,
        })
        .returning({ id: schema.cases.id });
      if (!row) throw new Error('createCase: insert returned no row');
      await dbInstance.insert(schema.caseFacts).values({ caseId: row.id, data: {} as CaseFacts });
      return { caseId: row.id };
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
      return {
        case: {
          id: c.id,
          userId: c.userId,
          status: c.status,
          visaType: c.visaType,
          targetCountry: c.targetCountry,
          targetMoveDate: c.targetMoveDate,
          targetConsulate: c.targetConsulate,
        },
        profile: parsedProfile,
        caseFacts: parsedFacts,
      };
    },
  };
}
