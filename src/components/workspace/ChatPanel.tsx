'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { resolveRenderer, type ToolOutput } from '@/components/workspace/renderers/registry';
import { DocumentUpload } from '@/components/workspace/DocumentUpload';
import { ALLOWED_UPLOAD_ACCEPT } from '@/lib/documents/types';

function messageContainsUpdateCase(message: UIMessage): boolean {
  if (!Array.isArray(message.parts)) return false;
  for (const part of message.parts) {
    const t = (part as { type?: string }).type ?? '';
    if (t.startsWith('tool-update_case')) return true;
  }
  return false;
}

export function ChatPanel({ caseId, initialMessages }: { caseId: string; initialMessages: UIMessage[] }) {
  const router = useRouter();
  const [input, setInput] = useState('');

  const transport = useMemo(
    () => new DefaultChatTransport({ api: '/api/chat', body: { caseId } }),
    [caseId],
  );

  const { messages, sendMessage, status } = useChat({
    transport,
    messages: initialMessages,
    onFinish: ({ message }) => {
      if (messageContainsUpdateCase(message as UIMessage)) {
        router.refresh();
      }
    },
  });

  return (
    <aside className="flex h-screen flex-col border-l border-zinc-200">
      <header className="border-b border-zinc-200 p-3 text-xs font-semibold uppercase text-zinc-500">
        Chat
      </header>
      <ScrollArea className="flex-1 p-3">
        <div className="space-y-3">
          {messages.map((m) => (
            <div key={m.id} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <div
                className={`inline-block rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-zinc-100'}`}
              >
                {Array.isArray(m.parts)
                  ? m.parts.map((p, i) => {
                      const part = p as { type: string; text?: string };
                      if (part.type === 'text') return <span key={i}>{part.text}</span>;
                      if (part.type.startsWith('tool-')) {
                        const out = (part as { output?: ToolOutput }).output;
                        if (!out?.type) return null;
                        const Renderer = resolveRenderer(out.type);
                        return <Renderer key={i} output={out} />;
                      }
                      return null;
                    })
                  : null}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="border-t border-zinc-200 px-3 py-2">
        <DocumentUpload
          caseId={caseId}
          spineItemId={null}
          label="Upload a document"
          accept={ALLOWED_UPLOAD_ACCEPT}
        />
      </div>
      <form
        className="border-t border-zinc-200 p-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || status !== 'ready') return;
          sendMessage({ text: input });
          setInput('');
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell me about your situation…"
        />
        <Button type="submit" disabled={status !== 'ready' || !input.trim()}>
          Send
        </Button>
      </form>
    </aside>
  );
}
