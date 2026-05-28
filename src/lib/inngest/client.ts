import { Inngest } from 'inngest';
import { env } from '@/lib/env';

export const inngest = new Inngest({
  id: 'visa',
  ...(env.INNGEST_EVENT_KEY && { eventKey: env.INNGEST_EVENT_KEY }),
  ...(env.INNGEST_SIGNING_KEY && { signingKey: env.INNGEST_SIGNING_KEY }),
});

export type CaseFactsUpdatedEvent = {
  name: 'case.facts.updated';
  data: { caseId: string; paths: string[]; sourceTurnId: string };
};
