import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import { UserMenu } from '@/components/UserMenu';

/** Header of the plans, account and admin pages. */
export function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-12 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Logo to="/plans" />
        <div className="flex flex-1 items-center justify-end gap-2">
          {children}
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
