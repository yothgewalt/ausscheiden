import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { ADMIN_COOKIE, isAdminToken } from '../../server/admin';
import { TRPCProvider } from '../../components/TRPCProvider';
import { BackofficeNav } from '../../components/backoffice/BackofficeNav';

export const metadata: Metadata = {
  title: 'หลังบ้าน — 30 ปี ไอที',
  robots: { index: false, follow: false },
};

// The root layout renders <body>{children}</body> bare and TRPCProvider lives
// inside src/App.tsx, so this branch supplies both its own shell and its own
// tRPC client.
export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  // Nav only makes sense once you are in; the token screen gets a bare page.
  // The pages re-check this themselves — every actual byte of data is gated on
  // adminProcedure, so this read is presentation, not security.
  const signedIn = isAdminToken((await cookies()).get(ADMIN_COOKIE)?.value);

  return (
    <TRPCProvider>
      <div className="min-h-screen bg-page text-primary font-sans antialiased">
        {signedIn && <BackofficeNav />}
        {children}
      </div>
    </TRPCProvider>
  );
}
