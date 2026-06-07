import type { CaseFacts, EligibilityVerdict } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';
import type { DocumentStatus } from '@/lib/documents/types';
import type { DraftStatus, DraftType } from '@/lib/drafting/types';
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

export interface JourneyDocument {
  id: string;
  spineItemId: string | null;
  fileName: string;
  status: DocumentStatus;
}

export interface JourneyDraft {
  id: string;
  type: DraftType;
  status: DraftStatus;
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
    document: null,
    draft: null,
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
  document: JourneyDocument | null,
  caseId: string | null,
): StepProgress {
  const reviewHref =
    document?.status === 'awaiting_confirmation' && caseId
      ? `/case/${caseId}/documents/${document.id}/review`
      : null;
  const value = document ? documentStatusLabel(document.status) : null;
  return {
    id: idSuffix ? `${item.id}${idSuffix}` : item.id,
    label: item.label,
    state: document?.status === 'confirmed' ? 'complete' : 'incomplete',
    value,
    group,
    requirementCitation: {
      explainer: item.details,
      legalBasis: null,
      sourceUrl: item.sourceUrl,
      lastVerified: docsLastVerified,
    },
    answerProvenance: null,
    document: document
      ? {
          id: document.id,
          fileName: document.fileName,
          status: document.status,
          reviewHref,
        }
      : null,
    draft: null,
    action:
      document?.status === 'uploaded' ||
      document?.status === 'classifying' ||
      document?.status === 'extracting' ||
      document?.status === 'awaiting_confirmation' ||
      document?.status === 'confirmed'
        ? null
        : { kind: 'upload', enabled: true, spineItemId: item.id },
  };
}

function draftStatusLabel(status: DraftStatus): string {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'ready_for_review':
      return 'ready for review';
    case 'failed':
      return 'could not draft';
    case 'rejected':
      return 'rejected';
    default:
      return 'drafting';
  }
}

function latestDraft(drafts: JourneyDraft[], type: DraftType): JourneyDraft | null {
  return drafts.find((d) => d.type === type) ?? null;
}

const DRAFT_STEP_DEFS: Array<{ type: DraftType; label: string }> = [
  { type: 'cover_letter', label: 'Cover letter' },
  { type: 'employer_letter', label: 'Employer letter' },
  { type: 'cv', label: 'CV' },
];

function buildDraftSteps(drafts: JourneyDraft[], caseId: string | null): StepProgress[] {
  return DRAFT_STEP_DEFS.map(({ type, label }) => {
    const draft = latestDraft(drafts, type);
    const reviewHref =
      draft?.status === 'ready_for_review' && caseId
        ? `/case/${caseId}/drafts/${draft.id}/review`
        : null;
    return {
      id: type,
      label,
      state: draft?.status === 'approved' ? 'complete' : 'incomplete',
      value: draft ? draftStatusLabel(draft.status) : 'not started yet',
      group: null,
      requirementCitation: null,
      answerProvenance: null,
      document: null,
      draft: draft
        ? {
            id: draft.id,
            type: draft.type,
            status: draft.status,
            reviewHref,
          }
        : null,
      action: null,
    };
  });
}

function documentStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'awaiting_confirmation':
      return 'ready for review';
    case 'failed':
      return 'could not read';
    case 'rejected':
      return 'dismissed';
    case 'uploaded':
    case 'classifying':
    case 'extracting':
      return 'processing';
    default:
      return 'not uploaded yet';
  }
}

function routeApplies(item: DocumentItem, verdict: EligibilityVerdict): boolean {
  if (item.routes == null) return true; // null = all routes
  return item.routes.some((r) => verdict.routes.includes(r));
}

function buildDocumentBuckets(documents: JourneyDocument[]): Map<string, JourneyDocument[]> {
  const buckets = new Map<string, JourneyDocument[]>();
  for (const doc of documents) {
    if (!doc.spineItemId) continue;
    const bucket = buckets.get(doc.spineItemId) ?? [];
    bucket.push(doc);
    buckets.set(doc.spineItemId, bucket);
  }
  return buckets;
}

function takeDocument(
  buckets: Map<string, JourneyDocument[]>,
  spineItemId: string,
): JourneyDocument | null {
  return buckets.get(spineItemId)?.shift() ?? null;
}

function expandDocuments(
  facts: CaseFacts,
  verdict: EligibilityVerdict,
  docs: DocumentRules,
  uploadedDocuments: JourneyDocument[],
  caseId: string | null,
): StepProgress[] {
  const steps: StepProgress[] = [];
  const documentBuckets = buildDocumentBuckets(uploadedDocuments);

  // (a) applicant items: filter by route + condition
  for (const item of docs.items) {
    if (!routeApplies(item, verdict)) continue;
    if (item.condition && !evaluateCondition(item.condition, facts)) continue;
    steps.push(
      docItemToStep(
        item,
        'You (applicant)',
        '',
        docs.lastVerified,
        takeDocument(documentBuckets, item.id),
        caseId,
      ),
    );
  }

  // (c) family items by composition
  const spousePresent = readLeaf(facts as Record<string, unknown>, 'family.spousePresent')?.value === true;
  if (spousePresent) {
    for (const item of docs.familyItems.spouse) {
      steps.push(
        docItemToStep(
          item,
          'Spouse',
          '',
          docs.lastVerified,
          takeDocument(documentBuckets, item.id),
          caseId,
        ),
      );
    }
  }

  const childrenCountLeaf = readLeaf(facts as Record<string, unknown>, 'family.childrenCount');
  const childrenCount = typeof childrenCountLeaf?.value === 'number' ? childrenCountLeaf.value : 0;
  for (let i = 1; i <= childrenCount; i++) {
    for (const item of docs.familyItems.child) {
      steps.push(
        docItemToStep(
          item,
          `Child ${i}`,
          `__${i}`,
          docs.lastVerified,
          takeDocument(documentBuckets, item.id),
          caseId,
        ),
      );
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
  uploadedDocuments: JourneyDocument[] = [],
  caseId: string | null = null,
  drafts: JourneyDraft[] = [],
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
      steps = expandDocuments(caseFacts, verdict, documents, uploadedDocuments, caseId);
    } else if (phase.source === 'drafts') {
      steps = buildDraftSteps(drafts, caseId);
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
