'use client';

import { useState, useTransition } from 'react';
import type { ReviewRow } from '@/lib/documents/review-view-model';
import { confirmExtraction, rejectExtraction } from './actions';

const LEVEL_STYLES: Record<ReviewRow['level'], string> = {
  high: 'bg-green-100 text-green-800',
  mid: 'bg-amber-100 text-amber-800',
  low: 'bg-red-100 text-red-800',
};

export function ReviewForm({
  caseId,
  documentId,
  rows,
}: {
  caseId: string;
  documentId: string;
  rows: ReviewRow[];
}) {
  const initial = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [showSensitive, setShowSensitive] = useState<Record<string, boolean>>({});
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const fields = rows
      .filter((r) => r.mapped)
      .map((r) => ({ key: r.key, value: values[r.key], edited: values[r.key] !== r.value }));
    startTransition(async () => {
      const res = await confirmExtraction({ caseId, documentId, fields });
      if (res?.error) setError(res.message ?? 'Could not save. Please check the highlighted fields.');
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const res = await rejectExtraction({ caseId, documentId });
      if (res?.error) setError(res.message ?? 'Could not dismiss.');
    });
  }

  return (
    <section className="rounded-md border border-zinc-200 bg-white p-3">
      <div className="mb-2 text-xs font-medium text-zinc-500">Extracted fields — review &amp; correct</div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex items-center justify-between">
              <label htmlFor={`f-${r.key}`} className="text-xs text-zinc-600">
                {r.label}
                {!r.mapped && <span className="ml-1 text-zinc-400">(not saved)</span>}
              </label>
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${LEVEL_STYLES[r.level]}`}>
                {Math.round(r.confidence * 100)}%
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input
                id={`f-${r.key}`}
                type={r.sensitive && !showSensitive[r.key] ? 'password' : 'text'}
                value={values[r.key] ?? ''}
                disabled={!r.mapped}
                onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                className="w-full rounded border border-zinc-300 px-2 py-1 text-sm disabled:bg-zinc-100 disabled:text-zinc-400"
              />
              {r.sensitive && (
                <button
                  type="button"
                  onClick={() => setShowSensitive((s) => ({ ...s, [r.key]: !s[r.key] }))}
                  className="text-xs text-zinc-500 hover:underline"
                >
                  {showSensitive[r.key] ? 'hide' : 'show'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-3 text-xs text-zinc-500">Confirming saves these to your case.</p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={reject} disabled={pending} className="text-xs text-zinc-500 hover:underline">
          Reject
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Confirm & save'}
        </button>
      </div>
    </section>
  );
}
