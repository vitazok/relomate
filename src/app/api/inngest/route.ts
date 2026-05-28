import { serve } from 'inngest/next';
import { inngest } from '@/lib/inngest/client';
import { logCaseEvent } from '@/lib/inngest/functions/log-case-event';

export const runtime = 'nodejs';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [logCaseEvent],
});
