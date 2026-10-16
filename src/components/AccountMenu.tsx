import { useEffect, useState } from 'react';
import { parseMe, type SessionState } from '../model/session';

const RECHECK_MS = 5 * 60 * 1000;

async function fetchSession(): Promise<SessionState | null> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' });
    return parseMe(res.status, res.headers.get('content-type') ?? '', await res.text());
  } catch {
    return null; // offline or the server restarting: keep whatever we knew
  }
}

/** The signed-in user, re-checked when the tab regains focus and every few minutes; an expired session sends the browser to /login. */
function useSession(): SessionState | null {
  const [session, setSession] = useState<SessionState | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const next = await fetchSession();
      if (!alive || next === null) return;
      setSession(next);
      if (next.kind === 'signed-out') location.assign('/login');
    };
    void check();
    const onVisible = () => document.visibilityState === 'visible' && void check();
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(check, RECHECK_MS);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, []);
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } catch {
    /* the login page is shown either way; a failed call just leaves the cookie until it expires */
  }
  location.assign('/login');
}

/** The signed-in email and a Sign out button. Renders nothing when Google sign-in is off (local dev, an open site). */
export function AccountMenu({ buttonClassName = 'btn' }: { buttonClassName?: string }) {
  const session = useSession();
  if (session?.kind !== 'signed-in') return null;
  return (
    <span className="account">
      <span className="account__email" title={`Signed in as ${session.email}`}>{session.email}</span>
      <button type="button" className={buttonClassName} onClick={() => void signOut()}>Sign out</button>
    </span>
  );
}
