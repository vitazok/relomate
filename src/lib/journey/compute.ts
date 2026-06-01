import type { CaseFacts, EligibilityVerdict } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import type { DocumentCondition, DocumentItem, DocumentRules } from '@/lib/rules/types';
import { getAtPath } from '@/lib/case/paths';
import { getJourneyManifest } from './loader';
import { resolveCitation } from './citations';
import { mapAnswerProvenance } from './provenance';
import type {
  JourneyProgress,
  JourneyStep,
  PhaseProgress,
  StepProgress,
} from './types';

interface FactLeaf {
  value: unknown;
  source: string;
  updatedAt: string;
}

function readLeaf(facts: Record<string, unknown>, path: string): FactLeaf | null {
  const node = getAtPath(facts, path);
  if (node && typeof node === 'object' && 'value' in node) {
    const leaf = node as { value: unknown; source?: string; updatedAt?: string };
    return {
      value: leaf.value,
      source: leaf.source ?? 'system',
      updatedAt: leaf.updatedAt ?? '',
    };
  }
  return null;
}

/** True iff the leaf at `path` has a non-null value. */
function hasValue(facts: Record<string, unknown>, path: string): boolean {
  const leaf = readLeaf(facts, path);
  return leaf != null && leaf.value != null;
}

/** Evaluate a documents.yaml `condition` against the case facts. */
export function evaluateCondition(condition: DocumentCondition, facts: CaseFacts): boolean {
  const leaf = readLeaf(facts as Record<string, unknown>, condition.path);
  if (leaf == null || leaf.value == null) return false;
  if (condition.in) {
    return condition.in.includes(String(leaf.value));
  }
  if (condition.equals !== undefined) {
    return leaf.value === condition.equals;
  }
  return false;
}

function buildEligibilityStep(step: JourneyStep, facts: CaseFacts): StepProgress {
  const factsRec = facts as Record<string, unknown>;
  const complete = step.paths.every((p) => hasValue(factsRec, p));

  // The first populated path drives value + answer provenance.
  let value: string | null = null;
  let answerProvenance: StepProgress['answerProvenance'] = null;
  for (const p of step.paths) {
    const leaf = readLeaf(factsRec, p);
    if (leaf != null && leaf.value != null) {
      value = value == null ? String(leaf.value) : `${value} · ${String(leaf.value)}`;
      if (answerProvenance == null) {
        answerProvenance = mapAnswerProvenance(leaf.source, leaf.updatedAt || null);
      }
    }
  }

  return {
    id: step.id,
    label: step.label,
    state: complete ? 'complete' : 'incomplete',
    value,
    group: null,
    requirementCitation: resolveCitation(step.cite),
    answerProvenance,
    action: null,
  };
}

function phaseStatus(completed: number, total: number, locked: boolean): PhaseProgress['status'] {
  if (locked) return 'locked';
  if (total > 0 && completed === total) return 'done';
  if (completed > 0) return 'active';
  return 'todo';
}

function docItemToStep(
  item: DocumentItem,
  group: string | null,
  idSuffix: string,
  docsLastVerified: string,
): StepProgress {
  return {
    id: idSuffix ? `${item.id}${idSuffix}` : item.id,
    label: item.label,
    state: 'incomplete', // upload backend deferred; nothing is uploaded/confirmed yet
    value: null,
    group,
    requirementCitation: {
      explainer: item.details,
      legalBasis: null,
      sourceUrl: item.sourceUrl,
      lastVerified: docsLastVerified,
    },
    answerProvenance: null,
    action: { kind: 'upload', enabled: false },
  };
}

function routeApplies(item: DocumentItem, verdict: EligibilityVerdict): boolean {
  if (item.routes == null) return true; // null = all routes
  return item.routes.some((r) => verdict.routes.includes(r));
}

function expandDocuments(
  facts: CaseFacts,
  verdict: EligibilityVerdict,
  docs: DocumentRules,
): StepProgress[] {
  const steps: StepProgress[] = [];

  // (a) applicant items: filter by route + condition
  for (const item of docs.items) {
    if (!routeApplies(item, verdict)) continue;
    if (item.condition && !evaluateCondition(item.condition, facts)) continue;
    steps.push(docItemToStep(item, 'You (applicant)', '', docs.lastVerified));
  }

  // (c) family items by composition
  const spousePresent = readLeaf(facts as Record<string, unknown>, 'family.spousePresent')?.value === true;
  if (spousePresent) {
    for (const item of docs.familyItems.spouse) {
      steps.push(docItemToStep(item, 'Spouse', '', docs.lastVerified));
    }
  }

  const childrenCountLeaf = readLeaf(facts as Record<string, unknown>, 'family.childrenCount');
  const childrenCount = typeof childrenCountLeaf?.value === 'number' ? childrenCountLeaf.value : 0;
  for (let i = 1; i <= childrenCount; i++) {
    for (const item of docs.familyItems.child) {
      steps.push(docItemToStep(item, `Child ${i}`, `__${i}`, docs.lastVerified));
    }
  }

  return steps;
}

export function computeJourneyProgress(
  caseFacts: CaseFacts,
  _profile: Profile,
  documents: DocumentRules,
  verdict: EligibilityVerdict,
  _today: Date,
): JourneyProgress {
  const manifest = getJourneyManifest();
  const phases: PhaseProgress[] = manifest.phases.map((phase) => {
    if (phase.locked) {
      return {
        id: phase.id,
        label: phase.label,
        status: 'locked',
        completed: 0,
        total: 0,
        comingSoon: phase.comingSoon,
        steps: [],
      };
    }

    let steps: StepProgress[];
    if (phase.source === 'documents') {
      steps = expandDocuments(caseFacts, verdict, documents);
    } else {
      steps = phase.steps.map((s) => buildEligibilityStep(s, caseFacts));
    }

    const total = steps.length;
    const completed = steps.filter((s) => s.state === 'complete').length;
    return {
      id: phase.id,
      label: phase.label,
      status: phaseStatus(completed, total, false),
      completed,
      total,
      comingSoon: phase.comingSoon,
      steps,
    };
  });

  const unlocked = phases.filter((p) => p.status !== 'locked');
  const totalSteps = unlocked.reduce((n, p) => n + p.total, 0);
  const doneSteps = unlocked.reduce((n, p) => n + p.completed, 0);
  const overallPct = totalSteps === 0 ? 0 : Math.round((doneSteps / totalSteps) * 100);

  return { phases, overallPct };
}
