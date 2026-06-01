import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { EligibilityVerdict } from '@/lib/case/schema';
import type { JourneyProgress, PhaseProgress, StepProgress } from '@/lib/journey/types';

export function phaseBadge(phase: PhaseProgress): string {
  if (phase.status === 'locked') return 'Coming soon';
  return `${phase.completed}/${phase.total}`;
}

function statusDotClass(status: PhaseProgress['status']): string {
  switch (status) {
    case 'done':
      return 'bg-green-500';
    case 'active':
      return 'bg-amber-500';
    case 'locked':
      return 'bg-zinc-300';
    default:
      return 'bg-zinc-400';
  }
}

function ProvenanceLine({ step }: { step: StepProgress }) {
  const req = step.requirementCitation;
  const ans = step.answerProvenance;
  if (!req && !ans) return null;
  return (
    <details className="mt-1 text-xs text-zinc-500">
      <summary className="cursor-pointer select-none">
        {ans ? ans.label : 'Why this is needed'}
      </summary>
      <div className="mt-1 space-y-1 pl-3">
        {req && (
          <p>
            {req.explainer}
            {req.legalBasis ? ` · ${req.legalBasis}` : ''}
            {req.sourceUrl ? (
              <>
                {' · '}
                <a className="underline" href={req.sourceUrl} target="_blank" rel="noreferrer">
                  source
                </a>
              </>
            ) : null}
            {req.lastVerified ? ` · verified ${req.lastVerified}` : ''}
          </p>
        )}
        {ans?.updatedAt && <p>Updated {ans.updatedAt.slice(0, 10)}</p>}
      </div>
    </details>
  );
}

function StepRow({ step }: { step: StepProgress }) {
  return (
    <div className="border-b border-zinc-100 py-2 last:border-0">
      <div className="flex items-center justify-between text-sm">
        <span className={step.state === 'complete' ? 'text-zinc-900' : 'text-zinc-500'}>
          {step.state === 'complete' ? '✓ ' : '○ '}
          {step.label}
        </span>
        <span className="font-mono text-xs text-zinc-600">
          {step.value ?? (step.action ? '' : 'not provided yet')}
        </span>
      </div>
      <ProvenanceLine step={step} />
    </div>
  );
}

function groupByMember(steps: StepProgress[]): Array<[string | null, StepProgress[]]> {
  const order: Array<string | null> = [];
  const map = new Map<string | null, StepProgress[]>();
  for (const s of steps) {
    const key = s.group ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(s);
  }
  return order.map((k) => [k, map.get(k)!]);
}

function PhaseCard({ phase }: { phase: PhaseProgress }) {
  const grouped = groupByMember(phase.steps);
  return (
    <Card className={phase.status === 'locked' ? 'opacity-60' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <span className={`inline-block h-2 w-2 rounded-full ${statusDotClass(phase.status)}`} />
            {phase.label}
          </span>
          <span className="text-sm font-normal text-zinc-500">{phaseBadge(phase)}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {phase.status === 'locked' ? (
          <p className="text-sm text-zinc-500">{phase.comingSoon}</p>
        ) : phase.steps.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing here yet.</p>
        ) : (
          grouped.map(([group, steps]) => (
            <div key={group ?? '_'} className="mb-2 last:mb-0">
              {group && <p className="mb-1 text-xs font-semibold uppercase text-zinc-400">{group}</p>}
              {steps.map((s) => (
                <StepRow key={s.id} step={s} />
              ))}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function Tracker({
  progress,
  eligibilityHeadline,
}: {
  progress: JourneyProgress;
  eligibilityHeadline: EligibilityVerdict | null;
}) {
  const anyProgress = progress.phases.some((p) => p.completed > 0);

  return (
    <main className="overflow-y-auto p-8 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Your application journey</h1>
        <span className="text-sm text-zinc-500">{progress.overallPct}% complete</span>
      </div>

      {!anyProgress && (
        <p className="text-zinc-600">
          Your case file is empty. Tell the agent on the right what&apos;s going on, and this
          tracker will fill in as we learn about your situation.
        </p>
      )}

      {eligibilityHeadline && eligibilityHeadline.outOfScope && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          This case looks out of scope for an EU Blue Card. The agent can explain why.
        </p>
      )}

      {progress.phases.map((phase) => (
        <PhaseCard key={phase.id} phase={phase} />
      ))}
    </main>
  );
}
