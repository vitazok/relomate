# Firm-First Pivot Decision

**Date:** 2026-06-08  
**Status:** Accepted product direction; code migration started in Phase 4C-F.  
**Scope:** Preserve the Germany Blue Card MVP and the existing automation core, but pivot the product from applicant-first to firm-first.

---

## Decision

Relomate is pivoting from an applicant-owned Blue Card preparation workspace to a firm-owned immigration operating system for consultancies, relocation agencies, and law-firm immigration teams.

The MVP visa remains **Germany EU Blue Card**. The MVP source/consulate matrix expands from:

- India source -> German Consulate General Bengaluru

to:

- India source -> German Consulate General Bengaluru
- Canada source/residence -> German Consulate General Toronto

Canada/Toronto is included so the product can be tested with people who applied from Canada. Canada-specific rules and checklist content must be verified from official German Missions in Canada sources before being treated as production-ready.

---

## What Stays

- **Single agent, many typed tools.** No multi-agent authority over case state.
- **Inngest for durable workflows.** Use it for extraction, generation, reminders, approval waits, SLA monitors, and package jobs.
- **Deterministic legal/business truth.** Eligibility, thresholds, document requirements, and consulate-specific checklist logic stay in typed code plus `config/rules/*.yaml`, not prompts or retrieval.
- **Zod everywhere.** Schemas remain the validation boundary for case facts, tool I/O, LLM outputs, config, env, and artifacts.
- **Explicit approvals.** AI outputs are drafts until approved by the responsible human role.
- **Append-only audit where required.** `messages`, `activity_log`, and `*_changes` remain append-only.
- **Germany Blue Card as the MVP workflow.**
- **Existing applicant workspace work.** It becomes the applicant portal / participant view, not throwaway code.

---

## What Changes

Old:

> An applicant uses Relomate to prepare their own ready-to-submit Blue Card package.

New:

> A firm uses Relomate to operate many Blue Card cases, with AI doing routine case work, applicants supplying inputs through a portal, and consultants/reviewers approving consequential outputs.

Ownership changes from direct `case.userId` ownership to organization-owned cases. Applicants, consultants, reviewers, employers, and ops managers become participants with scoped permissions. Access goes through `src/lib/auth/authorization.ts`, never direct route-level `case.userId === userId` checks.

Approval semantics change too: applicant confirmation and consultant/reviewer approval are distinct events. Applicant confirmation can confirm facts or uploaded materials; firm-ready outputs require professional review by the responsible firm role.

---

## Canada/Toronto Scope Notes

Official German Missions in Canada pages verified on 2026-06-08 state:

- Blue Card (EU) is among national/residence visa categories available for online application.
- People legally residing in Canada for over 6 months can apply at the German Consulate General in Toronto.
- Long-term visa applications must be submitted at the Consulate General in Toronto.
- The EU Blue Card page says all Canadian residents need to apply in person at the German Consulate General in Toronto.
- Canadian citizens may also have a visa-free route to apply for a residence permit after arrival in Germany, but the product should support the pre-travel visa path because applicants may want employment authorized from the first day of visa validity.

Sources to cite in future rule/config updates:

- `https://canada.diplo.de/ca-en/consular-services/visa/long-term`
- `https://canada.diplo.de/ca-en/consular-services/visa/eu-blue-card-2653126`
- `https://canada.diplo.de/ca-en/consular-services/15-terminbuchung`
- `https://canada.diplo.de/ca-en/about-us/generalkonsulat2`

Do not hardcode Canada-specific checklist values from memory. Add Canada/Toronto rules only after verifying the current checklist, fees, appointment path, document copies, proof of Canadian residence, mailing envelope requirements, health insurance wording, and any country-specific legalization/translation requirements.

---

## Required Architecture Additions

1. **RBAC and membership**
   - `organization_members`
   - roles: `firm_admin`, `ops_manager`, `consultant`, `reviewer`, `applicant`, `employer_contact`
   - central authorization helpers

2. **Firm-owned cases**
   - `cases.organization_id`
   - `cases.primary_applicant_user_id`
   - `cases.assigned_consultant_id`
   - `cases.reviewer_id`
   - `cases.stage`, `priority`, `target_submission_date`, `submitted_at`, `closed_at`

3. **Case participants**
   - participants per case with role, visibility, invitation status, and optional relation metadata

4. **Tasks**
   - real mutable task table with assignee, due date, status, source, visibility, blocking flag, and audit trail

5. **Visibility model**
   - `internal`, `client_visible`, `shared`
   - applies to notes, tasks, messages, activity projections, drafts, and review comments

6. **Review inbox**
   - extend approvals with assignee/reviewer, due date, escalation status, and role-required semantics
   - consultant review is not the same as applicant confirmation

7. **Internal notes**
   - firm-only notes, never visible to applicants
   - separate from applicant messages

8. **Firm knowledge**
   - playbooks, templates, prior-approved examples, source metadata
   - retrieval is allowed for firm playbooks, but deterministic rules remain authoritative for legal/business truth

9. **Ops analytics**
   - usage events, stage aging, approval latency, workload, blocked reasons

---

## Non-Goals

- Do not replace Inngest with LangGraph.
- Do not introduce LangChain/LlamaIndex as core architecture.
- Do not add multi-agent orchestration.
- Do not auto-submit applications or book appointments.
- Do not make applicants see internal risk flags, firm playbooks, or consultant-only notes.
- Do not use real friends' PII in tests. Create synthetic Canada/Toronto personas derived from observed flows.
