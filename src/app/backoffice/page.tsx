import { cookies } from 'next/headers';
import { ADMIN_COOKIE, isAdminToken } from '../../server/admin';
import { LoginForm } from '../../components/backoffice/LoginForm';
import { Dashboard } from '../../components/backoffice/Dashboard';

// /backoffice IS the login screen when signed out — one URL, no redirect loop
// between a gate and a separate /login route. The gate is UX; the data behind
// the dashboard is protected by adminProcedure regardless of what renders here.
export default async function BackofficePage() {
  const signedIn = isAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);
  return signedIn ? <Dashboard /> : <LoginForm />;
}
