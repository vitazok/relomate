import type { EligibilityVerdict } from '@/lib/case/schema';
import type { FormsWorkspaceViewModel } from '@/lib/forms/view-model';
import type { JourneyProgress } from '@/lib/journey/types';
import type { UIMessage } from 'ai';
import { Nav } from './Nav';
import { Tracker } from './Tracker';
import { ChatPanel } from './ChatPanel';

export function Layout({
  caseId,
  progress,
  forms,
  eligibilityVerdict,
  initialMessages,
}: {
  caseId: string;
  progress: JourneyProgress;
  forms: FormsWorkspaceViewModel;
  eligibilityVerdict: EligibilityVerdict | null;
  initialMessages: UIMessage[];
}) {
  return (
    <div className="grid h-screen grid-cols-[220px_1fr_360px]">
      <Nav />
      <Tracker caseId={caseId} progress={progress} forms={forms} eligibilityHeadline={eligibilityVerdict} />
      <ChatPanel caseId={caseId} initialMessages={initialMessages} />
    </div>
  );
}
