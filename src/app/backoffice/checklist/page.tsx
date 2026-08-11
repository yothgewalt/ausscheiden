import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ADMIN_COOKIE, isAdminToken } from '../../../server/admin';
import { Checklist } from '../../../components/backoffice/Checklist';

export default async function ChecklistPage() {
  if (!isAdminToken((await cookies()).get(ADMIN_COOKIE)?.value)) redirect('/backoffice');
  return <Checklist />;
}
