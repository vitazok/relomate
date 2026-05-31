import { streamText, stepCountIs, type LanguageModel, type ModelMessage } from 'ai';
import { systemPrompt, PROMPT_VERSION } from '@/lib/ai/chat/system-prompt';
import { buildAgentContext } from '@/lib/ai/chat/context-builder';
import { appendChatTurn } from '@/lib/ai/chat/persistence';
import { makeUpdateCaseTool } from '@/lib/ai/tools/update_case';
import { makeReadCaseTool } from '@/lib/ai/tools/read_case';
import { makeAddCaseNoteTool } from '@/lib/ai/tools/add_case_note';
import { makeOutOfScopeTool } from '@/lib/ai/tools/out_of_scope';
import { makeCheckEligibilityTool } from '@/lib/ai/tools/check_eligibility';
import { makeLookupAnabinTool } from '@/lib/ai/tools/lookup_anabin';
import { inngest } from '@/lib/inngest/client';
import { MODEL_ID } from '@/lib/ai/provider';
import type { Repository } from '@/lib/case/repository';
import type { CaseFacts } from '@/lib/case/schema';

// Max agent steps per turn. A turn may fan out: update_case + lookup_anabin, then
// read_case to recover, then check_eligibility, then a closing reply. 5 was too few
// once 2A.2 added eligibility/anabin tools — a turn that hit a tool error could
// exhaust the budget mid-recovery and end with no answer. 8 leaves room to recover
// AND still produce a natural-language reply after the last tool call.
export const MAX_AGENT_STEPS = 8;

export interface BuildAgentTurnParams {
  model: LanguageModel;
  repo: Repository;
  caseId: string;
  threadId: string;
  userId: string;
  userMessageId: string;
  caseFacts: CaseFacts;
  modelMessages: ModelMessage[];
}

function extractLastUserText(messages: { role?: string; content?: unknown }[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === 'user') {
      if (typeof m.content === 'string') return m.content;
      if (Array.isArray(m.content)) {
        const text = m.content.find((p: { type?: string; text?: string }) => p?.type === 'text');
        if (text && typeof text.text === 'string') return text.text;
      }
    }
  }
  return '';
}

export async function buildAgentTurn(params: BuildAgentTurnParams) {
  const { model, repo, caseId, threadId, userId, userMessageId, caseFacts, modelMessages } = params;

  const context = await buildAgentContext({ caseId, caseFacts });
  const system = `${systemPrompt}\n\n${context.systemContext}`;

  const tools = {
    update_case: makeUpdateCaseTool(repo, {
      defaultCaseId: caseId,
      defaultSourceTurnId: userMessageId,
    }),
    read_case: makeReadCaseTool(repo, { defaultCaseId: caseId }),
    add_case_note: makeAddCaseNoteTool(repo, {
      defaultCaseId: caseId,
      defaultUserId: userId,
      defaultSourceTurnId: userMessageId,
    }),
    out_of_scope: makeOutOfScopeTool(repo, { defaultCaseId: caseId, defaultUserId: userId }),
    check_eligibility: makeCheckEligibilityTool(repo, {
      defaultCaseId: caseId,
      defaultUserId: userId,
    }),
    // lookup_anabin MUST stay last: it carries the single cache_control breakpoint
    // (in its factory), which caches the whole static tools block. See lookup_anabin.ts.
    lookup_anabin: makeLookupAnabinTool(),
  };

  return streamText({
    model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(MAX_AGENT_STEPS),
    // Cache: the single tool-block cache_control breakpoint lives on lookup_anabin (the
    // last registered tool), caching the whole static tools prefix. Do NOT add a top-level
    // providerOptions.anthropic.cacheControl here, and do NOT re-add per-tool breakpoints —
    // Anthropic allows max 4, and the system string embeds per-turn case context (would miss).
    async onFinish(event) {
      try {
        await appendChatTurn({
          threadId,
          userMessageId,
          userMessageContent: extractLastUserText(modelMessages as never),
          assistantText: event.text,
          assistantParts: event.content,
          toolCalls: event.toolCalls.map((c) => ({
            toolCallId: c.toolCallId,
            toolName: c.toolName,
            input: c.input,
          })),
          toolResults: event.toolResults.map((r) => ({
            toolCallId: r.toolCallId,
            toolName: r.toolName,
            output: r.output,
          })),
          promptVersion: PROMPT_VERSION,
          modelVersion: MODEL_ID,
        });
      } catch (err) {
        console.error('appendChatTurn failed', err);
      }

      const updateResults = event.toolResults.filter((r) => r.toolName === 'update_case');
      for (const result of updateResults) {
        const data = (result.output as { data?: { updatedPaths?: string[] } })?.data;
        try {
          await inngest.send({
            name: 'case.facts.updated',
            data: {
              caseId,
              paths: data?.updatedPaths ?? [],
              sourceTurnId: userMessageId,
            },
          });
        } catch (err) {
          console.error('inngest emit failed', err);
        }
      }
    },
  });
}
