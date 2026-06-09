# Persona Library — Design Spec

**Date:** 2026-05-27
**Status:** Draft, awaiting review
**Owner:** Vitalii
**Related:** PRD §11 (Multi-Persona Test Library), PRD §12.2 (End-to-end persona tests), CLAUDE.md "Persona testing"

---

## 1. Purpose

Ship a small, named, hand-crafted set of test personas for Visa. Each persona is a synthetic Indian Blue Card applicant with enough structured detail to (a) drive the deterministic eligibility engine, (b) seed dev/demo state, and (c) pin regression baselines as the rules YAML evolves.

This spec is deliberately **trimmed** from PRD §11. PRD lists 10 full personas (each with mock documents and scripted intake conversations) as an MVP deliverable. The system that consumes documents and conversations does not yet exist (Phases 3–5). Building all 10 to full depth before Phase 1 front-loads work the system can't exercise.

This round delivers **4 thin archetype personas** chosen for maximum rules-engine branch coverage. The remaining 6 personas, mock documents, and scripted intake conversations are deferred to the phases that exercise them.

## 2. Non-goals

- Mock documents (PDFs, images) — deferred to Phase 3 alongside document extraction.
- Scripted intake conversations — deferred to Phase 2 once the agent loop exists.
- The other 6 personas from PRD §11 (`meera-strong-clean`, `rahul-recent-grad`, `kavya-distance-learning`, `out-of-scope-eu-citizen`, `out-of-scope-criminal`, `renewal-priya-y2`) — added in Phase 2 as the agent + intake come online.
- Property-based eligibility tests — a complementary harness; tracked as a separate spec under "Follow-ups."
- Provenance wrapping (`{value, source, confidence, sourceTurnId, updatedAt}` per PRD §4.3) — applied at load time by the seed loader, not stored in persona files.

## 3. Personas in scope

Four personas, each targeting a distinct rules-engine branch:

| Persona id | Branch covered | Why it earns its slot |
|---|---|---|
| `priya-strong` | Shortage-occupation route (§18b + shortage list) | Strongest happy path; exercises ISCO prefix matching and the lower shortage threshold. |
| `arjun-it-no-degree` | IT specialist route (§18g(2)) | Only persona that exercises the no-degree, experience-based branch. |
| `vikram-edge-anabin` | Anabin fallback / refusal-to-conclude | Forces the engine to refuse a verdict when degree status is `unknown`. Confirms the seed-default invariant. |
| `out-of-scope-asylum` | Off-scope refusal | Confirms the engine refuses to evaluate Blue Card rules for off-scope visa types. |

The 6 deferred personas each cover a route already represented (standard, recent-grad, edge cases) or require infrastructure that does not yet exist (renewal flow, distance-learning detection). They are tracked in §10.

## 4. File shape

### 4.1 Location

`data/personas/<id>.json` — one file per persona, `<id>` matching the `id` field.

### 4.2 Structure

Each persona is a single JSON document with five top-level keys:

```jsonc
{
  "id": "<kebab-case identifier matching the filename>",
  "description": "<one-line human-readable purpose>",
  "profile": { /* user-level identity facts; mirrors profiles.data per PRD §4.2 */ },
  "caseFacts": { /* case-specific structured state; mirrors case_facts.data per PRD §4.2 */ },
  "expected": { /* asserted eligibility outcome */ }
}
```

Field names match PRD §4.2 entities so the seed loader (Phase 1) writes them straight into the corresponding JSONB columns.

### 4.3 Profile shape

```jsonc
"profile": {
  "fullName": "string",
  "dateOfBirth": "YYYY-MM-DD",
  "nationality": "ISO-3166-1 alpha-2 (e.g. 'IN')",
  "passportNumber": "string",
  "passportExpiry": "YYYY-MM-DD",
  "currentAddress": {
    "line1": "string",
    "city": "string",
    "state": "string",
    "country": "ISO-3166-1 alpha-2",
    "postalCode": "string"
  }
}
```

### 4.4 CaseFacts shape

```jsonc
"caseFacts": {
  "education": {
    "highestDegree": "string | null",        // e.g. 'M.Tech', 'B.Sc'; null for arjun-it-no-degree
    "fieldOfStudy": "string | null",
    "institution": "string | null",
    "completionYear": "number | null",
    "anabinStatus": "'H+' | 'H-' | 'H+-' | 'unknown' | null",
    "modeOfStudy": "'full_time' | 'part_time' | 'distance' | null"
  },
  "employment": {
    "employerName": "string",
    "employerCity": "string",
    "jobTitle": "string",
    "iscoCode": "string",                    // ISCO-08, prefix-matchable
    "annualGrossSalaryEur": "number",        // explicit unit in name
    "contractType": "'permanent' | 'fixed_term' | 'freelance'",
    "contractStartDate": "YYYY-MM-DD",
    "priorExperienceYears": "number | null"  // used by IT-no-degree branch
  },
  "family": {
    "maritalStatus": "'single' | 'married' | 'divorced' | 'widowed'",
    "spouse": "{ fullName, dateOfBirth, nationality } | null",
    "children": "Array<{ fullName, dateOfBirth, nationality }>"
  },
  "target": {
    "consulate": "string",                   // e.g. 'bengaluru'
    "moveDate": "YYYY-MM-DD | null",
    "visaType": "'blue_card' | 'asylum' | 'family_reunion' | 'student' | 'job_seeker' | 'other'"  // off-scope values supported; closed union, expand as needed
  }
}
```

### 4.5 Expected block

```jsonc
"expected": {
  "outOfScope": "boolean",
  "eligible": "boolean",
  "route": "'standard' | 'shortage_occupation' | 'recent_graduate' | 'it_no_degree' | null",  // matches Verdict.eligibilityRoute in Nomad's engine
  "blockers": "string[]",                    // structured codes, e.g. 'anabin_status_unknown'
  "warnings": "string[]",
  "reason": "string | null"                  // optional, used for outOfScope cases
}
```

## 5. The four personas — content plan

Field values below are the agreed content for each persona. Salary numbers marked **(VERIFY)** must be reconciled against `config/rules/blue-card.yaml` when Nomad's rules are ported in Phase 1.

### 5.1 `priya-strong`

**Inputs that matter:**
- 33-year-old Indian national; M.Tech CS from IIT Bombay; Anabin H+; full-time
- Senior SWE at Acme GmbH Munich; ISCO `2512` (on shortage list)
- Annual gross salary **€48,500** (above 2026 reduced threshold of €45,934.20 from `blue-card.yaml`, applies to shortage_occupation route)
- Permanent contract, start 2026-09-01
- Married, one child age 5
- Target consulate Bengaluru, move 2026-10-01

**Expected:**
```json
{ "outOfScope": false, "eligible": true, "route": "shortage_occupation", "blockers": [], "warnings": [], "reason": null }
```

### 5.2 `arjun-it-no-degree`

**Inputs that matter:**
- 31-year-old Indian national; `highestDegree: null`
- 5+ years documented IT experience (`priorExperienceYears: 5`)
- Senior DevOps at a Berlin company; ISCO `2522` (Systems administrators)
- Annual gross salary **€52,000** (above 2026 reduced threshold of €45,934.20 — IT-no-degree uses the same reduced threshold per `blue-card.yaml`)
- Permanent contract
- Single
- Target consulate Bengaluru

**Expected:**
```json
{
  "outOfScope": false,
  "eligible": true,
  "route": "it_no_degree",
  "blockers": [],
  "warnings": ["proof_of_experience_required"],
  "reason": null
}
```

The `proof_of_experience_required` warning is non-blocking; it surfaces in Phase 3 as a documents requirement.

### 5.3 `vikram-edge-anabin`

**Inputs that matter:**
- 29-year-old Indian national; B.Tech from a non-H+ institution; `anabinStatus: "unknown"` (matches Nomad seed default per CLAUDE.md)
- Junior SWE in Hamburg; ISCO `2512`; salary €50,000
- Permanent contract
- Single
- Target consulate Bengaluru

**Expected:**
```json
{
  "outOfScope": false,
  "eligible": false,
  "route": null,
  "blockers": ["anabin_status_unknown"],
  "warnings": ["zab_statement_required", "consulate_clarification_recommended"],
  "reason": null
}
```

The engine refuses to issue a verdict until ZAB confirms degree comparability. This is the persona that would break if the Anabin seed defaulted to `H+`.

### 5.4 `out-of-scope-asylum`

**Inputs that matter:**
- 28-year-old Syrian national (off-scope reason here is asylum, not nationality — the library is not Indian-only)
- `caseFacts.target.visaType: "asylum"`
- Other fields minimal/null

**Expected:**
```json
{
  "outOfScope": true,
  "eligible": false,
  "route": null,
  "blockers": [],
  "warnings": [],
  "reason": "asylum"
}
```

The engine returns `outOfScope: true` rather than evaluating Blue Card rules. This is the contract the `out_of_scope` agent tool will rely on later.

## 6. Validation contract

### 6.1 Zod schema

Phase 1 introduces `data/personas/schema.ts` exporting `PersonaSchema` covering the structure in §4. Until Phase 1 lands, the schema lives only in this spec.

CI (Phase 1+) loads every JSON file under `data/personas/*.json` at build time and parses it. Any drift between schema and data fails the build. This is the mechanism that keeps personas honest as the schema evolves.

### 6.2 Eligibility test

`tests/personas/eligibility.test.ts` runs once per persona:

```ts
describe.each(loadPersonas())('persona: %s', (persona) => {
  const today = new Date('2026-05-27');
  const verdict = evaluateEligibility(
    { profile: persona.profile, caseFacts: persona.caseFacts },
    today,
  );

  it('matches expected outOfScope', () => {
    expect(verdict.outOfScope).toBe(persona.expected.outOfScope);
  });
  it('matches expected route', () => {
    expect(verdict.route).toBe(persona.expected.route);
  });
  it('matches expected eligible', () => {
    expect(verdict.eligible).toBe(persona.expected.eligible);
  });
  it('matches expected blockers', () => {
    expect(verdict.blockers.sort()).toEqual(persona.expected.blockers.sort());
  });
});
```

`evaluateEligibility` is the pure function ported from Nomad in Phase 1 (`src/lib/rules/eligibility.ts`). The test pins `today` because the engine is `(case, today) => verdict` per CLAUDE.md.

Until Phase 1 lands and `evaluateEligibility` is real, the test file is committed with `describe.skip` and a TODO referencing Phase 1's verification gate.

### 6.3 Schema-driven design

The shapes in §4.3 and §4.4 are the **first concrete sketch of Profile and CaseFacts**. Phase 1 hardens them (provenance wrapper at load time, exact Zod shapes, optional fields tightened). The persona structure here is the source of truth that Phase 1 conforms to — schema follows fixtures, not the reverse.

## 7. Loading

The seed loader (Phase 1, `src/lib/case/seed.ts`) reads a persona JSON, wraps each leaf field with the provenance wrapper (`source: 'system'`, `confidence: 1.0`, `sourceTurnId: null`, `updatedAt: now`), and writes to `profiles.data` and `case_facts.data`. The `expected` block is not persisted — it's read only by tests.

Trigger: `/case/new?persona=<id>` URL parameter on case creation, per PRD §6.3 / §11.

## 8. Risks and open verifications

Reconciled against Nomad's `config/rules/blue-card.yaml`, `shortage-occupations.yaml`, and `src/lib/profile/eligibility.ts`:

- **Salary thresholds (resolved).** 2026 standard threshold is €50,700; reduced threshold (shortage / recent-graduate / IT-no-degree) is €45,934.20. Persona salaries (€48,500 and €52,000) sit above the reduced threshold. No further verification needed unless thresholds change.
- **Route name strings (resolved).** Verdict route enum is `'standard' | 'shortage_occupation' | 'recent_graduate' | 'it_no_degree' | null` per Nomad engine.
- **ISCO shortage-list membership (resolved).** `shortage-occupations.yaml` group `25` covers ICT professionals; ISCO `2512` (priya) and `2522` (arjun) both match. arjun's ISCO group `25` also satisfies `itNoDegreeRule.iscoGroups: ['133', '25']`.
- **IT-no-degree experience requirement (resolved).** Rule requires `minYearsExperience: 3` within last 7 years. arjun has `priorExperienceYears: 5`. Confirms eligibility on this route.
- **`anabinStatus: "unknown"` semantics (open).** CLAUDE.md says this is the seed default and the engine treats it as "we don't know yet." vikram's expected verdict relies on it. The exact blocker / warning string codes the engine emits (e.g. `anabin_status_unknown`, `zab_statement_required`) need confirmation against the engine's actual output strings during Phase 1 — if codes differ, vikram's `expected.blockers` and `expected.warnings` adjust to match.
- **arjun's `proof_of_experience_required` warning (open).** Same caveat: the exact string code emitted by the engine for "experience documentation needed" is to be confirmed in Phase 1.

If open items mismatch when Phase 1 ports the rules, the affected `expected` blocks update — input fields stay as designed.

## 9. Acceptance criteria

- [ ] Four JSON files exist at `data/personas/{priya-strong,arjun-it-no-degree,vikram-edge-anabin,out-of-scope-asylum}.json` matching the structure in §4 and the content in §5.
- [ ] All four files parse against the Zod `PersonaSchema` (Phase 1 verification).
- [ ] `tests/personas/eligibility.test.ts` exists and is committed with `describe.skip` and a TODO referencing Phase 1's verification gate.
- [ ] §8 verifications resolved during Phase 1 rules port; persona files updated if numbers shift.
- [ ] No mock documents, scripted conversations, or provenance wrapping in this round.

## 10. Follow-ups

- **Property-based eligibility tests** — a generator producing valid `Case` shapes plus invariant assertions. Complements personas. Separate spec.
- **Phase 2 persona expansion** — add the remaining 6 personas (`meera-strong-clean`, `rahul-recent-grad`, `kavya-distance-learning`, `out-of-scope-eu-citizen`, `out-of-scope-criminal`, `renewal-priya-y2`). Same shape as the four here.
- **Phase 2 scripted intake conversations** — add an optional `intake` field to personas with a turn-by-turn user-message script the agent processes.
- **Phase 3 mock documents** — add a `documents/<persona-id>/` directory with passport, employer letter, etc. Hooks into document extraction.
