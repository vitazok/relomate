'use client';

import { useState, useTransition } from 'react';
import {
  DRAFT_TYPE_LABELS,
  type CoverLetterContent,
  type CvContent,
  type DraftContent,
  type EmployerLetterContent,
} from '@/lib/drafting/types';
import { approveDraft, rejectDraft } from './actions';

export function DraftReviewForm({
  caseId,
  draftId,
  initial,
}: {
  caseId: string;
  draftId: string;
  initial: DraftContent;
}) {
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(content: DraftContent | null) {
    setError(null);
    if (!content) {
      setError('Please complete all required draft sections.');
      return;
    }
    startTransition(async () => {
      const res = await approveDraft({ caseId, draftId, content });
      if (res?.error) setError(res.message ?? 'Could not approve this draft.');
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectDraft({ caseId, draftId, reason });
      if (res?.error) setError(res.message ?? 'Could not reject this draft.');
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-4">
      <div className="mb-3 text-xs font-medium text-zinc-500">
        {DRAFT_TYPE_LABELS[initial.type]} draft
      </div>
      <DraftFields initial={initial} onSubmit={submit} pending={pending} />

      <div className="mt-4 border-t border-zinc-100 pt-3">
        <label className="block">
          <span className="text-xs text-zinc-600">Reason for rejection</span>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional"
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
      </div>

      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}

      <div className="mt-4 flex items-center justify-between">
        <button type="button" onClick={reject} disabled={pending} className="text-xs text-zinc-500 hover:underline">
          Reject
        </button>
      </div>
    </section>
  );
}

function parseParagraphs(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function parseLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-600">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs text-zinc-600">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm leading-6"
      />
    </label>
  );
}

function DraftFields({
  initial,
  pending,
  onSubmit,
}: {
  initial: DraftContent;
  pending: boolean;
  onSubmit: (content: DraftContent | null) => void;
}) {
  if (initial.type === 'cv') {
    return <CvFields initial={initial.data} pending={pending} onSubmit={onSubmit} />;
  }
  return (
    <LetterFields
      type={initial.type}
      initial={initial.data}
      pending={pending}
      onSubmit={onSubmit}
    />
  );
}

function LetterFields({
  type,
  initial,
  pending,
  onSubmit,
}: {
  type: 'cover_letter' | 'employer_letter';
  initial: CoverLetterContent | EmployerLetterContent;
  pending: boolean;
  onSubmit: (content: DraftContent | null) => void;
}) {
  const employerInitial = type === 'employer_letter' ? (initial as EmployerLetterContent) : null;
  const coverInitial = type === 'cover_letter' ? (initial as CoverLetterContent) : null;
  const [title, setTitle] = useState(initial.title);
  const [recipient, setRecipient] = useState(initial.recipient);
  const [subject, setSubject] = useState(initial.subject);
  const [paragraphs, setParagraphs] = useState(initial.paragraphs.join('\n\n'));
  const [employerAddress, setEmployerAddress] = useState(employerInitial?.employerAddress ?? '');
  const [signatureBlock, setSignatureBlock] = useState(
    employerInitial?.signatureBlock ?? coverInitial?.signoff ?? '',
  );
  const [employerInstructions, setEmployerInstructions] = useState(
    employerInitial?.employerInstructions.join('\n') ?? '',
  );

  function content(): DraftContent | null {
    const common = {
      title: title.trim(),
      recipient: recipient.trim(),
      subject: subject.trim(),
      paragraphs: parseParagraphs(paragraphs),
    };
    if (type === 'cover_letter') {
      return { type, data: { ...common, signoff: signatureBlock.trim() } };
    }
    return {
      type,
      data: {
        ...common,
        employerAddress: employerAddress.trim(),
        signatureBlock: signatureBlock.trim(),
        employerInstructions: parseLines(employerInstructions),
      },
    };
  }

  return (
    <div className="space-y-3">
      <TextInput label="Title" value={title} onChange={setTitle} />
      {type === 'employer_letter' && (
        <TextArea label="Employer address" value={employerAddress} rows={4} onChange={setEmployerAddress} />
      )}
      <TextInput label="Recipient" value={recipient} onChange={setRecipient} />
      <TextInput label="Subject" value={subject} onChange={setSubject} />
      <TextArea label="Body" value={paragraphs} rows={16} onChange={setParagraphs} />
      <TextArea
        label={type === 'employer_letter' ? 'Signature block' : 'Signoff'}
        value={signatureBlock}
        rows={3}
        onChange={setSignatureBlock}
      />
      {type === 'employer_letter' && (
        <TextArea
          label="Employer checks"
          value={employerInstructions}
          rows={5}
          onChange={setEmployerInstructions}
        />
      )}
      <ApproveButton pending={pending} onClick={() => onSubmit(content())} />
    </div>
  );
}

function CvFields({
  initial,
  pending,
  onSubmit,
}: {
  initial: CvContent;
  pending: boolean;
  onSubmit: (content: DraftContent | null) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [personalDetails, setPersonalDetails] = useState(initial.personalDetails.join('\n'));
  const [profile, setProfile] = useState(initial.profile);
  const [sections, setSections] = useState(JSON.stringify(initial.sections, null, 2));

  function content(): DraftContent | null {
    try {
      const parsedSections = JSON.parse(sections) as unknown;
      return {
        type: 'cv',
        data: {
          title: title.trim(),
          personalDetails: parseLines(personalDetails),
          profile: profile.trim(),
          sections: parsedSections as CvContent['sections'],
        },
      };
    } catch {
      return null;
    }
  }

  return (
    <div className="space-y-3">
      <TextInput label="Title" value={title} onChange={setTitle} />
      <TextArea label="Personal details" value={personalDetails} rows={6} onChange={setPersonalDetails} />
      <TextArea label="Profile" value={profile} rows={5} onChange={setProfile} />
      <TextArea label="Sections" value={sections} rows={18} onChange={setSections} />
      <ApproveButton pending={pending} onClick={() => onSubmit(content())} />
    </div>
  );
}

function ApproveButton({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
      >
        {pending ? 'Saving...' : 'Approve draft'}
      </button>
    </div>
  );
}
