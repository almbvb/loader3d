import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Building2,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  FileStack,
  Inbox,
  KeyRound,
  LogOut,
  Mail,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Sparkles,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { ApiError, errorMessage } from '@/api/client';
import { adminApi, type AdminUserQuery } from '@/api/endpoints';
import type { AdminSubscription, AdminUser, AdminUserSort, AdminUserStatus, Lead, LeadStatus, TierId } from '@/api/types';
import { AppHeader } from '@/components/AppHeader';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { fullDate, initials, plural, timeAgo } from '@/lib/format';
import { TIERS, TIERS_ENABLED, tierInfo } from '@/lib/tiers';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/useAuth';

const PAGE = 25;
const ALL = 'all';

const SORTS: Array<{ value: AdminUserSort; label: string }> = [
  { value: '-createdAt', label: 'Сначала новые' },
  { value: 'createdAt', label: 'Сначала старые' },
  { value: '-lastActiveAt', label: 'По активности' },
  { value: 'email', label: 'По email' },
];

const STATUSES: Array<{ value: AdminUserStatus; label: string }> = [
  { value: 'active', label: 'Активные' },
  { value: 'blocked', label: 'Заблокированные' },
  { value: 'admins', label: 'Администраторы' },
];

const TIER_TONE: Record<TierId, string> = {
  free: 'bg-muted text-muted-foreground',
  pro: 'bg-primary/10 text-primary',
  custom: 'bg-amber-500/12 text-amber-700',
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function useInvalidateAdmin() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['admin'] });
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** /admin: accounts, their subscriptions and requests from the landing page. */
export function AdminPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: adminApi.stats });
  const [tab, setTab] = useState('users');

  return (
    <div className="min-h-dvh">
      <AppHeader />
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-16 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Администрирование</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {TIERS_ENABLED ? 'Пользователи, тарифы и заявки с сайта.' : 'Пользователи и заявки с сайта.'}
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={Users}
            label="Пользователи"
            value={stats.data?.users}
            note={stats.data && `+${stats.data.newLast7Days} за неделю`}
          />
          <Stat
            icon={UserCheck}
            label="Активны за 7 дней"
            value={stats.data?.activeLast7Days}
            note={stats.data && (stats.data.blocked ? `${stats.data.blocked} заблокировано` : 'никто не заблокирован')}
          />
          {TIERS_ENABLED ? (
            <Stat
              icon={Sparkles}
              label="Платные тарифы"
              value={stats.data?.byTier ? stats.data.byTier.pro + stats.data.byTier.custom : stats.data && 0}
              note={
                stats.data?.byTier &&
                `Профи ${stats.data.byTier.pro} · Индивид. ${stats.data.byTier.custom} · Старт ${stats.data.byTier.free}`
              }
            />
          ) : (
            <Stat icon={Inbox} label="Новые заявки" value={stats.data?.newLeads} note={stats.data && 'с главной страницы'} />
          )}
          <Stat
            icon={FileStack}
            label="Схем сохранено"
            value={stats.data?.plans}
            note={
              stats.data &&
              (TIERS_ENABLED
                ? plural(stats.data.newLeads, ['новая заявка', 'новые заявки', 'новых заявок'])
                : 'у всех пользователей')
            }
          />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-8">
          <TabsList>
            <TabsTrigger value="users">
              <Users /> Пользователи
            </TabsTrigger>
            <TabsTrigger value="leads">
              <Inbox /> Заявки
              {!!stats.data?.newLeads && (
                <Badge className="ml-1 h-4.5 min-w-4.5 px-1 tabular-nums">{stats.data.newLeads}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersTab />
          </TabsContent>
          <TabsContent value="leads" className="mt-4">
            <LeadsTab />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function Stat({ icon: Icon, label, value, note }: { icon: typeof Users; label: string; value?: number; note?: ReactNode }) {
  return (
    <Card className="gap-1 p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      {value === undefined ? (
        <Skeleton className="mt-1 h-7 w-14" />
      ) : (
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{value.toLocaleString('ru-RU')}</div>
      )}
      <div className="truncate text-xs text-muted-foreground">{note ?? ' '}</div>
    </Card>
  );
}

// ------------------------------------------------------------------ users

function UsersTab() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), 250);
  const [tier, setTier] = useState<TierId | typeof ALL>(ALL);
  const [status, setStatus] = useState<AdminUserStatus | typeof ALL>(ALL);
  const [sort, setSort] = useState<AdminUserSort>('-createdAt');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  useEffect(() => setOffset(0), [q, tier, status, sort]);

  const query: AdminUserQuery = {
    q: q || undefined,
    tier: tier === ALL ? undefined : tier,
    status: status === ALL ? undefined : status,
    sort,
    limit: PAGE,
    offset,
  };
  const users = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: ({ signal }) => adminApi.users(query, signal),
    placeholderData: keepPreviousData,
  });
  const total = users.data?.total ?? 0;

  return (
    <>
      <div className="flex flex-col gap-2 lg:flex-row">
        <InputGroup className="h-9 lg:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput placeholder="Email или имя" value={search} aria-label="Поиск" onChange={(e) => setSearch(e.target.value)} />
          {search && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton size="icon-xs" aria-label="Очистить поиск" onClick={() => setSearch('')}>
                <X />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          {TIERS_ENABLED && (
            <Select value={tier} onValueChange={(v) => setTier(v as TierId | typeof ALL)}>
              <SelectTrigger className="h-9 w-full sm:w-44" aria-label="Тариф">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Все тарифы</SelectItem>
                {TIERS.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={status} onValueChange={(v) => setStatus(v as AdminUserStatus | typeof ALL)}>
            <SelectTrigger className="h-9 w-full sm:w-48" aria-label="Статус">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Все пользователи</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as AdminUserSort)}>
            <SelectTrigger className="col-span-2 h-9 w-full sm:w-44" aria-label="Сортировка">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button className="lg:ml-auto" onClick={() => setCreating(true)}>
          <UserPlus /> Новый пользователь
        </Button>
      </div>

      <Card className="mt-4 gap-0 overflow-hidden p-0">
        {users.isPending ? (
          <div className="space-y-px">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-none" />
            ))}
          </div>
        ) : users.isError ? (
          <p className="p-6 text-sm text-destructive">{errorMessage(users.error)}</p>
        ) : users.data.items.length === 0 ? (
          <Empty className="py-12">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Users />
              </EmptyMedia>
              <EmptyTitle>Никого не нашли</EmptyTitle>
              <EmptyDescription>Измените поиск или фильтры.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Пользователь</th>
                  {TIERS_ENABLED && <th className="px-4 py-2.5 font-medium">Тариф</th>}
                  <th className="px-4 py-2.5 text-right font-medium">Схемы</th>
                  <th className="px-4 py-2.5 font-medium">Активность</th>
                  <th className="px-4 py-2.5 font-medium">Создан</th>
                  <th className="w-12 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody className={cn('divide-y', users.isPlaceholderData && 'opacity-60')}>
                {users.data.items.map((u) => (
                  <UserRow key={u.id} user={u} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE && (
          <div className="flex items-center justify-between border-t px-4 py-2.5 text-sm text-muted-foreground">
            <span className="tabular-nums">
              {offset + 1}–{Math.min(offset + PAGE, total)} из {total}
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Назад" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Дальше" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        )}
      </Card>
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}

function TierBadge({ tier, className }: { tier: TierId; className?: string }) {
  return (
    <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-xs font-medium', TIER_TONE[tier], className)}>
      {tierInfo(tier).name}
    </span>
  );
}

function subscriptionNote(u: AdminUser): string {
  const s = u.subscription;
  if (!s) return '';
  if (s.tier !== s.effectiveTier) return `«${tierInfo(s.tier).name}» истёк ${s.expiresAt ? shortDate(s.expiresAt) : ''}`;
  if (s.tier === 'free') return s.trialUsed ? 'пробный период использован' : '';
  const until = s.expiresAt ? `до ${shortDate(s.expiresAt)}` : 'без срока';
  return s.trial ? `пробный, ${until}` : until;
}

type Dialogs = 'subscription' | 'password' | 'delete' | null;

function UserRow({ user }: { user: AdminUser }) {
  const me = useAuth((s) => s.user?.id === user.id);
  const invalidate = useInvalidateAdmin();
  const [dialog, setDialog] = useState<Dialogs>(null);
  const update = useMutation({
    mutationFn: (body: { isActive?: boolean; isAdmin?: boolean }) => adminApi.updateUser(user.id, body),
    onSuccess: (_, body) => {
      void invalidate();
      if (body.isActive === false) toast.success(`${user.email} заблокирован, сессии завершены`);
      else if (body.isActive) toast.success(`${user.email} разблокирован`);
      else toast.success(body.isAdmin ? `${user.email} — теперь администратор` : `${user.email} больше не администратор`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const endSessions = useMutation({
    mutationFn: () => adminApi.endSessions(user.id),
    onSuccess: () => {
      void invalidate();
      toast.success('Все сессии пользователя завершены');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const note = subscriptionNote(user);

  return (
    <tr className={cn('align-middle', !user.isActive && 'bg-destructive/[0.03]')}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">{initials(user.displayName)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium">{user.displayName}</span>
              {me && <Badge variant="secondary">Вы</Badge>}
              {user.isAdmin && (
                <Badge variant="outline" className="gap-1">
                  <ShieldCheck className="size-3" /> Админ
                </Badge>
              )}
              {!user.isActive && <Badge variant="destructive">Заблокирован</Badge>}
            </div>
            <div className="truncate text-xs text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </td>
      {user.subscription && (
        <td className="px-4 py-3">
          <button type="button" onClick={() => setDialog('subscription')} className="group/tier text-left" title="Изменить тариф">
            <TierBadge tier={user.subscription.effectiveTier} className="group-hover/tier:ring-1 group-hover/tier:ring-current/30" />
            {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
          </button>
        </td>
      )}
      <td className="px-4 py-3 text-right tabular-nums">{user.planCount}</td>
      <td className="px-4 py-3 text-muted-foreground">
        {user.lastActiveAt ? (
          <span title={fullDate(user.lastActiveAt)}>{timeAgo(user.lastActiveAt)}</span>
        ) : (
          'не входил'
        )}
        {user.sessionCount > 0 && <div className="text-xs">{plural(user.sessionCount, ['устройство', 'устройства', 'устройств'])}</div>}
      </td>
      <td className="px-4 py-3 text-muted-foreground" title={fullDate(user.createdAt)}>
        {shortDate(user.createdAt)}
      </td>
      <td className="px-2 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Действия: ${user.email}`} disabled={update.isPending}>
              {update.isPending ? <Spinner /> : <Ellipsis />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            {user.subscription && (
              <DropdownMenuItem onSelect={() => setDialog('subscription')}>
                <Sparkles /> Тариф и срок…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setDialog('password')}>
              <KeyRound /> Задать новый пароль…
            </DropdownMenuItem>
            <DropdownMenuItem disabled={user.sessionCount === 0} onSelect={() => endSessions.mutate()}>
              <LogOut /> Завершить все сессии
            </DropdownMenuItem>
            {!me && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => update.mutate({ isAdmin: !user.isAdmin })}>
                  {user.isAdmin ? <ShieldOff /> : <ShieldCheck />}
                  {user.isAdmin ? 'Снять права администратора' : 'Сделать администратором'}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => update.mutate({ isActive: !user.isActive })}>
                  {user.isActive ? <Ban /> : <UserCheck />}
                  {user.isActive ? 'Заблокировать' : 'Разблокировать'}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
                  <Trash2 /> Удалить аккаунт…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {user.subscription && (
          <SubscriptionDialog
            user={user}
            subscription={user.subscription}
            open={dialog === 'subscription'}
            onOpenChange={(o) => setDialog(o ? 'subscription' : null)}
          />
        )}
        <PasswordDialog user={user} open={dialog === 'password'} onOpenChange={(o) => setDialog(o ? 'password' : null)} />
        <DeleteUserDialog user={user} open={dialog === 'delete'} onOpenChange={(o) => setDialog(o ? 'delete' : null)} />
      </td>
    </tr>
  );
}

/** <input type="date"> value ↔ ISO: the period ends at the end of the chosen day, local time. */
function toDateInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fromDateInput(value: string): string | null {
  return value ? new Date(`${value}T23:59:59`).toISOString() : null;
}

function addMonths(months: number, from = new Date()): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + months);
  return toDateInput(d.toISOString());
}

function numberOrNull(value: string): number | null {
  const n = Number(value);
  return value.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function SubscriptionDialog({
  user,
  subscription: s,
  open,
  onOpenChange,
}: {
  user: AdminUser;
  subscription: AdminSubscription;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const invalidate = useInvalidateAdmin();
  const [tier, setTier] = useState<TierId>(s.tier);
  const [expires, setExpires] = useState(toDateInput(s.expiresAt));
  const [trial, setTrial] = useState(s.trial);
  const [plans, setPlans] = useState(String(s.limits?.plans ?? ''));
  const [vehicles, setVehicles] = useState(String(s.limits?.vehicles ?? ''));
  const [items, setItems] = useState(String(s.limits?.items ?? ''));
  const [note, setNote] = useState(s.note ?? '');
  useEffect(() => {
    if (!open) return;
    setTier(s.tier);
    setExpires(toDateInput(s.expiresAt));
    setTrial(s.trial);
    setPlans(String(s.limits?.plans ?? ''));
    setVehicles(String(s.limits?.vehicles ?? ''));
    setItems(String(s.limits?.items ?? ''));
    setNote(s.note ?? '');
  }, [open, s]);

  const save = useMutation({
    mutationFn: () =>
      adminApi.setSubscription(user.id, {
        tier,
        expiresAt: tier === 'free' ? null : fromDateInput(expires),
        trial: tier === 'pro' && trial,
        limits:
          tier === 'custom'
            ? { plans: numberOrNull(plans), vehicles: numberOrNull(vehicles), items: numberOrNull(items) }
            : null,
        note: note.trim() || null,
      }),
    onSuccess: () => {
      void invalidate();
      toast.success(`Тариф «${tierInfo(tier).name}» сохранён для ${user.email}`);
      onOpenChange(false);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Тариф пользователя</DialogTitle>
            <DialogDescription>{user.email}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <div role="radiogroup" aria-label="Тариф" className="grid grid-cols-3 gap-2">
              {TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={tier === t.id}
                  onClick={() => setTier(t.id)}
                  className={cn(
                    'rounded-xl border p-2.5 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    tier === t.id ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/60',
                  )}
                >
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.price === null ? 'по договору' : t.price.monthly === 0 ? 'бесплатно' : `${t.price.monthly} ₽/мес`}
                  </span>
                </button>
              ))}
            </div>

            {tier !== 'free' && (
              <Field>
                <FieldLabel htmlFor="sub-expires">
                  <CalendarClock className="size-4 text-muted-foreground" /> Действует до
                </FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Input id="sub-expires" type="date" className="w-44" value={expires} onChange={(e) => setExpires(e.target.value)} />
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setExpires(addMonths(1))}>
                    +1 мес.
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-9" onClick={() => setExpires(addMonths(12))}>
                    +1 год
                  </Button>
                  <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setExpires('')}>
                    Без срока
                  </Button>
                </div>
                <FieldDescription>После этой даты тариф работает как «Старт», пока его не продлят.</FieldDescription>
              </Field>
            )}

            {tier === 'pro' && (
              <Field orientation="horizontal">
                <Switch id="sub-trial" checked={trial} onCheckedChange={setTrial} />
                <FieldLabel htmlFor="sub-trial" className="font-normal">
                  Пробный период
                </FieldLabel>
              </Field>
            )}

            {tier === 'custom' && (
              <Field>
                <FieldLabel>Лимиты по договору</FieldLabel>
                <div className="grid grid-cols-3 gap-2">
                  <LimitInput id="lim-plans" label="Схем" value={plans} onChange={setPlans} placeholder="∞" />
                  <LimitInput id="lim-vehicles" label="Машин в схеме" value={vehicles} onChange={setVehicles} placeholder="10" />
                  <LimitInput id="lim-items" label="Грузов в схеме" value={items} onChange={setItems} placeholder="5000" />
                </div>
                <FieldDescription>Пусто — без ограничений (машин и грузов — максимум редактора).</FieldDescription>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="sub-note">Заметка</FieldLabel>
              <Textarea
                id="sub-note"
                rows={2}
                maxLength={500}
                placeholder="Договор, счёт, контактное лицо"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {save.isError && <p className="text-sm text-destructive">{errorMessage(save.error)}</p>}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              Сохранить
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function LimitInput(props: { id: string; label: string; value: string; placeholder: string; onChange(v: string): void }) {
  return (
    <div className="space-y-1">
      <label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label}
      </label>
      <Input
        id={props.id}
        inputMode="numeric"
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value.replace(/\D/g, ''))}
      />
    </div>
  );
}

function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function PasswordField({ value, onChange, error }: { value: string; onChange(v: string): void; error?: string }) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor="admin-password">Пароль</FieldLabel>
      <InputGroup>
        <InputGroupInput id="admin-password" autoComplete="new-password" value={value} onChange={(e) => onChange(e.target.value)} />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="xs" onClick={() => onChange(randomPassword())}>
            Сгенерировать
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {error ? <FieldError>{error}</FieldError> : <FieldDescription>Не короче 8 символов. Передайте его пользователю.</FieldDescription>}
    </Field>
  );
}

function PasswordDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange(open: boolean): void }) {
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (open) setPassword(randomPassword());
  }, [open]);
  const reset = useMutation({
    mutationFn: () => adminApi.resetPassword(user.id, password),
    onSuccess: () => {
      toast.success('Пароль изменён, пользователь вышел на всех устройствах');
      onOpenChange(false);
    },
  });
  const fieldError = reset.error instanceof ApiError ? reset.error.fieldErrors.newPassword : undefined;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Новый пароль</DialogTitle>
            <DialogDescription>{user.email} выйдет на всех устройствах и войдёт с новым паролем.</DialogDescription>
          </DialogHeader>
          <PasswordField value={password} onChange={setPassword} error={fieldError} />
          {reset.isError && !fieldError && <p className="text-sm text-destructive">{errorMessage(reset.error)}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={password.length < 8 || reset.isPending}>
              {reset.isPending && <Spinner />}
              Сменить пароль
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteUserDialog({ user, open, onOpenChange }: { user: AdminUser; open: boolean; onOpenChange(open: boolean): void }) {
  const invalidate = useInvalidateAdmin();
  const remove = useMutation({
    mutationFn: () => adminApi.deleteUser(user.id),
    onSuccess: () => {
      void invalidate();
      toast.success(`Аккаунт ${user.email} удалён`);
      onOpenChange(false);
    },
  });
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить аккаунт {user.email}?</AlertDialogTitle>
          <AlertDialogDescription>
            Вместе с ним удалятся {plural(user.planCount, ['схема', 'схемы', 'схем'])}. Восстановить их будет нельзя.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {remove.isError && <p className="text-sm text-destructive">{errorMessage(remove.error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            {remove.isPending && <Spinner />}
            Удалить навсегда
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const invalidate = useInvalidateAdmin();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [tier, setTier] = useState<TierId>('free');
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setName('');
    setPassword(randomPassword());
    setTier('free');
    setAdmin(false);
  }, [open]);

  const create = useMutation({
    mutationFn: () =>
      adminApi.createUser({ email, password, displayName: name.trim() || undefined, isAdmin: admin, tier, expiresAt: null }),
    onSuccess: (user) => {
      void invalidate();
      toast.success(`Аккаунт ${user.email} создан`);
      onOpenChange(false);
    },
  });
  const fieldErrors = create.error instanceof ApiError ? create.error.fieldErrors : {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
            <DialogDescription>Работает и при закрытой регистрации. Пароль передайте пользователю сами.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <Field data-invalid={!!fieldErrors.email}>
              <FieldLabel htmlFor="new-email">Email</FieldLabel>
              <Input id="new-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="new-name">Имя</FieldLabel>
              <Input id="new-name" maxLength={100} placeholder="По умолчанию — из email" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <PasswordField value={password} onChange={setPassword} error={fieldErrors.password} />
            <Field hidden={!TIERS_ENABLED}>
              <FieldLabel>Тариф</FieldLabel>
              <Select value={tier} onValueChange={(v) => setTier(v as TierId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIERS.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>Срок и лимиты можно задать потом в «Тариф и срок».</FieldDescription>
            </Field>
            <Field orientation="horizontal">
              <Switch id="new-admin" checked={admin} onCheckedChange={setAdmin} />
              <FieldLabel htmlFor="new-admin" className="font-normal">
                Администратор
              </FieldLabel>
            </Field>
            {create.isError && Object.keys(fieldErrors).length === 0 && (
              <p className="text-sm text-destructive">{errorMessage(create.error)}</p>
            )}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={!email.trim() || password.length < 8 || create.isPending}>
              {create.isPending ? <Spinner /> : <Plus />}
              Создать
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------ leads

function LeadsTab() {
  const [status, setStatus] = useState<LeadStatus | typeof ALL>('new');
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [status]);
  const query = { status: status === ALL ? undefined : status, limit: PAGE, offset };
  const leads = useQuery({
    queryKey: ['admin', 'leads', query],
    queryFn: ({ signal }) => adminApi.leads(query, signal),
    placeholderData: keepPreviousData,
  });
  const total = leads.data?.total ?? 0;

  return (
    <>
      <Select value={status} onValueChange={(v) => setStatus(v as LeadStatus | typeof ALL)}>
        <SelectTrigger className="h-9 w-52" aria-label="Статус заявок">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="new">Новые</SelectItem>
          <SelectItem value="done">Обработанные</SelectItem>
          <SelectItem value={ALL}>Все заявки</SelectItem>
        </SelectContent>
      </Select>

      <div className={cn('mt-4 grid gap-3', leads.isPlaceholderData && 'opacity-60')}>
        {leads.isPending ? (
          Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : leads.isError ? (
          <p className="text-sm text-destructive">{errorMessage(leads.error)}</p>
        ) : leads.data.items.length === 0 ? (
          <Card>
            <Empty className="py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox />
                </EmptyMedia>
                <EmptyTitle>{status === 'new' ? 'Новых заявок нет' : 'Заявок нет'}</EmptyTitle>
                <EmptyDescription>
                  {TIERS_ENABLED ? 'Заявки приходят с главной страницы и из окна смены тарифа.' : 'Заявки приходят с главной страницы.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </Card>
        ) : (
          leads.data.items.map((lead) => <LeadCard key={lead.id} lead={lead} />)
        )}
      </div>
      {total > PAGE && (
        <div className="mt-3 flex items-center justify-end gap-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {offset + 1}–{Math.min(offset + PAGE, total)} из {total}
          </span>
          <Button variant="ghost" size="icon-sm" aria-label="Назад" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Дальше" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  const invalidate = useInvalidateAdmin();
  const update = useMutation({
    mutationFn: (status: LeadStatus) => adminApi.updateLead(lead.id, status),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteLead(lead.id),
    onSuccess: () => void invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const done = lead.status === 'done';

  return (
    <Card className={cn('gap-3 p-4', done && 'bg-muted/30')}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{lead.name}</span>
            {lead.tier && TIERS_ENABLED && <TierBadge tier={lead.tier} />}
            {lead.userId && <Badge variant="outline">есть аккаунт</Badge>}
            {done && <Badge variant="secondary">обработана</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {lead.company && (
              <span className="flex items-center gap-1.5">
                <Building2 className="size-3.5" /> {lead.company}
              </span>
            )}
            {lead.email && (
              <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-primary hover:underline">
                <Mail className="size-3.5" /> {lead.email}
              </a>
            )}
            {lead.phone && (
              <a href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`} className="flex items-center gap-1.5 text-primary hover:underline">
                <Phone className="size-3.5" /> {lead.phone}
              </a>
            )}
          </div>
        </div>
        <span className="text-xs text-muted-foreground" title={fullDate(lead.createdAt)}>
          {timeAgo(lead.createdAt)}
        </span>
      </div>
      {lead.message && <p className="text-sm whitespace-pre-line">{lead.message}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant={done ? 'outline' : 'default'} disabled={update.isPending} onClick={() => update.mutate(done ? 'new' : 'done')}>
          {update.isPending && <Spinner />}
          {done ? 'Вернуть в новые' : 'Обработана'}
        </Button>
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={remove.isPending} onClick={() => remove.mutate()}>
          <Trash2 /> Удалить
        </Button>
      </div>
    </Card>
  );
}
