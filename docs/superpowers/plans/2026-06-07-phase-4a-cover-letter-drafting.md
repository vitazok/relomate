# Phase 4A Cover Letter Drafting Plan

## Goal

Generate a cover letter as a first-class draft artifact, let the user review/edit/approve it, and
surface its status in the tracker.

## Tasks

- [x] Add `drafts` Drizzle table + migration `0005_real_young_avengers.sql`.
- [x] Add `src/lib/drafting/types.ts` with Zod schemas for draft status, type, and cover-letter
  content.
- [x] Add `makeDraftRepository`.
- [x] Add `draft_cover_letter` tool returning `{type:'draft_request_result', version:1, data}`.
- [x] Add `draft.requested` Inngest event and `generateDraftHandler`.
- [x] Add `DraftGenerator` interface + Anthropic-backed cover-letter generator.
- [x] Add draft review server actions and `/case/[id]/drafts/[draftId]/review`.
- [x] Reuse `approvals` with `subjectType:'draft'`.
- [x] Unlock the Drafts tracker phase for cover letter only.
- [x] Add chat renderer for `draft_request_result`.
- [x] Update agent prompt/tool catalog while keeping `lookup_anabin` last.
- [x] Update future-agent docs.

## Verification

- `pnpm exec tsc --noEmit`
- `NODE_ENV=test node --env-file=.env.local node_modules/vitest/vitest.mjs run --no-file-parallelism tests/drafting tests/inngest/generate-draft.test.ts tests/ai/draft_cover_letter.test.ts tests/ai/agent-turn.test.ts tests/components/renderers.test.ts tests/components/tracker.test.ts tests/journey/compute.test.ts tests/journey/loader.test.ts`

## Deferred

- Full Phase 4 document set: employer letter, CV, Anabin justification.
- Regeneration and multi-version draft history.
- Package completeness gate that checks every required draft.
- Live generated-content quality eval.
