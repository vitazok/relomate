import { describe, it, expect } from 'vitest';
import { streamText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { makeScriptedModel, type ScriptStep } from './mock-stream';

describe('makeScriptedModel', () => {
  it('emits a text-only turn that streams its text and stops', async () => {
    const model = makeScriptedModel([{ kind: 'text', text: 'hello world' }]);
    let finishText: string | undefined;
    const result = streamText({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      onFinish: (e) => {
        finishText = e.text;
      },
    });
    let streamed = '';
    for await (const delta of result.textStream) streamed += delta;
    expect(streamed).toBe('hello world');
    expect(finishText).toBe('hello world');
  });

  it('drives a multi-step tool sequence: the SDK runs the real tool, then the model replies', async () => {
    const calls: string[] = [];
    const echo = tool({
      description: 'echo',
      inputSchema: z.object({ value: z.string() }),
      async execute({ value }) {
        calls.push(value);
        return { type: 'echo_result', version: 1 as const, data: { value } };
      },
    });

    const script: ScriptStep[] = [
      { kind: 'tool', toolCallId: 'c1', toolName: 'echo', input: { value: 'first' } },
      { kind: 'text', text: 'done' },
    ];
    const model = makeScriptedModel(script);

    let event: { steps: Array<{ toolResults: Array<{ toolName: string }> }> } | undefined;
    const result = streamText({
      model,
      tools: { echo },
      stopWhen: stepCountIs(8),
      messages: [{ role: 'user', content: 'go' }],
      onFinish: (e) => {
        event = e as never;
      },
    });
    let text = '';
    for await (const delta of result.textStream) text += delta;

    expect(calls).toEqual(['first']); // the REAL tool executed
    expect(text).toBe('done');
    // The result lives in steps[], not top-level (this is the SDK shape L2b depends on).
    const allToolResults = event!.steps.flatMap((s) => s.toolResults);
    expect(allToolResults.map((r) => r.toolName)).toContain('echo');
  });
});
