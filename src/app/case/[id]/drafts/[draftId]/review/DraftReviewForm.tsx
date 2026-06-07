'use client';

import { useState, useTransition } from 'react';
import type { CoverLetterContent } from '@/lib/drafting/types';
import { approveDraft, rejectDraft } from './actions';

export function DraftReviewForm({
  caseId,
  draftId,
  initial,
}: {
  caseId: string;
  draftId: string;
  initial: CoverLetterContent;
}) {
  const [title, setTitle] = useState(initial.title);
  const [recipient, setRecipient] = useState(initial.recipient);
  const [subject, setSubject] = useState(initial.subject);
  const [paragraphs, setParagraphs] = useState(initial.paragraphs.join('\n\n'));
  const [signoff, setSignoff] = useState(initial.signoff);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await approveDraft({
        caseId,
        draftId,
        title,
        recipient,
        subject,
        paragraphs,
        signoff,
      });
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
      <div className="mb-3 text-xs font-medium text-zinc-500">Cover letter draft</div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-zinc-600">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-600">Recipient</span>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-600">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-600">Body</span>
          <textarea
            value={paragraphs}
            onChange={(e) => setParagraphs(e.target.value)}
            rows={16}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm leading-6"
          />
        </label>
        <label className="block">
          <span className="text-xs text-zinc-600">Signoff</span>
          <textarea
            value={signoff}
            onChange={(e) => setSignoff(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-2 text-sm leading-6"
          />
        </label>
      </div>

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
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Saving...' : 'Approve draft'}
        </button>
      </div>
    </section>
  );
}
