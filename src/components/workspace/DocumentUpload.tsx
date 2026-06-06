'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export async function uploadDocument(
  caseId: string,
  file: File,
  spineItemId?: string | null,
): Promise<string> {
  const urlRes = await fetch('/api/documents/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caseId,
      spineItemId: spineItemId ?? null,
      fileName: file.name,
      contentType: file.type || 'application/octet-stream',
      byteSize: file.size,
    }),
  });
  if (!urlRes.ok) throw new Error(`upload-url failed: ${urlRes.status}`);
  const { documentId, uploadUrl } = (await urlRes.json()) as {
    documentId: string;
    uploadUrl: string;
  };

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (!putRes.ok) throw new Error(`R2 upload failed: ${putRes.status}`);

  const finRes = await fetch(`/api/documents/${documentId}/finalize`, { method: 'POST' });
  if (!finRes.ok) throw new Error(`finalize failed: ${finRes.status}`);

  return documentId;
}

interface DocumentStatusView {
  status: string;
  fileName?: string;
  error?: string | null;
}

export function DocumentUpload({
  caseId,
  spineItemId,
  label,
  accept,
}: {
  caseId?: string;
  // reason: 3B classification UX consumes spineItemId; the renderer passes it through now.
  spineItemId?: string | null;
  label: string;
  accept: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'uploading' | 'processing' | 'error'>('idle');
  const [view, setView] = useState<DocumentStatusView | null>(null);

  async function onFile(file: File) {
    if (!caseId) return;
    setState('uploading');
    try {
      const documentId = await uploadDocument(caseId, file, spineItemId);
      setState('processing');
      let terminal = false;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const res = await fetch(`/api/documents/${documentId}`);
        if (!res.ok) break;
        const v = (await res.json()) as DocumentStatusView;
        setView(v);
        if (v.status === 'awaiting_confirmation' || v.status === 'failed') {
          terminal = true;
          router.refresh();
          break;
        }
      }
      if (!terminal) {
        setState('error');
        router.refresh();
      }
    } catch {
      setState('error');
      router.refresh();
    }
  }

  return (
    <div
      data-spine-item-id={spineItemId ?? undefined}
      className="rounded-md border border-zinc-300 bg-white p-3 text-sm"
    >
      <div className="mb-2 font-medium">{label}</div>
      <input
        type="file"
        accept={accept}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      {state === 'uploading' && <div className="mt-2 text-xs text-zinc-500">Uploading…</div>}
      {state === 'processing' && (
        <div className="mt-2 text-xs text-zinc-500">
          {view?.status === 'awaiting_confirmation'
            ? 'Ready for review.'
            : 'Reading your document…'}
        </div>
      )}
      {(state === 'error' || view?.status === 'failed') && (
        <div className="mt-2 text-xs text-amber-700">
          Couldn’t read this document. Try re-uploading, or you can enter the details manually.
        </div>
      )}
    </div>
  );
}
