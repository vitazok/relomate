import { z } from 'zod';
import { getConsulate } from '@/lib/rules/loader';
import { ConsulateId as ConsulateIdSchema, FormMode as FormModeSchema } from '@/lib/rules/types';
import type { CaseFacts } from '@/lib/case/schema';

export type FormMode = z.infer<typeof FormModeSchema>;
export type ConsulateId = z.infer<typeof ConsulateIdSchema>;

export interface FormOutputRequirement {
  mode: FormMode;
  consulateId: ConsulateId | null;
  source: 'consulate_rules' | 'missing_consulate' | 'invalid_consulate';
}

function targetConsulateValue(caseFacts: CaseFacts): unknown {
  return caseFacts.target?.targetConsulate?.value;
}

export function requiredFormOutputForCase(caseFacts: CaseFacts): FormOutputRequirement {
  const rawConsulate = targetConsulateValue(caseFacts);
  if (rawConsulate == null) {
    return { mode: 'unknown', consulateId: null, source: 'missing_consulate' };
  }

  const parsed = ConsulateIdSchema.safeParse(rawConsulate);
  if (!parsed.success) {
    return { mode: 'unknown', consulateId: null, source: 'invalid_consulate' };
  }

  return {
    mode: getConsulate(parsed.data).formMode,
    consulateId: parsed.data,
    source: 'consulate_rules',
  };
}
