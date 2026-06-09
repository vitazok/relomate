# Phase 4A Cover Letter Drafting Design

## Scope

Phase 4A adds the first draft artifact vertical slice: **cover letter only**. It creates the
foundation that later Phase 4 slices reuse for employer letter, CV, Anabin justification, and
regeneration.

Out of scope for this slice:

- employer letter, CV, Anabin justification
- VIDEX and submission package
- scheduled reminders or email notifications
- live LLM persona evaluation
- a full standalone Drafts workspace section

## Decisions

1. **Drafts are mutable artifacts.** The `drafts` table follows the `documents` precedent: mutable
   WIP artifact row, append-only audit trail in `activity_log`. Rule 10 still applies to
   `messages`, `activity_log`, and `*_changes`, not WIP artifact rows.
2. **Cover-letter generation is background work.** `draft_cover_letter` creates a `drafting` row,
   logs `case.draft.requested`, dispatches `draft.requested`, and returns immediately with a typed
   `draft_request_result`.
3. **The Inngest handler owns generation.** `generateDraftHandler` loads the case, calls the
   `DraftGenerator`, validates output with Zod, stores content, moves the draft to
   `ready_for_review`, creates a pending `subjectType:'draft'` approval, and logs safe metadata.
4. **Review reuses the Phase 3B approval primitive.** `/case/[id]/drafts/[draftId]/review` lets the
   user edit, approve, or reject. Approval decisions log only keys/status; draft text is never
   written to `activity_log`.
5. **Tracker is the live Drafts dashboard for now.** The Drafts phase is unlocked for the cover
   letter row only. Employer letter and CV remain deferred via `comingSoon` copy.
6. **No prompt-version bump.** `prompts/agent/v0.md` gained one tool instruction, but this is not a
   generational prompt rewrite. The generated cover-letter prompt has its own
   `draft_cover_letter/v0` version.
7. **`lookup_anabin` remains last.** `draft_cover_letter` is registered before `lookup_anabin` so the
   single tool-block Anthropic cache breakpoint stays on the last tool.

## Status Model

`drafting` -> `ready_for_review` -> `approved`

Terminal alternates: `failed`, `rejected`.

Only `approved` counts complete in `computeJourneyProgress`.

## PII And Audit

Draft content can contain user facts, so activity payloads carry only:

- `draftId`
- `draftType`
- status-oriented booleans such as `edited` or `hasReason`

Approval decisions use `confirmedPaths:['draft.cover_letter.content']` and optional
`editedPaths:['draft.cover_letter.content']`. They do not store draft text.

## Follow-ups

- Add `draft_employer_letter`, `draft_cv`, and `draft_anabin_justification` on the same foundation.
- Add `regenerate_draft` with versioning semantics before allowing multiple concurrent versions.
- Consider a full Drafts route if the tracker row becomes too dense.
- Add live smoke coverage for actual Anthropic cover-letter quality after L3 eval exists.
