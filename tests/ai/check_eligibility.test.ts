import { describe, it, expect, vi } from 'vitest';
import { makeCheckEligibilityTool } from '@/lib/ai/tools/check_eligibility';
import type { CaseFacts } from '@/lib/case/schema';
import type { Profile } from '@/lib/profile/schema';

const CASE_ID = 'c0000000-0000-4000-8000-000000000000';
const USER_ID = 'u0000000-0000-4000-8000-000000000000';
const TODAY = new Date('2026-05-27T00:00:00.000Z');
const ISO = TODAY.toISOString();
const PROV = { source: 'user_stated' as const, sourceTurnId: null, confidence: 1, updatedAt: ISO };
const f = <T>(value: T) => ({ value, ...PROV });
const profile: Profile = { schemaVersion: 1 };

function makeRepo(caseFacts: CaseFacts) {
  return {
    loadCase: vi.fn().mockResolvedValue({ profile, caseFacts, threadId: 't', case: {} }),
    appendActivity: vi.fn().mockResolvedValue(undefined),
  };
}
const defaults = (repo: ReturnType<typeof makeRepo>) => ({
  defaultCaseId: CASE_ID,
  defaultUserId: USER_ID,
  now: () => TODAY,
});

describe('check_eligibility tool', () => {
  it('returns incomplete with missing paths and logs activity', async () => {
    const repo = makeRepo({ education: { anabinStatus: f('H+') } }); // no salary
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as {
      type: string; data: { status: string; missing?: string[] };
    };
    expect(out.type).toBe('eligibility_result');
    expect(out.data.status).toBe('incomplete');
    expect(out.data.missing).toContain('employment.annualGrossSalaryEur');
    expect(repo.appendActivity).toHaveBeenCalledOnce();
    expect(repo.appendActivity.mock.calls[0]![0].kind).toBe('case.eligibility.checked');
  });

  it('returns assessed with figures and granted routes for a strong case', async () => {
    const repo = makeRepo({
      employment: { annualGrossSalaryEur: f(60000), iscoCode: f('2512') },
      education: { anabinStatus: f('H+'), highestDegree: f('master_eqf7') },
    });
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as {
      data: { status: string; routes: string[]; figures: { standard: { meets: boolean } } };
    };
    expect(out.data.status).toBe('assessed');
    expect(out.data.routes).toContain('standard');
    expect(out.data.figures.standard.meets).toBe(true);
    expect(repo.appendActivity.mock.calls[0]![0].payload).not.toHaveProperty('salaryOnFile');
    expect(repo.appendActivity.mock.calls[0]![0].payload).toMatchObject({
      status: 'assessed',
      routes: expect.any(Array),
      blockers: expect.any(Array),
    });
  });

  it('returns out_of_scope and does NOT log activity for non-blue-card visa', async () => {
    const repo = makeRepo({
      target: { intendedVisa: f('student' as 'blue_card') },
      employment: { annualGrossSalaryEur: f(60000) },
      education: { anabinStatus: f('H+') },
    });
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as { data: { status: string } };
    expect(out.data.status).toBe('out_of_scope');
    expect(repo.appendActivity).not.toHaveBeenCalled();
  });

  it('returns assessed with qualifies=false and logs activity for an anabin-unknown case', async () => {
    const repo = makeRepo({
      employment: { annualGrossSalaryEur: f(50000), iscoCode: f('2512') },
      education: { anabinStatus: f('unknown'), highestDegree: f('bachelor_eqf6') },
      target: { intendedVisa: f('blue_card') },
    });
    const tool = makeCheckEligibilityTool(repo, defaults(repo));
    const out = (await tool.execute!({}, {} as never)) as {
      data: { status: string; qualifies: boolean; blockers: string[] };
    };
    expect(out.data.status).toBe('assessed');
    expect(out.data.qualifies).toBe(false);
    expect(out.data.blockers).toContain('anabin_status_unknown');
    expect(repo.appendActivity).toHaveBeenCalledOnce();
    expect(repo.appendActivity.mock.calls[0]![0].payload.status).toBe('assessed');
  });
});
