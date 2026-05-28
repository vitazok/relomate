import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CaseFacts } from '@/lib/case/schema';

const SECTION_ORDER: Array<keyof CaseFacts> = ['employment', 'education', 'family', 'target'];

function isFieldValue(v: unknown): v is { value: unknown; source: string; confidence: number; updatedAt: string } {
  return typeof v === 'object' && v !== null && 'value' in v && 'source' in v;
}

export function Overview({ caseFacts }: { caseFacts: CaseFacts }) {
  const populatedSections = SECTION_ORDER.filter((k) => {
    const v = caseFacts[k] as unknown;
    return v && typeof v === 'object' && Object.keys(v).length > 0;
  });

  if (populatedSections.length === 0) {
    return (
      <main className="overflow-y-auto p-8">
        <h1 className="text-2xl font-semibold mb-2">Your case file</h1>
        <p className="text-zinc-600">
          Your case file is empty. Tell the agent on the right what&apos;s going on.
        </p>
      </main>
    );
  }

  return (
    <main className="overflow-y-auto p-8 space-y-4">
      <h1 className="text-2xl font-semibold">Your case file</h1>
      {populatedSections.map((section) => {
        const data = caseFacts[section] as Record<string, unknown>;
        return (
          <Card key={section}>
            <CardHeader>
              <CardTitle className="capitalize">{section}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {Object.entries(data).map(([key, value]) => (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-zinc-600">{key}</span>
                  <span className="font-mono">
                    {isFieldValue(value) ? String(value.value) : JSON.stringify(value)}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </main>
  );
}
