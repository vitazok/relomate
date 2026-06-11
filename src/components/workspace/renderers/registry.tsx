import type { ReactNode } from 'react';
import { DocumentUpload } from '@/components/workspace/DocumentUpload';

export interface ToolOutput {
  type: string;
  version: number;
  data: unknown;
}

export type Renderer = (props: { output: ToolOutput }) => ReactNode;

export const UpdateCaseResult: Renderer = ({ output }) => {
  const data = output.data as { updatedPaths?: string[]; contradictions?: unknown[] };
  const n = data.updatedPaths?.length ?? 0;
  return (
    <span className="text-xs text-zinc-500">
      Updated {n} field{n === 1 ? '' : 's'}
      {data.contradictions && data.contradictions.length > 0 ? ' (contradiction noted)' : ''}
    </span>
  );
};

export const ReadCaseResult: Renderer = () => (
  <span className="text-xs text-zinc-400">Read case details</span>
);

export const AddCaseNoteResult: Renderer = () => (
  <span className="text-xs text-zinc-400">Noted</span>
);

export const OutOfScopeResult: Renderer = ({ output }) => {
  const data = output.data as { reason?: string };
  return (
    <span className="block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
      Out of scope: {data.reason ?? 'This request is outside what I can help with.'}
    </span>
  );
};

export const FallbackResult: Renderer = ({ output }) => (
  <span className="text-xs text-zinc-400">[{output.type}]</span>
);

const MISSING_LABELS: Record<string, string> = {
  'employment.annualGrossSalaryEur': 'expected annual gross salary',
  'education.anabinStatus': 'whether your degree is recognized (Anabin status)',
};

const eur = (n: number) => `€${n.toLocaleString('en-US')}`;

export const EligibilityResult: Renderer = ({ output }) => {
  const data = output.data as {
    status: 'assessed' | 'incomplete' | 'out_of_scope';
    reason?: string;
    missing?: string[];
    routes?: string[];
    blockers?: string[];
    warnings?: string[];
    figures?: {
      salaryOnFile: number | null;
      standard: { annualGrossEur: number; meets: boolean | null };
      reduced: { annualGrossEur: number; meets: boolean | null };
    } | null;
  };

  if (data.status === 'out_of_scope') {
    return (
      <span className="block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
        Eligibility check skipped: {data.reason ?? 'this request is outside the Blue Card scope.'}
      </span>
    );
  }

  if (data.status === 'incomplete') {
    const labels = (data.missing ?? []).map((p) => MISSING_LABELS[p] ?? p);
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        Need a couple more details before I can check: {labels.join(', ')}.
      </span>
    );
  }

  if (!data.figures) {
    // Assessed, but no threshold period covers the assessment date — show the blocker
    // rather than confidently-wrong (stale) salary figures.
    return (
      <span className="block rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
        Eligibility figures are unavailable for this date — the salary thresholds on file may be
        out of date. Please check back once current figures are published.
      </span>
    );
  }

  const fig = data.figures;
  const mark = (m: boolean | null) => (m === null ? '·' : m ? '✓' : '✗');
  return (
    <div className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-700">
      <div className="font-medium">Eligibility check</div>
      <div>
        Standard threshold {eur(fig.standard.annualGrossEur)} {mark(fig.standard.meets)}
        {fig.salaryOnFile != null ? ` — ${eur(fig.salaryOnFile)} on file` : ''}
      </div>
      <div>
        Reduced threshold {eur(fig.reduced.annualGrossEur)} {mark(fig.reduced.meets)}
      </div>
      <div className="mt-1">
        {data.routes && data.routes.length > 0
          ? `Qualifies via: ${data.routes.join(', ')}`
          : 'No route qualifies yet'}
      </div>
      {data.warnings && data.warnings.length > 0 ? (
        <div className="text-amber-700">Notes: {data.warnings.join(', ')}</div>
      ) : null}
    </div>
  );
};

export const AnabinResult: Renderer = ({ output }) => {
  const data = output.data as {
    found: boolean;
    query?: string;
    status?: string;
    institution?: string;
    verifiedByUser?: boolean;
  };
  if (!data.found) {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        {data.query} is not in our Anabin database — it needs a ZAB individual assessment.
      </span>
    );
  }
  const unrated = data.status === 'unknown';
  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      {data.institution}: {unrated ? 'found, recognition not yet rated' : `recognition status ${data.status}`}
      {data.verifiedByUser === false ? ' (unverified seed)' : ''}
    </span>
  );
};

export const DocumentUploadRequest: Renderer = ({ output }) => {
  const data = output.data as { spineItemId: string | null; label: string; accept: string };
  return <DocumentUpload spineItemId={data.spineItemId} label={data.label} accept={data.accept} />;
};

export const DocumentExtractionStatus: Renderer = ({ output }) => {
  const data = output.data as {
    documentId: string;
    caseId?: string;
    fileName?: string;
    status?: string;
  };
  const name = data.fileName ?? 'document';

  if (data.status === 'awaiting_confirmation' && data.caseId) {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        {name} is ready —{' '}
        <a
          href={`/case/${data.caseId}/documents/${data.documentId}/review`}
          className="text-blue-600 underline"
        >
          Review &amp; confirm
        </a>
      </span>
    );
  }

  if (data.status === 'confirmed') {
    return <span className="block px-2 py-1 text-xs text-green-700">✓ Added to your case</span>;
  }

  if (data.status === 'rejected') {
    return <span className="block px-2 py-1 text-xs text-zinc-400">Dismissed</span>;
  }

  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      Processing {name}…
    </span>
  );
};

function draftLabel(type: string | undefined): string {
  switch (type) {
    case 'cover_letter':
      return 'Cover letter';
    case 'employer_letter':
      return 'Employer letter';
    case 'cv':
      return 'CV';
    case 'anabin_justification':
      return 'Anabin justification';
    default:
      return 'Draft';
  }
}

export const DraftRequestResult: Renderer = ({ output }) => {
  const data = output.data as {
    draftId: string;
    caseId?: string;
    draftType?: string;
    status?: string;
  };
  const label = draftLabel(data.draftType);

  if (data.status === 'ready_for_review' && data.caseId) {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        {label} is ready -{' '}
        <a
          href={`/case/${data.caseId}/drafts/${data.draftId}/review`}
          className="text-blue-600 underline"
        >
          Review
        </a>
      </span>
    );
  }

  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      Drafting {label.toLowerCase()}...
    </span>
  );
};

export const VidexCompletenessResult: Renderer = ({ output }) => {
  const data = output.data as {
    total?: number;
    filled?: number;
    formOutput?: { mode?: string; consulateId?: string | null };
    missing?: Array<{ fieldNumber: number; label: string }>;
  };
  const total = data.total ?? 0;
  const filled = data.filled ?? 0;
  const missing = data.missing ?? [];
  const title =
    data.formOutput?.mode === 'csp_integrated'
      ? 'CSP form readiness'
      : data.formOutput?.mode === 'videx_online'
        ? 'VIDEX readiness'
        : 'Form readiness';
  const preview = missing
    .slice(0, 3)
    .map((field) => `${field.fieldNumber}. ${field.label}`)
    .join(', ');

  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      {title}: {filled} of {total} fields filled
      {preview ? ` - missing ${preview}${missing.length > 3 ? ', ...' : ''}` : ''}
    </span>
  );
};

export const MissingFormFieldRequest: Renderer = ({ output }) => {
  const data = output.data as {
    status?: 'question' | 'missing_consulate' | 'no_missing_user_fields';
    question?: string | null;
    field?: { fieldNumber: number; label: string; sourcePaths: string[] } | null;
  };

  if (data.status === 'no_missing_user_fields') {
    return (
      <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
        No user-provided form fields are missing right now.
      </span>
    );
  }

  return (
    <span className="block rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
      <span className="block font-medium">{data.question ?? 'I need one more form detail.'}</span>
      {data.field ? (
        <span className="mt-1 block text-zinc-500">
          Field {data.field.fieldNumber}: {data.field.label}
          {data.field.sourcePaths.length > 0 ? ` - saves to ${data.field.sourcePaths.join(', ')}` : ''}
        </span>
      ) : null}
    </span>
  );
};

const registry: Record<string, Renderer> = {
  update_case_result: UpdateCaseResult,
  read_case_result: ReadCaseResult,
  add_case_note_result: AddCaseNoteResult,
  out_of_scope_result: OutOfScopeResult,
  eligibility_result: EligibilityResult,
  anabin_result: AnabinResult,
  document_upload_request: DocumentUploadRequest,
  document_extraction_status: DocumentExtractionStatus,
  draft_request_result: DraftRequestResult,
  videx_completeness_result: VidexCompletenessResult,
  missing_form_field_request: MissingFormFieldRequest,
};

// Dispatch keys on `type` only; `output.version` is intentionally ignored while
// every output is v1. When a v2 payload ships, key on `${type}@${version}` (or
// branch inside the renderer) so a v1 renderer never silently renders v2 data.
export function resolveRenderer(type: string): Renderer {
  return registry[type] ?? FallbackResult;
}
