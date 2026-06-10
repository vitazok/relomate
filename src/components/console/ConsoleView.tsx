import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ConsoleBuckets, ConsoleCase } from '@/lib/console/view-model';
import type { OrganizationRole } from '@/lib/auth/authorization';

function CaseRow({ c }: { c: ConsoleCase }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-zinc-200 px-3 py-2 text-sm">
      <Link href={`/case/${c.id}`} className="font-medium text-zinc-900 hover:underline">
        {c.id.slice(0, 8)}
      </Link>
      <div className="flex items-center gap-2 text-xs">
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">{c.status}</span>
        {c.blocked && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">blocked</span>
        )}
        {c.overdue && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
            overdue
          </span>
        )}
        {c.assignedConsultantId == null && (
          <span className="rounded bg-blue-100 px-1.5 py-0.5 font-medium text-blue-700">
            unassigned
          </span>
        )}
      </div>
    </li>
  );
}

function Bucket({ title, cases }: { title: string; cases: ConsoleCase[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm">
          <span>{title}</span>
          <span className="text-xs font-normal text-zinc-500">{cases.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {cases.length === 0 ? (
          <p className="text-xs text-zinc-400">Nothing here.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {cases.map((c) => (
              <CaseRow key={c.id} c={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function ConsoleView({ role, buckets }: { role: OrganizationRole; buckets: ConsoleBuckets }) {
  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Firm console</h1>
        <p className="text-sm text-zinc-500">Signed in as {role.replace('_', ' ')}</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        <Bucket title="Assigned to me" cases={buckets.assignedToMe} />
        <Bucket title="Unassigned" cases={buckets.unassigned} />
        <Bucket title="Blocked / overdue" cases={buckets.blockedOrOverdue} />
      </div>
    </main>
  );
}
