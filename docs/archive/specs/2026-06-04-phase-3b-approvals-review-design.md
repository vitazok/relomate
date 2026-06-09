# Phase 3B — Approvals & Review — Design

**Date:** 2026-06-04
**Status:** Designed, pending implementation plan
**Phase context:** Builds directly on Phase 3A (document-ingest, merged PR #9). 3A stops every uploaded document at `awaiting_confirmation` and deliberately writes **no** case state (rule 5). 3B is the slice that lets a human review the extracted data and flow it into `CaseFacts`/`Profile`. The approvals primitive built here is reused by Phase 4 (draft review).

---

## 1. Problem

3A delivers "file in → structured data out, awaiting confirmation": a document lands in R2, a durable Inngest workflow classifies + extracts per-field values with confidence, and parks the result on a `documents` row at `awaiting_confirmation`. By design (rule 5: only the agent writes case state, via `update_case`), 3A writes nothing into the case.

The loop is open. Extracted passport data sits on the `documents` row but never reaches `Profile.passportNumber`, `Profile.fullName`, etc. The journey tracker can't advance; eligibility can't consume identity facts; VIDEX has nothing to fill.

3B closes the loop: a **human reviews and corrects** the extracted fields, then **confirms**, and the confirmed values are written into case state through the single authoritative write path. Confirmation is an explicit UI gate (rule 12), and every confirmed fact carries correct provenance (rule 9).

---

## 2. Scope

**In scope (the "confirm-loop"):**
- A generic, polymorphic `approvals` table + repository primitive (reused by Phase 4 drafts with zero schema change).
- A `create-approval` step added to the existing 3A `extract-document` workflow (the only touch to 3A code; additive).
- A config-driven extraction-field → case-leaf-path mapping (in `documents.yaml`) plus a small typed transform registry for the non-1:1 cases.
- A dedicated side-by-side **review/correct route** (`/case/[id]/documents/[docId]/review`): source-document preview beside editable fields with per-field confidence.
- `confirmExtraction` / `rejectExtraction` **server actions** that map → write case state via `repo.applyUpdate` → resolve the approval → advance the document status.
- An in-chat "Review & confirm" deep link on the existing `document_extraction_status` renderer.

**Out of scope (deferred to 3C/3D — NOT gaps):**
- Apostille tracker + Karnataka-HRD→MEA state machine, Inngest scheduled reminders.
- Resend "ready for review" / "apostille due" emails.
- Full 3-group Documents workspace section (Needed / Awaiting / Confirmed), drag-and-drop-anywhere upload.
- `generate_document_checklist`, `track_apostille_step`, `classify_document` tools.
- A dedicated persona doc-flow E2E test (no Documents section to drive yet; revisit in 3C).

---

## 3. Key decisions (resolved during brainstorming)

1. **The write into case state stays the single `applyUpdate` path.** Rule 5's intent is "one write path for case state." The `update_case` *tool* is merely the agent's manifestation of that path; the confirm server action calls `repo.applyUpdate` directly. **No LLM in the confirm loop** — deterministic, fast, good UX. Consistent with 3A's precedent of putting upload/finalize on routes rather than agent tools (rule 13). The literal `confirm_extraction` *tool* from the IMPLEMENTATION_PLAN is **dropped** for this slice; there is no new agent tool.
2. **Generic approvals table now.** Polymorphic `{subjectType, subjectId}` so Phase 4 adds `subjectType: 'draft'` with no migration. Matches CLAUDE.md's "approvals table + primitive … reused by Phase 4 drafts."
3. **Approval row created `pending` at extraction-complete.** The workflow gains one `create-approval` step; the row is inserted `pending` when extraction lands. Confirm flips `pending → approved`. Gives a single uniform "pending approvals" inbox across documents (now) and drafts (later). Matches the plan's literal "approvals table populated when extraction complete."
4. **Field → leaf-path mapping lives in `documents.yaml`** (rule 7, single source of truth, alongside the extraction schema). A small typed transform registry in code handles the few non-1:1 cases.
5. **On confirm, write confidence `1.0`, per-field source.** Human-reviewed data is authoritative. `source: 'document'` for fields left as-extracted, `source: 'user_corrected'` for edited fields. `sourceTurnId: null` (UI action, no chat turn). At confidence 1.0 a later lower-confidence chat statement won't silently override confirmed identity, and a re-confirm of the same value is a `deepEqual` no-op.
6. **Per-field source handled by splitting into at most two `applyUpdate` calls** — one for the `document` group, one for the `user_corrected` group. Zero change to the safety-critical `applyUpdate`/repository code (lock ordering, contradiction logic). Cost: at most two `case.facts.updated` activity rows + two tx — acceptable, consistent with the existing "two independent tx per turn" precedent.
7. **Dedicated review route**, not an in-chat inline form or a modal. `/case/[id]/documents/[docId]/review`. Clean permanent home; the 3C Documents section links to the same route later. Matches the plan's "deep link to Documents view."
8. **Side-by-side = source preview + editable fields.** Uses the built-ahead `StorageAdapter.presignDownload` (3A forward-wiring) to render the actual uploaded document beside the fields, so the user eyeball-verifies each value.

---

## 4. Architecture & data flow

```
3A (existing):  upload → R2 → extractDocument workflow → documents row @ awaiting_confirmation
                                                              │
3B adds:  workflow step "create-approval" ──────────────────┘
              inserts approvals row {subjectType:'document', subjectId:docId,
                                     caseId, userId, status:'pending'}
                                                    │
              in-chat document_extraction_status card → "Review & confirm" deep link
                                                    │
                                                    ▼
   /case/[id]/documents/[docId]/review   (RSC: load doc + extraction + presigned source URL)
     ┌──────────────────────────┬───────────────────────────────────┐
     │ LEFT: source preview      │ RIGHT: editable fields +           │
     │  (img inline / PDF via    │   per-field confidence badges      │
     │   presignDownload URL)    │                                    │
     └──────────────────────────┴───────────────────────────────────┘
                                                    │  [Confirm]            [Reject]
                                                    ▼                        │
   confirmExtraction server action:                                         ▼
     1. auth → ownership → status guard (awaiting_confirmation)    rejectExtraction:
     2. buildConfirmUpdates(spineItemId, reviewedFields)             resolve approval 'rejected'
     3. applyUpdate ×(≤2: document group / user_corrected group)     doc.status='rejected'
        source per group, confidence 1.0, sourceTurnId null          (no case write)
     4. approvals.resolve(pending→approved, decision)
     5. docs.setStatus → 'confirmed'
     6. revalidatePath('/case/[id]') + redirect
                                                    │
                                                    ▼
              CaseFacts / Profile carry confirmed identity → tracker advances, eligibility consumes
```

**Boundaries / invariants:**
- Case-state write goes only through `repo.applyUpdate` (rule 5 intent honored).
- `documents.status` enum gains `confirmed` and `rejected` (3A enum was `pending_upload → uploaded → classifying → extracting → awaiting_confirmation | failed`).
- New migration `drizzle/0004_*.sql` for the `approvals` table. (`pnpm db:generate` against a real DB; see the Drizzle gotcha about regenerating `merged_into`-style migrations before deploy.)
- Confirm ordering: **write case state → resolve approval → advance doc status.** A mid-write failure leaves the approval `pending` + doc `awaiting_confirmation`; the user retries (idempotent at confidence 1.0, `deepEqual` no-op on the already-written group).

---

## 5. The approvals primitive

### 5.1 Table `approvals` (migration `0004`)

```
id           uuid pk default random
case_id      uuid → cases.id          notnull
user_id      uuid → users.id          notnull   -- owner the approval is FOR
subject_type text  notnull                       -- 'document' now; 'draft' in Phase 4
subject_id   uuid  notnull                        -- documents.id now
status       text  notnull default 'pending'      -- pending | approved | rejected
decision     jsonb                                -- null until resolved (PII-safe; see 5.2)
resolved_by  uuid → users.id
resolved_at  timestamptz
created_at   timestamptz default now() notnull
updated_at   timestamptz default now() notnull

partial unique (subject_type, subject_id) WHERE status = 'pending'   -- one open approval per subject
```

**Mutable** (like `documents` / `case_facts`): `status`/`decision`/`resolved_*` update in place. The immutable audit trail is the `activity_log` rows written on create + resolve — consistent with the 3A decision that rule 10 covers only `messages` / `activity_log` / `*_changes`.

### 5.2 `decision` jsonb (PII-safe — KEYS only, never values)

```jsonc
{
  "confirmedPaths": ["passportNumber", "fullName"],  // written as-extracted (BARE leaf paths)
  "editedPaths":    ["nationality"],                  // user changed before confirm
  "rejectedReason": null                              // string when status='rejected'
}
```

> **Leaf-path note:** profile leaves resolve at the **root** in `validateLeafPath` (e.g. `fullName`, `passportNumber`, `nationality`), NOT `profile.fullName`. All `target:`/path strings below use the bare form.

### 5.3 Repository `src/lib/approvals/repository.ts`

`makeApprovalRepository(db?)` — `defaultDb`-fallback pattern (matches case/document repos):

- `createPending({caseId, userId, subjectType, subjectId})` → id. **Idempotent** on the partial unique: if an open approval already exists for the subject, return it rather than throw (Inngest re-delivery safe).
- `getBySubject(subjectType, subjectId)` / `getById(id)`.
- `listPending(caseId)` — the uniform "what needs review" inbox (documents now, drafts later).
- `resolve(id, {status, decision, resolvedBy})` → flips `pending → approved | rejected`, sets `decision`/`resolved_*`.

Each consequential call writes an `activity_log` row: `case.approval.created` (keys: subjectType/subjectId), `case.approval.resolved` (keys: status + `decision`). No values.

### 5.4 Workflow change (3A `extract-document.ts`)

Add one checkpointed step after `store`:

```ts
await step.run('create-approval', () =>
  approvals.createPending({ caseId, userId, subjectType: 'document', subjectId: documentId }));
```

Idempotent (partial unique + return-existing). Only touch to 3A code; additive.

---

## 6. Field mapping & transforms (config-driven)

### 6.1 `documents.yaml` — extend each extraction field with optional `target` + `transform`

```yaml
extraction:
  fields:
    surname:        { type: string, target: fullName, transform: composeFullName, part: surname }
    givenNames:     { type: string, target: fullName, transform: composeFullName, part: given }
    passportNumber: { type: string, sensitive: true, target: passportNumber }
    dateOfBirth:    { type: date,   target: dateOfBirth }
    nationality:    { type: string, target: nationality, transform: toIso2 }
    dateOfExpiry:   { type: date,   target: passportExpiry }
```

- A field with **no `target`** is reviewable/visible but never written (excluded from `updates`).
- `target` strings are validated against `validateLeafPath` at **YAML load time** in `extraction/schema.ts` (fail-fast; a typo'd path can't reach `applyUpdate`).

### 6.2 Transform registry `src/lib/documents/transforms.ts`

Typed `Record<string, Transform>`:
- `composeFullName` — fan-IN: `surname` + `givenNames` (via the `part` discriminator) compose into one `fullName` leaf (`"GIVEN SURNAME"` order; configurable later). The mapper groups fields by `target` and applies a fan-in transform once per group.
- `toIso2` — `"Indian"`/`"INDIA"`/`"IND"` → `"IN"`, backed by a small lookup in `config/rules/` (reuse existing country data if present; otherwise seed a minimal map covering India + common cases, MVP being India-source). On failure, the field is left **unmapped + flagged** so the UI forces a pick rather than writing an invalid ISO2 that fails Zod.
- 1:1 fields need no transform — `value` passes through, validated by `validateLeafValue` against the leaf's inner Zod schema before the write.

### 6.3 Mapper `src/lib/documents/confirm-mapping.ts` (pure, unit-testable)

```ts
buildConfirmUpdates(spineItemId, reviewedFields) → {
  updates:     Record<path, value>,
  perPathSource: Record<path, 'document' | 'user_corrected'>,  // edited? → user_corrected
  unmapped:    string[],                                        // no target / failed transform
}
```

Takes the *reviewed* (post-edit) field values plus a per-field `edited` flag. Isolated behind a function signature so the edge cases (name order, nationality variants, date formats) can be hammered with unit tests independent of DB/UI.

---

## 7. Confirm / reject server actions

`src/app/case/[id]/documents/[docId]/review/actions.ts` (`'use server'`).

### 7.1 `confirmExtraction(input: { documentId, caseId, fields: ReviewedField[] })`

`ReviewedField = { key: string; value: unknown; edited: boolean }`

```
1. auth:       requireAuthedUserId()  (writer path; redirect on null)
2. ownership:  load doc; doc.userId === userId AND doc.caseId === caseId
                 AND doc.status === 'awaiting_confirmation'   (else no-op redirect — double-confirm guard)
3. validate:   ReviewedFieldSchema (Zod) on posted fields
4. map:        buildConfirmUpdates(doc.spineItemId, reviewedFields)
                 → blocks if a required transform is still unresolved
5. write:      for each source-group ('document', 'user_corrected') with ≥1 path →
                 repo.applyUpdate({ caseId, source, sourceTurnId: null, confidence: 1.0, updates })
6. resolve:    approvals.resolve(approvalId, { status:'approved',
                 decision: { confirmedPaths, editedPaths, rejectedReason: null }, resolvedBy: userId })
7. advance:    docs.setStatus(documentId, 'confirmed')
8. revalidatePath('/case/[id]') + redirect there
```

Per-field Zod failure (step 5, via `validateLeafValue`) returns a **field-level error to the form**, not a 500.

### 7.2 `rejectExtraction(input: { documentId, caseId, reason?: string })`

Resolves the approval `rejected` (+ optional reason in `decision.rejectedReason`), sets `documents.status = 'rejected'`, writes **no** case state, redirects back. Lets the user discard a bad extraction and re-upload without polluting the case.

### 7.3 Ordering rationale

Write case state (5) **before** resolving the approval (6) and advancing status (7): a failure mid-write leaves approval `pending` + doc `awaiting_confirmation` — clean retry, no partial-confirmed state. Each `applyUpdate` is its own tx; if the second source-group fails after the first commits, a retry is a `deepEqual` no-op on the first group.

---

## 8. Review UI (dedicated route)

`src/app/case/[id]/documents/[docId]/review/page.tsx` — RSC, `runtime = 'nodejs'` + `dynamic = 'force-dynamic'` (Next.js 16 gotcha: reads cookies + DB at render).

### 8.1 RSC load (behind auth)

1. `getCurrentUserId()` (RSC-safe reader); null → redirect `/signin`.
2. Load doc via `makeDocumentRepository`; not-found → `notFound()`; `userId !== current` → redirect `/` (matches cross-user `loadCase` convention, not 404).
3. Status guard: not `awaiting_confirmation` → redirect `/case/[id]` (nothing to review).
4. `storage.presignDownload(doc.r2Key)` → short-lived URL for the client preview (first consumer of the built-ahead `presignDownload`).
5. `getExtractionSchema(spineItemId)` → field labels / types / `sensitive` flags + `target` presence (so the UI can mark "won't be saved" for unmapped fields).

### 8.2 Client form `ReviewForm.tsx` (`'use client'`)

```
┌──────────────────────────────┬───────────────────────────────────────┐
│  Source document             │  Extracted fields — review & correct    │
│  [ inline <img> if image ]   │  Surname        [DEVI            ] ●0.97 │
│  [ <iframe>/object if PDF ]  │  Given names    [PRIYA           ] ●0.95 │
│   via presigned URL          │  Passport no.   [••••••••  show  ] ●0.91 │
│  "Open original ↗"           │  Date of birth  [1990-04-12      ] ●0.88 │
│                              │  Nationality    [India → IN ▾    ] ⚠ low │
│                              │  Expiry         [2030-09-01      ] ●0.93 │
│                              │  ⓘ "Confirming saves these to your case."│
│                              │  [ Reject ]            [ Confirm & save ]│
└──────────────────────────────┴───────────────────────────────────────┘
```

- **Confidence badge** per field: green ≥ high / amber mid / red < low. Thresholds in `config/rules/` (rule 7 — not hardcoded). Low-confidence fields visually emphasized (plan gate: "confidence-low fields surface").
- **Edit tracking:** each input tracks `edited` (dirty vs as-extracted) → drives `source: 'user_corrected'`.
- **Sensitive fields** (`passportNumber`) render masked with show/hide; never pre-logged.
- **Unmapped fields** (no `target`) render read-only with a muted "not saved" tag — visible for verification, excluded from the write.
- **Transform fields** (`nationality`/enum-ish): show raw → resolved (`India → IN`); if `toIso2` failed, present a select. Submit blocks on a still-invalid required transform.
- Submit calls `confirmExtraction` via `useActionState` (React 19 gotcha: not `useFormState`; gives `isPending`); `Reject` calls `rejectExtraction`.

### 8.3 In-chat deep link

The existing `document_extraction_status` renderer (built-ahead in 3A) gains, when `status === 'awaiting_confirmation'`, a "Review & confirm" link to `/case/[id]/documents/[docId]/review`. Small renderer edit — no new tool.

---

## 9. Renderers, testing, error handling

### 9.1 Renderers (`registry.tsx`)

Edit the existing `document_extraction_status` renderer:
- `awaiting_confirmation` → "Review & confirm" deep link.
- `confirmed` → terminal "✓ Added to your case".
- `rejected` → muted "Dismissed".

Dispatches on `type` only (existing convention; `version` stays 1). `confirmExtraction`/`rejectExtraction` are server actions, not tool calls — they don't flow through the registry. No new renderer.

### 9.2 Testing (Vitest, TDD, run **serially** — `EMAXPOOLSREACHED` gotcha)

- **`confirm-mapping.test.ts`** (pure, no DB) — highest value: passport fields → leaf paths; `composeFullName` fan-in; `toIso2` happy + failure→unmapped; edited→`user_corrected` vs as-extracted→`document`; unmapped excluded; bad transform never reaches a write.
- **`approvals/repository.test.ts`** (DB) — `createPending` idempotency on the partial unique; `listPending` inbox; `resolve` transitions; PII-safe `decision` shape.
- **`confirm-extraction.action.test.ts`** (DB) — round-trip: seed doc at `awaiting_confirmation` + pending approval → confirm → assert `CaseFacts`/`Profile` leaves carry values at confidence 1.0 with correct per-field source, approval `approved`, doc `confirmed`. Reject path. Double-confirm guard (second call no-ops). The ≤2-`applyUpdate` split. **This is the plan's gate line 161** (extraction → review → confirm → case updated).
- **`extract-document.test.ts`** (extend 3A's) — the new `create-approval` step inserts a pending row; idempotent on re-delivery.
- **Schema-load test** — a typo'd `target` in YAML fails fast at load.
- **Persona suite** — must stay green; the confirm path is additive. A persona doc-flow E2E test is a 3C concern (no Documents section yet) — deferred, not forced.

### 9.3 Error handling

- Confirm value failing leaf Zod (`validateLeafValue`) → field-level form error, not 500.
- Mid-write failure → approval stays `pending`, doc stays `awaiting_confirmation`; retry is idempotent at confidence 1.0.
- Expired presigned source URL on a stale page → "Open original" re-fetches; preview shows a graceful "reload to view" fallback, not a broken image.
- Double-confirm / already-confirmed → status guard redirects, no second write.

---

## 10. New files / touched files (summary)

**New:**
- `drizzle/0004_*.sql` — `approvals` table.
- `src/lib/approvals/repository.ts` (+ types).
- `src/lib/documents/transforms.ts` — transform registry.
- `src/lib/documents/confirm-mapping.ts` — pure mapper.
- `src/app/case/[id]/documents/[docId]/review/page.tsx` — RSC review route.
- `src/app/case/[id]/documents/[docId]/review/ReviewForm.tsx` — client form.
- `src/app/case/[id]/documents/[docId]/review/actions.ts` — confirm/reject server actions.
- Tests: `confirm-mapping.test.ts`, `approvals/repository.test.ts`, `confirm-extraction.action.test.ts`, schema-load test.

**Touched:**
- `src/lib/db/schema.ts` — `approvals` table; `documents.status` enum gains `confirmed`/`rejected`.
- `src/lib/documents/types.ts` — `DocumentStatusEnum` += `confirmed`, `rejected`.
- `config/rules/documents.yaml` — `target`/`transform`/`part` on passport extraction fields.
- `src/lib/extraction/schema.ts` — load + validate `target`; expose mapping.
- `src/lib/inngest/functions/extract-document.ts` — add `create-approval` step.
- `src/components/workspace/renderers/registry.tsx` — `document_extraction_status` deep link + terminal states.
- `config/rules/` — confidence-badge thresholds (+ ISO2 lookup if not already present).

---

## 11. Non-negotiable rules honored

- **Rule 5** (single write path): case state written only via `repo.applyUpdate`.
- **Rule 7** (no hardcoded numbers): confidence thresholds + mapping in `config/rules/`.
- **Rule 9** (provenance): every confirmed leaf gets `source` (`document`/`user_corrected`), `confidence` (1.0), `sourceTurnId` (null), `updatedAt`.
- **Rule 10** (append-only): `approvals` is mutable like `documents`; the audit trail is `activity_log` rows. No UPDATE on `messages`/`activity_log`/`*_changes`.
- **Rule 12** (explicit approvals): confirm is an explicit UI gate.
- **Rule 13** (no agent awaiting background work): confirm is a UI server action, not an agent tool; the workflow stays the extraction driver.
- **PII rule**: `decision` and approval activity rows carry KEYS only; `passportNumber` masked in UI; review-route projection never leaks `r2Key`/`extracted.raw`.
