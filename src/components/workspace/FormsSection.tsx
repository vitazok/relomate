import { AlertCircle, CheckCircle2, ExternalLink, FileText, MessageSquareText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FormsWorkspaceViewModel, MissingFormFieldView } from '@/lib/forms/view-model';

function ModePill({ modeLabel }: { modeLabel: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
      {modeLabel}
    </span>
  );
}

function MissingFieldRow({ field }: { field: MissingFormFieldView }) {
  const actionLabel =
    field.action === 'provide' ? 'Provide' : field.action === 'sign' ? 'Sign' : 'Pending';

  return (
    <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-zinc-100 py-2 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm text-zinc-900">
          <span className="font-mono text-xs text-zinc-500">{field.fieldNumber}</span>
          <span className="truncate">{field.label}</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {field.sourcePaths.map((path) => (
            <span key={path} className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-500">
              {path}
            </span>
          ))}
        </div>
      </div>
      <Button size="sm" variant="outline" disabled aria-label={`${actionLabel} ${field.label}`}>
        <MessageSquareText />
        {actionLabel}
      </Button>
    </div>
  );
}

function MissingGroup({
  title,
  fields,
  empty,
}: {
  title: string;
  fields: MissingFormFieldView[];
  empty: string;
}) {
  return (
    <div className="rounded-md border border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2">
        <h3 className="text-sm font-medium text-zinc-900">{title}</h3>
        <span className="text-xs text-zinc-500">{fields.length}</span>
      </div>
      <div className="px-3">
        {fields.length === 0 ? (
          <p className="py-3 text-sm text-zinc-500">{empty}</p>
        ) : (
          fields.map((field) => <MissingFieldRow key={`${field.fieldNumber}-${field.reason}`} field={field} />)
        )}
      </div>
    </div>
  );
}

export function FormsSection({ forms }: { forms: FormsWorkspaceViewModel }) {
  const complete = forms.filled === forms.total;

  return (
    <section id="forms" className="scroll-mt-8">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <FileText className="size-4 text-zinc-500" />
              Forms
            </span>
            <ModePill modeLabel={forms.modeLabel} />
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-zinc-950">{forms.headline}</h2>
              <p className="mt-1 max-w-2xl text-sm text-zinc-600">{forms.summary}</p>
              {forms.consulate && (
                <p className="mt-2 text-xs text-zinc-500">
                  {forms.consulate.officialName}
                  {forms.consulate.verifiedByUser === false ? ' · not user-verified yet' : ''}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="text-2xl font-semibold text-zinc-950">{forms.pct}%</div>
              <div className="text-xs text-zinc-500">
                {forms.filled} of {forms.total}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-zinc-500">
              <span>{forms.readinessLabel}</span>
              <span>{complete ? 'Complete' : `${forms.missing.length} missing`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full rounded-full bg-zinc-900" style={{ width: `${forms.pct}%` }} />
            </div>
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
            <div className="flex items-start gap-2">
              {complete ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-green-600" />
              ) : (
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-amber-600" />
              )}
              <p>{forms.consulate?.applicationForm ?? forms.summary}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!forms.ctaEnabled} aria-label={forms.ctaLabel}>
              <FileText />
              {forms.ctaLabel}
            </Button>
            {forms.consulate?.url && (
              <Button asChild variant="outline">
                <a href={forms.consulate.url} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  Source
                </a>
              </Button>
            )}
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <MissingGroup
              title="Needs case data"
              fields={forms.missingUserInput}
              empty="No user-provided fields are missing."
            />
            <MissingGroup
              title="Not modelled yet"
              fields={forms.missingSystemSupport}
              empty="No schema-backed gaps remain."
            />
            <MissingGroup
              title="Manual completion"
              fields={forms.manualSignature}
              empty="No manual-only fields remain."
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
