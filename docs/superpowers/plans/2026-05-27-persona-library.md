# Persona Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 4 thin archetype persona JSON files at `data/personas/` covering distinct rules-engine branches (shortage-occupation, IT-no-degree, Anabin fallback, off-scope), per the trimmed scope in `docs/superpowers/specs/2026-05-27-persona-library-design.md`.

**Architecture:** Pure data files. No code in this plan. Each JSON document conforms to a structure that mirrors PRD §4.2 entities (`profile` ↔ `profiles.data`, `caseFacts` ↔ `case_facts.data`) plus an `expected` block carrying the asserted eligibility outcome. The Zod schema enforcing this shape and the Vitest persona test that consumes it are **out of scope for this plan** — they're owned by Phase 1 (`IMPLEMENTATION_PLAN.md`) once Node/TS/Vitest are scaffolded.

**Tech Stack:** JSON only.

**Pre-flight context (must read before starting):**
- `docs/superpowers/specs/2026-05-27-persona-library-design.md` — the design spec this plan implements; sections referenced here (§3, §4, §5, §8) are in that file.
- `CLAUDE.md` — note the persona-library section and the rule against hardcoded thresholds in code/prompts (personas are data, so they may carry numbers).
- `PRD.md` §4.2, §11 — entity definitions and the canonical persona list.

**Verification ground truth:** Salary thresholds, route names, and ISCO shortage groups in this plan come from `/Users/vitalii.kashin/Projects/nomad/config/rules/blue-card.yaml`, `shortage-occupations.yaml`, and `src/lib/profile/eligibility.ts` (Nomad source). They have been reconciled — do not deviate without re-checking those files.

---

## File Structure

Files created by this plan (all under `/Users/vitalii.kashin/Projects/visa/`):

| File | Responsibility |
|---|---|
| `data/personas/priya-strong.json` | Shortage-occupation route happy path. |
| `data/personas/arjun-it-no-degree.json` | §18g(2) IT-specialist route. |
| `data/personas/vikram-edge-anabin.json` | Anabin-unknown refusal-to-conclude branch. |
| `data/personas/out-of-scope-asylum.json` | Off-scope refusal branch. |
| `data/personas/README.md` | One-page reference: file shape, links to spec §4 and §5, list of currently-shipped personas with one-line descriptions. |

No code files. The Zod schema (`data/personas/schema.ts`) and persona eligibility test (`tests/personas/eligibility.test.ts`) are explicitly deferred to Phase 1 of `IMPLEMENTATION_PLAN.md`.

---

## Task 1: Create the personas directory and stub README

**Files:**
- Create: `data/personas/README.md`

- [ ] **Step 1: Confirm the project root and create the directory**

```bash
test -f /Users/vitalii.kashin/Projects/visa/CLAUDE.md && echo "root OK"
mkdir -p /Users/vitalii.kashin/Projects/visa/data/personas
ls /Users/vitalii.kashin/Projects/visa/data/personas
```
Expected: prints `root OK`, then creates the directory, then lists it (empty).

- [ ] **Step 2: Write the README**

Write to `/Users/vitalii.kashin/Projects/visa/data/personas/README.md`:

```markdown
# Persona Library

Synthetic test personas for Visa. Each JSON file is a standalone case seed:
profile + case facts + expected eligibility verdict.

## File shape

Per `docs/superpowers/specs/2026-05-27-persona-library-design.md` §4:

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
```

- [ ] **Step 3: Verify the file is correct**

```bash
cat /Users/vitalii.kashin/Projects/visa/data/personas/README.md | head -20
```
Expected: prints the README starting with `# Persona Library`.

- [ ] **Step 4: Commit**

The repository is **not yet a git repo** (Phase 0). Skip the commit step; this plan ships uncommitted files that will be picked up by Phase 1's `git init` and included in the first commit. Add a note to your task tracker that these files exist outside version control until then.

---

## Task 2: Create `priya-strong.json`

**Files:**
- Create: `data/personas/priya-strong.json`

**Why this persona:** Hits the shortage-occupation route. ISCO `2512` matches `shortage-occupations.yaml` group `25` (ICT professionals). Salary €48,500 is above the 2026 reduced threshold (€45,934.20 from `blue-card.yaml`) which applies to shortage-route cases.

- [ ] **Step 1: Write the file**

Write to `/Users/vitalii.kashin/Projects/visa/data/personas/priya-strong.json`:

```json
{
  "id": "priya-strong",
  "description": "Indian SWE, M.Tech CS from IIT Bombay (Anabin H+), salary €48,500, shortage-occupation route. Married, one child. Happy-path exemplar.",
  "profile": {
    "fullName": "Priya Sharma",
    "dateOfBirth": "1992-03-14",
    "nationality": "IN",
    "passportNumber": "M1234567",
    "passportExpiry": "2031-08-22",
    "currentAddress": {
      "line1": "Flat 4B, 12th Cross, Indiranagar",
      "city": "Bengaluru",
      "state": "Karnataka",
      "country": "IN",
      "postalCode": "560038"
    }
  },
  "caseFacts": {
    "education": {
      "highestDegree": "M.Tech",
      "fieldOfStudy": "Computer Science",
      "institution": "IIT Bombay",
      "completionYear": 2016,
      "anabinStatus": "H+",
      "modeOfStudy": "full_time"
    },
    "employment": {
      "employerName": "Acme GmbH",
      "employerCity": "Munich",
      "jobTitle": "Senior Software Engineer",
      "iscoCode": "2512",
      "annualGrossSalaryEur": 48500,
      "contractType": "permanent",
      "contractStartDate": "2026-09-01",
      "priorExperienceYears": 8
    },
    "family": {
      "maritalStatus": "married",
      "spouse": {
        "fullName": "Arun Sharma",
        "dateOfBirth": "1990-07-02",
        "nationality": "IN"
      },
      "children": [
        {
          "fullName": "Anaya Sharma",
          "dateOfBirth": "2020-11-15",
          "nationality": "IN"
        }
      ]
    },
    "target": {
      "consulate": "bengaluru",
      "moveDate": "2026-10-01",
      "visaType": "blue_card"
    }
  },
  "expected": {
    "outOfScope": false,
    "eligible": true,
    "route": "shortage_occupation",
    "blockers": [],
    "warnings": [],
    "reason": null
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

```bash
python3 -c "import json; json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/priya-strong.json'))" && echo "valid JSON"
```
Expected: prints `valid JSON`.

- [ ] **Step 3: Verify field names match the spec**

```bash
python3 -c "
import json
d = json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/priya-strong.json'))
required = {
  'top':       ['id','description','profile','caseFacts','expected'],
  'profile':   ['fullName','dateOfBirth','nationality','passportNumber','passportExpiry','currentAddress'],
  'caseFacts': ['education','employment','family','target'],
  'expected':  ['outOfScope','eligible','route','blockers','warnings','reason'],
}
for k in required['top']: assert k in d, f'missing top.{k}'
for k in required['profile']: assert k in d['profile'], f'missing profile.{k}'
for k in required['caseFacts']: assert k in d['caseFacts'], f'missing caseFacts.{k}'
for k in required['expected']: assert k in d['expected'], f'missing expected.{k}'
assert d['id'] == 'priya-strong', 'id mismatch'
print('schema OK')
"
```
Expected: prints `schema OK`.

- [ ] **Step 4: Commit**

Skip — repo not yet initialized. See Task 1 step 4.

---

## Task 3: Create `arjun-it-no-degree.json`

**Files:**
- Create: `data/personas/arjun-it-no-degree.json`

**Why this persona:** Hits §18g(2) IT-no-degree route. `itNoDegreeRule` in `blue-card.yaml` requires `iscoGroups: ['133', '25']` and `minYearsExperience: 3` within the last 7 years. Arjun has ISCO `2522` (group `25`) and 5 years experience. Salary €52,000 is above the reduced threshold (€45,934.20). `highestDegree: null` is what differentiates this persona from priya — it forces the engine onto the experience-based route.

- [ ] **Step 1: Write the file**

Write to `/Users/vitalii.kashin/Projects/visa/data/personas/arjun-it-no-degree.json`:

```json
{
  "id": "arjun-it-no-degree",
  "description": "Indian DevOps engineer, no formal degree, 5 years documented experience, salary €52,000. Tests §18g(2) IT-specialist route.",
  "profile": {
    "fullName": "Arjun Patel",
    "dateOfBirth": "1994-09-11",
    "nationality": "IN",
    "passportNumber": "P7654321",
    "passportExpiry": "2030-04-10",
    "currentAddress": {
      "line1": "27 MG Road",
      "city": "Pune",
      "state": "Maharashtra",
      "country": "IN",
      "postalCode": "411001"
    }
  },
  "caseFacts": {
    "education": {
      "highestDegree": null,
      "fieldOfStudy": null,
      "institution": null,
      "completionYear": null,
      "anabinStatus": null,
      "modeOfStudy": null
    },
    "employment": {
      "employerName": "Beispiel Cloud GmbH",
      "employerCity": "Berlin",
      "jobTitle": "Senior DevOps Engineer",
      "iscoCode": "2522",
      "annualGrossSalaryEur": 52000,
      "contractType": "permanent",
      "contractStartDate": "2026-11-01",
      "priorExperienceYears": 5
    },
    "family": {
      "maritalStatus": "single",
      "spouse": null,
      "children": []
    },
    "target": {
      "consulate": "bengaluru",
      "moveDate": "2026-12-01",
      "visaType": "blue_card"
    }
  },
  "expected": {
    "outOfScope": false,
    "eligible": true,
    "route": "it_no_degree",
    "blockers": [],
    "warnings": ["proof_of_experience_required"],
    "reason": null
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

```bash
python3 -c "import json; json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/arjun-it-no-degree.json'))" && echo "valid JSON"
```
Expected: prints `valid JSON`.

- [ ] **Step 3: Verify the no-degree invariant**

```bash
python3 -c "
import json
d = json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/arjun-it-no-degree.json'))
assert d['caseFacts']['education']['highestDegree'] is None, 'highestDegree must be null for IT-no-degree route'
assert d['caseFacts']['employment']['priorExperienceYears'] >= 3, 'must satisfy minYearsExperience: 3'
assert d['caseFacts']['employment']['iscoCode'].startswith(('25','133')), 'must match itNoDegreeRule.iscoGroups'
assert d['caseFacts']['employment']['annualGrossSalaryEur'] >= 45935, 'must be at or above 2026 reduced threshold'
assert d['expected']['route'] == 'it_no_degree', \"route must match Verdict enum 'it_no_degree' (not 'it_specialist_no_degree')\"
print('invariants OK')
"
```
Expected: prints `invariants OK`.

- [ ] **Step 4: Commit**

Skip — repo not yet initialized.

---

## Task 4: Create `vikram-edge-anabin.json`

**Files:**
- Create: `data/personas/vikram-edge-anabin.json`

**Why this persona:** Forces the engine to refuse a verdict because degree comparability is unresolved. Per CLAUDE.md, the Anabin seed defaults to `'unknown'` (not `'H+'`); this persona is the regression guard for that invariant. Phase 1 will confirm the exact blocker / warning string codes — see spec §8 open items.

- [ ] **Step 1: Write the file**

Write to `/Users/vitalii.kashin/Projects/visa/data/personas/vikram-edge-anabin.json`:

```json
{
  "id": "vikram-edge-anabin",
  "description": "Indian SWE, B.Tech from a non-H+ institution (Anabin status unknown). Forces lookup_anabin + ZAB clarification. Engine refuses to issue a verdict.",
  "profile": {
    "fullName": "Vikram Reddy",
    "dateOfBirth": "1996-01-22",
    "nationality": "IN",
    "passportNumber": "Z1029384",
    "passportExpiry": "2032-02-14",
    "currentAddress": {
      "line1": "8-2-293, Jubilee Hills",
      "city": "Hyderabad",
      "state": "Telangana",
      "country": "IN",
      "postalCode": "500033"
    }
  },
  "caseFacts": {
    "education": {
      "highestDegree": "B.Tech",
      "fieldOfStudy": "Information Technology",
      "institution": "XYZ Engineering College",
      "completionYear": 2018,
      "anabinStatus": "unknown",
      "modeOfStudy": "full_time"
    },
    "employment": {
      "employerName": "Hanseatische Software AG",
      "employerCity": "Hamburg",
      "jobTitle": "Software Engineer",
      "iscoCode": "2512",
      "annualGrossSalaryEur": 50000,
      "contractType": "permanent",
      "contractStartDate": "2026-10-15",
      "priorExperienceYears": 4
    },
    "family": {
      "maritalStatus": "single",
      "spouse": null,
      "children": []
    },
    "target": {
      "consulate": "bengaluru",
      "moveDate": "2026-11-01",
      "visaType": "blue_card"
    }
  },
  "expected": {
    "outOfScope": false,
    "eligible": false,
    "route": null,
    "blockers": ["anabin_status_unknown"],
    "warnings": ["zab_statement_required", "consulate_clarification_recommended"],
    "reason": null
  }
}
```

- [ ] **Step 2: Verify it parses as JSON**

```bash
python3 -c "import json; json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/vikram-edge-anabin.json'))" && echo "valid JSON"
```
Expected: prints `valid JSON`.

- [ ] **Step 3: Verify the unresolved-degree invariant**

```bash
python3 -c "
import json
d = json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/vikram-edge-anabin.json'))
assert d['caseFacts']['education']['anabinStatus'] == 'unknown', \"anabinStatus must be 'unknown' (not 'H+') to test the seed-default invariant\"
assert d['expected']['eligible'] is False
assert d['expected']['route'] is None
assert 'anabin_status_unknown' in d['expected']['blockers']
print('invariants OK')
"
```
Expected: prints `invariants OK`.

- [ ] **Step 4: Commit**

Skip — repo not yet initialized.

---

## Task 5: Create `out-of-scope-asylum.json`

**Files:**
- Create: `data/personas/out-of-scope-asylum.json`

**Why this persona:** Confirms the eligibility engine returns `outOfScope: true` rather than evaluating Blue Card rules for a non-Blue-Card visa type. The agent's `out_of_scope` tool will rely on this contract.

- [ ] **Step 1: Write the file**

Write to `/Users/vitalii.kashin/Projects/visa/data/personas/out-of-scope-asylum.json`:

```json
{
  "id": "out-of-scope-asylum",
  "description": "Syrian national asking about asylum, not Blue Card. Confirms the engine refuses to evaluate Blue Card rules for off-scope visa types.",
  "profile": {
    "fullName": "Layla Haddad",
    "dateOfBirth": "1998-06-30",
    "nationality": "SY",
    "passportNumber": "S5544332",
    "passportExpiry": "2029-03-18",
    "currentAddress": {
      "line1": "Unknown",
      "city": "Damascus",
      "state": "Damascus",
      "country": "SY",
      "postalCode": "00000"
    }
  },
  "caseFacts": {
    "education": {
      "highestDegree": null,
      "fieldOfStudy": null,
      "institution": null,
      "completionYear": null,
      "anabinStatus": null,
      "modeOfStudy": null
    },
    "employment": {
      "employerName": "",
      "employerCity": "",
      "jobTitle": "",
      "iscoCode": "",
      "annualGrossSalaryEur": 0,
      "contractType": "permanent",
      "contractStartDate": "1970-01-01",
      "priorExperienceYears": null
    },
    "family": {
      "maritalStatus": "single",
      "spouse": null,
      "children": []
    },
    "target": {
      "consulate": "bengaluru",
      "moveDate": null,
      "visaType": "asylum"
    }
  },
  "expected": {
    "outOfScope": true,
    "eligible": false,
    "route": null,
    "blockers": [],
    "warnings": [],
    "reason": "asylum"
  }
}
```

Note on the placeholder employment block: the schema currently requires every employment field. The off-scope persona has no real employment data, but we keep the keys present with empty/zero values so it parses against the same schema as the other personas. Phase 1's hardened Zod schema may relax this with `.nullable()` on the employment block; if so, this persona's employment block flips to `null` at that point. Tracked in spec §8.

- [ ] **Step 2: Verify it parses as JSON**

```bash
python3 -c "import json; json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/out-of-scope-asylum.json'))" && echo "valid JSON"
```
Expected: prints `valid JSON`.

- [ ] **Step 3: Verify the off-scope invariant**

```bash
python3 -c "
import json
d = json.load(open('/Users/vitalii.kashin/Projects/visa/data/personas/out-of-scope-asylum.json'))
assert d['caseFacts']['target']['visaType'] != 'blue_card', 'visaType must not be blue_card for an off-scope persona'
assert d['expected']['outOfScope'] is True
assert d['expected']['route'] is None
assert d['expected']['reason'] == 'asylum'
print('invariants OK')
"
```
Expected: prints `invariants OK`.

- [ ] **Step 4: Commit**

Skip — repo not yet initialized.

---

## Task 6: Cross-persona validation

**Files:** none modified. Pure verification step.

- [ ] **Step 1: Confirm all 4 persona files exist and parse**

```bash
ls /Users/vitalii.kashin/Projects/visa/data/personas/*.json
python3 -c "
import json, glob
files = sorted(glob.glob('/Users/vitalii.kashin/Projects/visa/data/personas/*.json'))
expected_ids = {'priya-strong','arjun-it-no-degree','vikram-edge-anabin','out-of-scope-asylum'}
got_ids = set()
for f in files:
    d = json.load(open(f))
    got_ids.add(d['id'])
    fname = f.split('/')[-1].replace('.json','')
    assert d['id'] == fname, f'id {d[\"id\"]} does not match filename {fname}'
assert got_ids == expected_ids, f'expected {expected_ids}, got {got_ids}'
print(f'all {len(files)} personas valid, ids match filenames')
"
```
Expected: lists 4 files, prints `all 4 personas valid, ids match filenames`.

- [ ] **Step 2: Confirm structural uniformity**

```bash
python3 -c "
import json, glob
files = sorted(glob.glob('/Users/vitalii.kashin/Projects/visa/data/personas/*.json'))
required_top = {'id','description','profile','caseFacts','expected'}
required_profile = {'fullName','dateOfBirth','nationality','passportNumber','passportExpiry','currentAddress'}
required_casefacts = {'education','employment','family','target'}
required_expected = {'outOfScope','eligible','route','blockers','warnings','reason'}
for f in files:
    d = json.load(open(f))
    assert set(d.keys()) == required_top, f'{f}: top-level keys {set(d.keys())}'
    assert set(d['profile'].keys()) == required_profile, f'{f}: profile keys {set(d[\"profile\"].keys())}'
    assert set(d['caseFacts'].keys()) == required_casefacts, f'{f}: caseFacts keys {set(d[\"caseFacts\"].keys())}'
    assert set(d['expected'].keys()) == required_expected, f'{f}: expected keys {set(d[\"expected\"].keys())}'
print('structural uniformity OK across all personas')
"
```
Expected: prints `structural uniformity OK across all personas`.

- [ ] **Step 3: Confirm route coverage**

```bash
python3 -c "
import json, glob
files = sorted(glob.glob('/Users/vitalii.kashin/Projects/visa/data/personas/*.json'))
buckets = {'with_route': [], 'in_scope_no_route': [], 'out_of_scope': []}
for f in files:
    d = json.load(open(f))
    pid = d['id']
    if d['expected']['outOfScope']:
        buckets['out_of_scope'].append(pid)
    elif d['expected']['route'] is None:
        buckets['in_scope_no_route'].append(pid)
    else:
        buckets['with_route'].append((pid, d['expected']['route']))
routes_seen = sorted(r for _, r in buckets['with_route'])
assert routes_seen == ['it_no_degree','shortage_occupation'], f'unexpected route set {routes_seen}'
assert buckets['in_scope_no_route'] == ['vikram-edge-anabin'], f\"expected vikram only, got {buckets['in_scope_no_route']}\"
assert buckets['out_of_scope'] == ['out-of-scope-asylum'], f\"expected asylum only, got {buckets['out_of_scope']}\"
print('route coverage OK:', buckets)
"
```
Expected: prints `route coverage OK: {'with_route': [('arjun-it-no-degree', 'it_no_degree'), ('priya-strong', 'shortage_occupation')], 'in_scope_no_route': ['vikram-edge-anabin'], 'out_of_scope': ['out-of-scope-asylum']}`.

- [ ] **Step 4: Update task tracker**

Add a follow-up note for Phase 1 implementation:

> **Phase 1 follow-up:** Create `data/personas/schema.ts` (Zod) and `tests/personas/eligibility.test.ts` (Vitest, initially `describe.skip`) per spec §6. After porting Nomad's `evaluateEligibility`, unskip the test and resolve the open verifications in spec §8 (Anabin status blocker code, IT-no-degree warning code).

- [ ] **Step 5: Commit**

Skip — repo not yet initialized. All 5 files (4 personas + README) ship together as part of the first commit when Phase 1 runs `git init`.

---

## Acceptance criteria (per spec §9)

After all 6 tasks, this plan satisfies the spec's acceptance criteria as follows:

- [x] **Four JSON files exist** at `data/personas/{priya-strong,arjun-it-no-degree,vikram-edge-anabin,out-of-scope-asylum}.json` (Tasks 2–5).
- [ ] **All four files parse against the Zod schema.** Deferred to Phase 1 — schema does not yet exist. Structural uniformity is verified in Task 6 step 2 as a pre-Phase-1 substitute.
- [ ] **`tests/personas/eligibility.test.ts` exists with `describe.skip`.** Deferred to Phase 1 — Vitest is not yet scaffolded.
- [ ] **§8 verifications resolved.** Most reconciled in spec already; remaining (Anabin blocker code, IT-no-degree warning code) deferred to Phase 1.
- [x] **No mock documents, scripted conversations, or provenance wrapping in this round.**

The deferred items are explicitly handed off to Phase 1 of `IMPLEMENTATION_PLAN.md` and tracked in Task 6 step 4.
