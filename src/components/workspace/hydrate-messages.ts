import type { UIMessage } from 'ai';

export interface PersistedMessage {
  id: string;
  role: string;
  content: string;
  parts: unknown;
}

/** A part the chat bubble can actually render: text, or a tool part carrying an output. */
function isRenderablePart(part: unknown): boolean {
  if (!part || typeof part !== 'object') return false;
  const p = part as { type?: string; text?: string; output?: { type?: string } };
  if (p.type === 'text') return typeof p.text === 'string';
  if (typeof p.type === 'string' && p.type.startsWith('tool-')) {
    return p.output?.type != null;
  }
  return false;
}

/**
 * Map persisted message rows to UIMessages for hydration on reload.
 *
 * Persisted `parts` is the LAST agent step's content (see the onFinish design note). When a turn
 * ends on a tool step, `parts` holds only tool parts with no `output` field (outputs live in the
 * tool_calls table), so the bubble would render empty. In that case — parts present but nothing
 * renderable — fall back to the assistant's text `content` so the final reply still shows.
 */
export function hydrateMessages(rows: PersistedMessage[]): UIMessage[] {
  return rows.map((m) => {
    const parts = Array.isArray(m.parts) ? (m.parts as UIMessage['parts']) : null;

    let resolvedParts: UIMessage['parts'];
    if (!parts) {
      resolvedParts = [{ type: 'text', text: m.content }];
    } else if (m.content && !parts.some(isRenderablePart)) {
      resolvedParts = [...parts, { type: 'text', text: m.content }];
    } else {
      resolvedParts = parts;
    }

    return {
      id: m.id,
      role: m.role as 'user' | 'assistant' | 'system',
      parts: resolvedParts,
    };
  });
}
