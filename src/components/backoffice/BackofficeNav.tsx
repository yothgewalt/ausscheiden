'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutGrid, ListChecks, LogOut } from 'lucide-react';

const LINKS = [
  { href: '/backoffice', label: 'แดชบอร์ด', icon: LayoutGrid },
  { href: '/backoffice/checklist', label: 'เช็คลิสต์', icon: ListChecks },
];

export function BackofficeNav() {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await fetch('/api/backoffice/session', { method: 'DELETE' });
    router.refresh();
  };

  return (
    <div className="hairline-b bg-surface">
      <div className="max-w-300 mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <div className="flex items-center gap-1">
          <span className="text-sm font-semibold text-primary mr-4 shrink-0">หลังบ้าน</span>
          {LINKS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                  active ? 'bg-page text-primary' : 'text-muted hover:text-primary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{label}</span>
              </Link>
            );
          })}
        </div>

        <button
          onClick={logout}
          className="px-2.5 py-1 rounded-lg text-xs font-bold text-muted hover:text-primary flex items-center gap-1 transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>ออกจากระบบ</span>
        </button>
      </div>
    </div>
  );
}
