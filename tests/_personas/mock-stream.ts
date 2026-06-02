import { MockLanguageModelV3 } from 'ai/test';
import type { LanguageModel } from 'ai';

/**
 * One step of a scripted agent turn. A `tool` step makes the mock model emit a single tool
 * call (the SDK then runs the REAL tool and loops); a `text` step is terminal — it emits text
 * and finishReason 'stop', ending the loop.
 */
export type ScriptStep =
  | { kind: 'tool'; toolCallId: string; toolName: string; input: unknown }
  | { kind: 'text'; text: string };

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function chunksFor(step: ScriptStep) {
  if (step.kind === 'tool') {
    return [
      {
        type: 'tool-call' as const,
        toolCallId: step.toolCallId,
        toolName: step.toolName,
        input: JSON.stringify(step.input),
      },
      { type: 'finish' as const, finishReason: 'tool-calls' as const, usage: USAGE },
    ];
  }
  return [
    { type: 'text-start' as const, id: 't' },
    { type: 'text-delta' as const, id: 't', delta: step.text },
    { type: 'text-end' as const, id: 't' },
    { type: 'finish' as const, finishReason: 'stop' as const, usage: USAGE },
  ];
}

/**
 * Build a MockLanguageModelV3 that plays a scripted sequence of steps. The SDK calls doStream
 * once per step; this returns step i's chunks and advances. Shipped first-party in ai@6 — no msw,
 * no hand-rolled protocol. Assignable to `LanguageModel` with no cast.
 */
export function makeScriptedModel(steps: ScriptStep[]): LanguageModel {
  if (steps.length === 0) throw new Error('makeScriptedModel requires at least one step');
  let i = 0;
  return new MockLanguageModelV3({
    doStream: async () => {
      const step = steps[Math.min(i, steps.length - 1)];
      i++;
      return {
        stream: new ReadableStream({
          start(controller) {
            for (const chunk of chunksFor(step!)) {
              // reason: LanguageModelV3StreamPart and LanguageModelV3Usage are internal types not exported by ai@6;
              // chunksFor returns the correct runtime shape, but TS can't verify without the hidden types
              controller.enqueue(chunk as never);
            }
            controller.close();
          },
        }),
      };
    },
  });
}
