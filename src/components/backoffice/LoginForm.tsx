'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, AlertTriangle } from 'lucide-react';

export function LoginForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/backoffice/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        return;
      }
      // The cookie is set; re-render the server component so it sees it.
      router.refresh();
    } catch {
      setError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      {/* The one card on this screen, and it is the only actionable thing on it. */}
      <div className="w-full max-w-sm bg-surface rounded-lg card-shadow overflow-hidden">
        <div className="px-5 py-3 hairline-b flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-muted" />
          <span className="text-base font-bold text-primary">เข้าสู่ระบบหลังบ้าน</span>
        </div>

        <form onSubmit={submit} noValidate className="p-5 space-y-4">
          <div>
            <label className="text-xs font-semibold text-primary mb-1.5 flex items-center gap-1.5">
              <span>โทเคนผู้ดูแล</span>
            </label>
            <input
              type="password"
              required
              autoFocus
              autoComplete="off"
              placeholder="วางโทเคนที่นี่"
              value={token}
              onChange={(e) => {
                setToken(e.target.value);
                if (error) setError('');
              }}
              className={`w-full bg-surface rounded-lg px-3.5 py-2.5 text-sm text-primary placeholder:text-subtle font-mono transition-colors focus:outline-none focus:ring-2 ${
                error
                  ? 'border border-[#DC2626] focus:border-[#DC2626] focus:ring-[#DC2626]/20'
                  : 'border border-[rgba(20,20,20,0.16)] focus:border-primary focus:ring-primary/15'
              }`}
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-page text-primary text-xs font-medium flex items-center gap-2 animate-shake">
              <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy || token.trim().length === 0}
            className="w-full py-3 rounded-lg bg-primary hover:bg-primary/90 text-white text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  );
}
