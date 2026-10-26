import { ChevronDown, LayoutGrid, LogOut, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { initials } from '@/lib/format';
import { useAuth } from '@/store/useAuth';

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const navigate = useNavigate();
  if (!user) return null;

  const signOut = async () => {
    await logout().catch(() => {});
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5 data-[state=open]:bg-muted" aria-label="Меню аккаунта">
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
              {initials(user.displayName)}
            </AvatarFallback>
          </Avatar>
          {!compact && (
            <>
              <span className="hidden max-w-40 truncate text-sm font-medium sm:inline">{user.displayName}</span>
              <ChevronDown className="hidden text-muted-foreground sm:inline" />
            </>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium text-foreground">{user.displayName}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => navigate('/')}>
            <LayoutGrid /> Мои схемы
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/account')}>
            <UserRound /> Аккаунт и устройства
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut /> Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
