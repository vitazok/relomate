import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestSchema, type TestDbHandle } from '../_db/setup';
import { seedOrgAndUser, type SeededIds } from '../_db/seed';
import { makeRepository } from '@/lib/case/repository';
import {
  loadAllPersonas,
  toCaseFacts,
  flattenLeafValues,
  isLeafValueValid,
  deriveUpdateCalls,
} from '../_personas/harness';

const TURN_ID = '00000000-0000-4000-8000-0000000000aa';

const toValueMap = (flat: Array<{ path: string; value: unknown }>) =>
  Object.fromEntries(flat.map((l) => [l.path, l.value]));

describe('persona case-file end-state (DB-backed)', () => {
  let handle: TestDbHandle;
  let seeded: SeededIds;

  beforeAll(async () => {
    handle = await createTestSchema();
    seeded = await seedOrgAndUser(handle);
  }, 30_000);

  afterAll(async () => {
    if (handle) await handle.cleanup();
  });

  for (const persona of loadAllPersonas()) {
    it(`${persona.id}: derived update_case calls persist the expected case file`, async () => {
      const repo = makeRepository(handle.db, handle.schemaName);
      const { caseId } = await repo.createCase({
        userId: seeded.userId,
        visaType: 'blue_card',
        targetCountry: 'DE',
        targetConsulate: 'bengaluru',
      });

      const calls = deriveUpdateCalls(persona);
      let rejected = 0;
      for (const call of calls) {
        try {
          const result = await repo.applyUpdate({ ...call, caseId, sourceTurnId: TURN_ID });
          // A single bundled/isolated call writes each path once → no self-contradiction.
          expect(result.contradictions).toEqual([]);
        } catch {
          rejected++;
        }
      }

      const loaded = await repo.loadCase(caseId);
      const expected = flattenLeafValues(toCaseFacts(persona)).filter((l) =>
        isLeafValueValid(l.path, l.value),
      );
      expect(toValueMap(flattenLeafValues(loaded.caseFacts))).toEqual(toValueMap(expected));

      if (persona.expected.outOfScope) {
        // A non-Blue-Card intent is now a VALID, persistable intendedVisa value (the engine,
        // not applyUpdate, is responsible for flagging it out-of-scope). So it persists rather
        // than being rejected, and the recorded intent is whatever the persona stated.
        expect(rejected).toBe(0);
        const persisted = flattenLeafValues(loaded.caseFacts).find(
          (l) => l.path === 'target.intendedVisa',
        );
        expect(persisted?.value).toBe(persona.caseFacts.target?.visaType);
      } else {
        expect(rejected).toBe(0);
      }
    });
  }
});
