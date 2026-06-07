import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { logCaseEvent } from '@/lib/inngest/functions/log-case-event';
import { extractDocument } from '@/lib/inngest/functions/extract-document';
import { generateDraft } from '@/lib/inngest/functions/generate-draft';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [logCaseEvent, extractDocument, generateDraft],
});
