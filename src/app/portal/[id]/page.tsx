import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth/session';
import { getCaseAuthorization } from '@/lib/auth/authorization';
import { caseSurface } from '@/lib/auth/surface-access';
import { loadPortal } from '@/lib/portal/load';
import { PortalView } from '@/components/portal/PortalView';
import { db } from '@/lib/db/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function PortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await getCurrentUserId();
  if (!userId) redirect('/');

  // A malformed (non-UUID) id makes the authorization query throw at the Postgres cast; treat it
  // as no-access rather than a 500, matching the case page's notFound-on-bad-id behavior.
  let auth;
  try {
    auth = await getCaseAuthorization(db, { userId, caseId: id, action: 'read' });
  } catch {
    redirect('/');
  }
  if (!auth) redirect('/');

  const surface = caseSurface(auth);
  if (surface === 'none') redirect('/');
  // A firm operator who lands on the portal is sent to their internal workspace. (They can still
  // preview the portal in a later iteration; for now the surfaces stay cleanly separated.)
  if (surface === 'firm') redirect(`/case/${id}`);

  const data = await loadPortal(db, {
    caseId: id,
    organizationId: auth.organizationId,
    now: new Date(),
  });
  return <PortalView caseId={data.caseId} tasks={data.tasks} />;
}
