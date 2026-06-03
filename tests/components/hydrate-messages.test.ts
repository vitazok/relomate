import { describe, it, expect } from 'vitest';
import { hydrateMessages } from '@/components/workspace/hydrate-messages';

const base = { createdAt: new Date(), content: '', parts: null as unknown };

describe('hydrateMessages (#14)', () => {
  it('uses a text part from content when parts is null', () => {
    const out = hydrateMessages([
      { ...base, id: 'a', role: 'assistant', content: 'hello', parts: null },
    ]);
    expect(out[0]!.parts).toEqual([{ type: 'text', text: 'hello' }]);
  });

  it('keeps renderable parts as-is when present', () => {
    const parts = [{ type: 'text', text: 'hi' }];
    const out = hydrateMessages([
      { ...base, id: 'a', role: 'assistant', content: 'hi', parts },
    ]);
    expect(out[0]!.parts).toEqual(parts);
  });

  it('falls back to content text when parts contains only tool parts with no output (turn ended on a tool step)', () => {
    // A turn whose last step was a tool call persists tool-only parts with no `output` field
    // (outputs live in the tool_calls table). Rendering those alone yields an empty bubble.
    const toolOnlyParts = [
      { type: 'tool-update_case', toolCallId: 'c1', state: 'input-available', input: {} },
    ];
    const out = hydrateMessages([
      { ...base, id: 'a', role: 'assistant', content: 'Recorded your salary.', parts: toolOnlyParts },
    ]);
    expect(out[0]!.parts).toContainEqual({ type: 'text', text: 'Recorded your salary.' });
  });

  it('does not synthesize an empty text part when there is no content and no renderable parts', () => {
    const toolOnlyParts = [
      { type: 'tool-update_case', toolCallId: 'c1', state: 'input-available', input: {} },
    ];
    const out = hydrateMessages([
      { ...base, id: 'a', role: 'assistant', content: '', parts: toolOnlyParts },
    ]);
    // keep the tool parts; do not inject an empty text node
    expect(out[0]!.parts).toEqual(toolOnlyParts);
  });

  it('preserves tool parts that DO carry output (renderable) alongside text', () => {
    const parts = [
      { type: 'tool-update_case', toolCallId: 'c1', output: { type: 'update_case_result', version: 1, data: {} } },
    ];
    const out = hydrateMessages([
      { ...base, id: 'a', role: 'assistant', content: '', parts },
    ]);
    expect(out[0]!.parts).toEqual(parts);
  });
});
