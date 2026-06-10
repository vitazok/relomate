import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { canAccessConsole } from '@/lib/auth/surface-access';
import { loadConsole, resolveMembership } from '@/lib/console/load';
import { ConsoleView } from '@/components/console/ConsoleView';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function ConsolePage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  const membership = await resolveMembership(db, userId);
  // Only firm operators may open the console. Applicants / employer contacts are bounced home;
  // they reach their own cases via the portal link, never the firm console.
  if (!membership || !canAccessConsole(membership.role)) redirect('/');

  const data = await loadConsole(db, membership, userId, new Date());
  return <ConsoleView role={data.role} buckets={data.buckets} />;
}
