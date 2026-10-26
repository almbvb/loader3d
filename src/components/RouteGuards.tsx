import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { LogoMark } from '@/components/Logo';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/store/useAuth';

export function FullScreenLoader({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-4 text-sm text-muted-foreground">
        <LogoMark className="size-10" />
        <span className="flex items-center gap-2">
          <Spinner /> {label}
        </span>
      </div>
    </div>
  );
}

/** While the session is being restored on page load. */
function SessionLoader() {
  const reconnecting = useAuth((s) => s.reconnecting);
  return <FullScreenLoader label={reconnecting ? 'Нет связи с сервером, переподключаемся…' : undefined} />;
}

/** Pages for logged-in users; others go to /login and come back afterwards. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <SessionLoader />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return children;
}

/** Login / register: a logged-in user goes straight to the app. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <SessionLoader />;
  if (status === 'authenticated') {
    return <Navigate to={(location.state as { from?: string } | null)?.from ?? '/'} replace />;
  }
  return children;
}
