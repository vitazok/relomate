import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopTask } from '@/lib/tasks/view-model';

function TaskRow({ task }: { task: TopTask }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded border border-zinc-200 px-3 py-2 text-sm">
      <span className="text-zinc-900">{task.title}</span>
      <div className="flex items-center gap-2 text-xs">
        {task.blocking && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
            needed soon
          </span>
        )}
        {task.overdue && (
          <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-700">overdue</span>
        )}
        {task.dueAt && <span className="text-zinc-500">due {task.dueAt.slice(0, 10)}</span>}
      </div>
    </li>
  );
}

export function PortalView({ tasks }: { caseId: string; tasks: TopTask[] }) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Your application</h1>
        <p className="text-sm text-zinc-500">
          Here’s what we need from you. Your consultant handles everything else.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">What we need from you</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-zinc-400">
              Nothing needs your attention right now. We’ll let you know when something comes up.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
