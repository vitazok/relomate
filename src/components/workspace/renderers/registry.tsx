import type { ReactNode } from 'react';

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

const registry: Record<string, Renderer> = {
  update_case_result: UpdateCaseResult,
  read_case_result: ReadCaseResult,
  add_case_note_result: AddCaseNoteResult,
  out_of_scope_result: OutOfScopeResult,
};

// Dispatch keys on `type` only; `output.version` is intentionally ignored while
// every output is v1. When a v2 payload ships, key on `${type}@${version}` (or
// branch inside the renderer) so a v1 renderer never silently renders v2 data.
export function resolveRenderer(type: string): Renderer {
  return registry[type] ?? FallbackResult;
}
