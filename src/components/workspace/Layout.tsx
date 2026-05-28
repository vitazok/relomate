import type { CaseFacts } from '@/lib/case/schema';
import type { UIMessage } from 'ai';
import { Nav } from './Nav';
import { Overview } from './Overview';
import { ChatPanel } from './ChatPanel';

export function Layout({
  caseId,
  caseFacts,
  initialMessages,
}: {
  caseId: string;
  caseFacts: CaseFacts;
  initialMessages: UIMessage[];
}) {
  return (
    <div className="grid h-screen grid-cols-[220px_1fr_360px]">
      <Nav />
      <Overview caseFacts={caseFacts} />
      <ChatPanel caseId={caseId} initialMessages={initialMessages} />
    </div>
  );
}
