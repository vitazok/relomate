import type { CaseFacts } from '@/lib/case/schema';
import { assessVidexCompleteness, type VidexMissingReason } from '@/lib/drafting/videx';
import { requiredFormOutputForCase, type FormMode, type FormOutputRequirement } from '@/lib/forms/output';
import { getConsulate } from '@/lib/rules/loader';
import type { ConsulateRules } from '@/lib/rules/types';
import type { Profile } from '@/lib/profile/schema';

export interface MissingFormFieldView {
  fieldNumber: number;
  label: string;
  sourcePaths: string[];
  reason: VidexMissingReason;
  reasonLabel: string;
  action: 'provide' | 'model' | 'sign';
}

export interface FormsWorkspaceViewModel {
  formOutput: FormOutputRequirement;
  consulate: Pick<ConsulateRules, 'officialName' | 'url' | 'applicationForm' | 'verifiedByUser'> | null;
  modeLabel: string;
  headline: string;
  summary: string;
  readinessLabel: string;
  filled: number;
  total: number;
  pct: number;
  missing: MissingFormFieldView[];
  missingUserInput: MissingFormFieldView[];
  missingSystemSupport: MissingFormFieldView[];
  manualSignature: MissingFormFieldView[];
  ctaLabel: string;
  ctaEnabled: boolean;
}

function modeLabel(mode: FormMode): string {
  switch (mode) {
    case 'csp_integrated':
      return 'CSP integrated';
    case 'videx_online':
      return 'VIDEX online';
    default:
      return 'Form route unknown';
  }
}

function headline(mode: FormMode): string {
  switch (mode) {
    case 'csp_integrated':
      return 'Consular Services Portal readiness';
    case 'videx_online':
      return 'VIDEX readiness';
    default:
      return 'Select a consulate to determine the form route';
  }
}

function summary(mode: FormMode): string {
  switch (mode) {
    case 'csp_integrated':
      return 'This route uses the Consular Services Portal integrated application form for supported Blue Card cases.';
    case 'videx_online':
      return 'This route uses the online VIDEX residence visa form. The case file can prefill supported fields.';
    default:
      return 'The case needs a target consulate before Relomate can show the required form flow.';
  }
}

function readinessLabel(mode: FormMode): string {
  switch (mode) {
    case 'csp_integrated':
      return 'Structured facts ready';
    case 'videx_online':
      return 'VIDEX fields ready';
    default:
      return 'Known fields ready';
  }
}

function reasonLabel(reason: VidexMissingReason): string {
  switch (reason) {
    case 'missing_source':
      return 'Needs case data';
    case 'not_modelled':
      return 'Not modelled yet';
    case 'manual_signature':
      return 'Manual signature';
  }
}

function actionForReason(reason: VidexMissingReason): MissingFormFieldView['action'] {
  switch (reason) {
    case 'missing_source':
      return 'provide';
    case 'not_modelled':
      return 'model';
    case 'manual_signature':
      return 'sign';
  }
}

export function buildFormsWorkspaceViewModel(input: {
  profile: Profile | null;
  caseFacts: CaseFacts;
  today?: Date;
}): FormsWorkspaceViewModel {
  const formOutput = requiredFormOutputForCase(input.caseFacts);
  const completeness = assessVidexCompleteness(input);
  const consulate = formOutput.consulateId ? getConsulate(formOutput.consulateId) : null;
  const missing = completeness.missing.map((field) => ({
    fieldNumber: field.fieldNumber,
    label: field.label,
    sourcePaths: field.sourcePaths,
    reason: field.reason,
    reasonLabel: reasonLabel(field.reason),
    action: actionForReason(field.reason),
  }));

  return {
    formOutput,
    consulate: consulate
      ? {
          officialName: consulate.officialName,
          url: consulate.url,
          applicationForm: consulate.applicationForm,
          verifiedByUser: consulate.verifiedByUser,
        }
      : null,
    modeLabel: modeLabel(formOutput.mode),
    headline: headline(formOutput.mode),
    summary: summary(formOutput.mode),
    readinessLabel: readinessLabel(formOutput.mode),
    filled: completeness.filled,
    total: completeness.total,
    pct: completeness.total === 0 ? 0 : Math.round((completeness.filled / completeness.total) * 100),
    missing,
    missingUserInput: missing.filter((field) => field.action === 'provide'),
    missingSystemSupport: missing.filter((field) => field.action === 'model'),
    manualSignature: missing.filter((field) => field.action === 'sign'),
    ctaLabel: formOutput.mode === 'videx_online' ? 'Generate preview' : 'Open form guidance',
    ctaEnabled: false,
  };
}
