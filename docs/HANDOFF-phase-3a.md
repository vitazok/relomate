# Phase 3A — Document Ingest — HANDOFF

**Date:** 2026-06-03
**Status:** Tasks 0.1 → 5.1 complete (10 of 21 plan tasks). Paused at user request.
**Next task:** 5.2 (extractDocument Inngest workflow).

## Where the work lives

- **Worktree:** `/Users/vitalii.kashin/Projects/visa/.claude/worktrees/phase-3a-document-ingest`
  Work ONLY here. Do not `cd` to the main checkout.
- **Branch:** `worktree-phase-3a-document-ingest`, based on `origin/main` @ `19f6df5` (the PR #7 merge — clean of the in-flight docs PR #8).
- **Spec:** `docs/superpowers/specs/2026-06-03-phase-3a-document-ingest-design.md` (on the `docs/mark-pr7-merged` branch / in the main checkout — NOT in this worktree's tree, but you can read it from the main checkout at `/Users/vitalii.kashin/Projects/visa/docs/superpowers/specs/`).
- **Plan:** `docs/superpowers/plans/2026-06-03-phase-3a-document-ingest.md` (same location — main checkout). This handoff summarizes what's done; the plan has the full per-task code for the remaining tasks.

> NOTE: the spec + plan were committed on the `docs/mark-pr7-merged` branch, not on `main`, so they are NOT present in this worktree. Read them from the main checkout path above. The plan task numbers below match the plan file.

## Setup state (already done in this worktree)

- `pnpm install` done; `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` added.
- `.env.local` and `.env.test.local` copied from the main checkout (gitignored; DB tests need `.env.test.local`).
- Baseline before this work: 241 tests. **Now: 275 tests, all green.**

## Verification commands

- Single file: `pnpm exec vitest run <path>`
- DB-touching files: `pnpm exec vitest run --no-file-parallelism <path>` (avoids `EMAXPOOLSREACHED`)
- Full suite: `pnpm exec vitest run --no-file-parallelism` (~70s, serial)
- Types: `pnpm exec tsc --noEmit`

## Completed tasks (commits on branch, newest first)

| Task | Commit | What |
|---|---|---|
| 5.1 | `770ac68` | `DocumentUploadedEvent` type in `src/lib/inngest/client.ts` |
| 4.1 | `0ca63fd` | `src/lib/documents/repository.ts` — DocumentRepository CRUD |
| 3.2 | `94fadfd` | `src/lib/extraction/index.ts` — withFallback + makeExtractionProvider + makeFakeExtractionProvider |
| 3.4 | `6cc56ef` | `src/lib/extraction/reducto.ts` — ReductoProvider (HTTP, shape pending live verification) |
| 3.3 | `a8cd2a3` | `src/lib/extraction/anthropic-vision.ts` + `VISION_MODEL_ID` in provider.ts |
| 3.1 | `fad5fb4` | `src/lib/extraction/{types,schema}.ts` + passport `extraction` block in documents.yaml |
| 2.1 | `0cb3136` | `src/lib/storage/r2.ts` — StorageAdapter + R2 impl + in-memory fake |
| 1.2 | `31f543a` | `documents` pgTable + `drizzle/0003_dear_grandmaster.sql` |
| 1.1 | `9e4c6fe` | `src/lib/documents/types.ts` — Zod schemas |
| 0.2 | `f54dd99` | R2_* (prod-required) + REDUCTO_API_KEY env vars |
| 0.1 | `1bad3c7` | AWS S3 SDK deps |

Each task passed a two-stage review (spec compliance, then code quality); review-driven fixes were squashed into each task's commit.

## Key interfaces the next task needs (all built + tested)

```ts
// src/lib/documents/repository.ts
makeDocumentRepository(db?): DocumentRepository
  insert(input): Promise<string>
  insertWithId(id, input): Promise<string>
  getById(id): Promise<DocumentRow | null>
  listByCase(caseId): Promise<DocumentRow[]>        // newest first
  setStatus(id, status): Promise<void>
  setExtraction(id, {spineItemId, detectedType, classification, extracted}): Promise<void>  // → status 'awaiting_confirmation'; throws if id missing
  setFailed(id, error): Promise<void>               // → status 'failed'; throws if id missing

// src/lib/storage/r2.ts
makeR2StorageAdapter(): StorageAdapter              // real R2 (needs R2_* env)
makeFakeStorageAdapter(): FakeStorageAdapter        // in-memory + __putForTest(key, body, contentType)
documentKey(caseId, documentId, fileName): string
// StorageAdapter: presignUpload, presignDownload, getObject, headObject (null on NotFound, THROWS on other errors), deleteObject

// src/lib/extraction/index.ts
makeExtractionProvider(): ExtractionProvider        // Reducto+vision fallback if REDUCTO_API_KEY, else vision
makeFakeExtractionProvider(cfg): ExtractionProvider // cfg: {classifyResult?, extractResult?, throwOnClassify?, throwOnExtract?}
withFallback(primary, fallback): ExtractionProvider

// src/lib/extraction/schema.ts
getExtractionSchema(spineItemId): ExtractionSchema | null   // null = upload-and-store only
getDocumentSpine(): SpineItem[]
sensitiveKeys(schema): string[]                     // field keys flagged sensitive — for PII-safe logging
listExtractableItems(): string[]
__resetExtractionSchemaCacheForTests()

// src/lib/inngest/client.ts
type DocumentUploadedEvent = { name: 'document.uploaded'; data: { documentId; caseId; userId } }
```

## NEXT: Task 5.2 — extractDocument Inngest workflow

Create `src/lib/inngest/functions/extract-document.ts` + `tests/inngest/extract-document.test.ts`. Full code is in the plan (Task 5.2). Critical points:

- Follow the `log-case-event.ts` pattern EXACTLY: export `extractDocumentHandler` separately (tests call it with a fake `step.run`) + the wrapped `extractDocument = inngest.createFunction({id, triggers:[{event:'document.uploaded'}]}, handler)` (2-arg form).
- Handler signature takes an optional `deps: { storage, provider }` so tests inject `makeFakeStorageAdapter()` + `makeFakeExtractionProvider()`; production defaults to `makeR2StorageAdapter()` + `makeExtractionProvider()`.
- Steps: `load-document` (idempotency guard: only proceed if status==='uploaded', flip to 'classifying', no-op otherwise) → `classify` → `extract` (skip when `getExtractionSchema(spineItemId)` is null → empty fields) → `store` (repo.setExtraction → 'awaiting_confirmation') → `log-extracted`.
- **PII rule (load-bearing, has a test):** the `case.document.extracted` activity_log row must contain field KEYS + `sensitiveKeys(schema)` only — NEVER field values. The plan's test asserts `passportNumber` (key) IS in the payload but `SECRET123` (value) is NOT.
- **Rule 5:** NO case_facts / case-state write anywhere. The plan's test asserts case_facts stays `{}`.
- Failure path: catch → `repo.setFailed` + `case.document.extraction_failed` activity row.
- After the handler, register `extractDocument` in `src/app/api/inngest/route.ts` (add to the `functions: [...]` array).
- Run the test with `--no-file-parallelism` (it uses the DB harness).

## Remaining tasks after 5.2 (see plan)

- 6.1 `POST /api/documents/upload-url` — uses `insertWithId` (already on the repo).
- 6.2 `POST /api/documents/[id]/finalize` — headObject check + emit `document.uploaded`.
- 6.3 `GET /api/documents/[id]` — render-safe projection (no r2Key/raw leak).
- 7.1 `request_document_upload` tool — register in `agent-turn.ts` BEFORE `lookup_anabin` (which MUST stay last — single cache_control breakpoint; the agent-turn test asserts breakpoint count==1).
- 7.2 two renderers in the registry; 7.3 `DocumentUpload.tsx` + mount in ChatPanel.
- 8.1 dev script; 8.2 runbook (`docs/runbooks/r2-reducto-setup.md`); 8.3 full verification + update CLAUDE.md/context-history.

### Route-test gotcha (Tasks 6.1–6.3)
Import route handlers in tests via `await import('@/app/api/.../route')` INSIDE an async helper — NEVER `require('@/...')` (returns `{}` at runtime). See `tests/api/chat.test.ts` lines 72+ for the working pattern. The plan's route tests already use this.

## Review decisions already made (do NOT re-litigate)

- **No provenance fields on `ExtractedData`** — provenance attaches at the 3B confirm step via `update_case` (`source:'document'`), not on the extraction blob. Rule 9 scopes to Profile/CaseFacts leaves only.
- **`ClassificationSchema.type` is `string|null`, not a closed enum** — config-driven spine; null = no match.
- **`documents` is mutable** (setStatus/setExtraction/setFailed update in place) — work-in-progress record like case_facts; append-only rule covers messages/activity_log/*_changes only. Audit trail comes from the activity_log rows the workflow writes.
- **Provider missing-field default = confidence 0** (both vision + reducto) — a field the provider didn't return is "unknown", surfaced for manual entry in 3B.
- **Repo state-machine validation rejected as YAGNI** — `setStatus` is an internal single-caller method driven by the workflow in order; the workflow's `load-document` idempotency guard is the concurrency control, not per-method transition guards.

## Open follow-ups (tracked, not blocking)

- Reducto request/response shape in `reducto.ts` is a best-effort guess; reconcile against live API when `REDUCTO_API_KEY` is provisioned (runbook task 8.2). Vision fallback carries extraction until then.
- No index on `documents.case_id` (consistent with repo's no-FK-index convention; add later if `listByCase` profiling shows need).
- `withFallback` swallows the primary error silently (MVP-accepted; add Sentry/log when observability lands).
