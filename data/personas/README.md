# Persona Library

Synthetic test personas for Visa. Each JSON file is a standalone case seed:
profile + case facts + expected eligibility verdict.

## File shape

Per `docs/archive/specs/2026-05-27-persona-library-design.md` §4:

- `id` — kebab-case identifier matching the filename (without `.json`).
- `description` — one-line human-readable purpose.
- `profile` — user-level identity facts; mirrors `profiles.data` (PRD §4.2).
- `caseFacts` — case-specific structured state; mirrors `case_facts.data`.
- `expected` — asserted eligibility outcome, consumed by `tests/personas/eligibility.test.ts` (added in Phase 1).

## Currently shipped (4 of 10)

| File | Purpose | Rules-engine branch |
|---|---|---|
| `priya-strong.json` | Indian SWE, M.Tech, €48,500, shortage route. Happy path. | `shortage_occupation` |
| `arjun-it-no-degree.json` | IT specialist, no degree, 5y experience, €52,000. | `it_no_degree` |
| `vikram-edge-anabin.json` | Degree from non-H+ institution; refusal-to-conclude. | None — `anabin_status_unknown` blocker |
| `out-of-scope-asylum.json` | Asylum case; off-scope refusal. | None — `outOfScope: true` |

The remaining 6 personas (`meera-strong-clean`, `rahul-recent-grad`,
`kavya-distance-learning`, `out-of-scope-eu-citizen`, `out-of-scope-criminal`,
`renewal-priya-y2`) are deferred to Phase 2 per the spec.

## Loading

Phase 1 introduces `/case/new?persona=<id>` URL parameter that calls the seed
loader to write `profile` and `caseFacts` into the database (with provenance
wrapping applied at load time). The `expected` block is not persisted; it is
read only by tests.
