import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Box, Check, Eye, EyeOff, Layers, OctagonAlert, Ruler } from 'lucide-react';
import { ApiError, errorMessage } from '@/api/client';
import { CargoIllustration } from '@/components/CargoIllustration';
import { Logo } from '@/components/Logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';
import { Spinner } from '@/components/ui/spinner';
import { TIERS_ENABLED, TRIAL_DAYS, tierInfo } from '@/lib/tiers';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/useAuth';

type ChosenTier = 'free' | 'pro';

type Mode = 'login' | 'register';

const COPY: Record<Mode, { title: string; subtitle: string; submit: string }> = {
  login: { title: 'Вход в Loader3D', subtitle: 'Рады видеть снова — ваши схемы ждут.', submit: 'Войти' },
  register: {
    title: 'Создать аккаунт',
    subtitle: 'Схемы загрузки сохраняются в аккаунте и открываются с любого устройства.',
    submit: 'Зарегистрироваться',
  },
};

export function AuthPage({ mode }: { mode: Mode }) {
  const login = useAuth((s) => s.login);
  const register = useAuth((s) => s.register);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [params] = useSearchParams();
  const [tier, setTier] = useState<ChosenTier>(TIERS_ENABLED && params.get('tier') === 'pro' ? 'pro' : 'free');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const copy = COPY[mode];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, displayName.trim(), tier);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length > 0) setFieldErrors(err.fieldErrors);
      else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <form onSubmit={submit} className="w-full max-w-sm" noValidate>
            <div className="mb-7 space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
              <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
            </div>

            {error && (
              <Alert variant="destructive" className="mb-5">
                <OctagonAlert />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FieldGroup className="gap-4">
              {mode === 'register' && TIERS_ENABLED && <TierChoice value={tier} onChange={setTier} />}
              {mode === 'register' && (
                <Field data-invalid={!!fieldErrors.displayName}>
                  <FieldLabel htmlFor="displayName">Имя</FieldLabel>
                  <Input
                    id="displayName"
                    className="h-9"
                    autoComplete="name"
                    placeholder="Как к вам обращаться"
                    value={displayName}
                    maxLength={100}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  {fieldErrors.displayName && <FieldError>{fieldErrors.displayName}</FieldError>}
                </Field>
              )}

              <Field data-invalid={!!fieldErrors.email}>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  className="h-9"
                  autoComplete="email"
                  placeholder="name@company.ru"
                  required
                  autoFocus
                  value={email}
                  aria-invalid={!!fieldErrors.email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {fieldErrors.email && <FieldError>{fieldErrors.email}</FieldError>}
              </Field>

              <Field data-invalid={!!fieldErrors.password}>
                <FieldLabel htmlFor="password">Пароль</FieldLabel>
                <InputGroup className="h-9">
                  <InputGroupInput
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    value={password}
                    aria-invalid={!!fieldErrors.password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton
                      size="icon-xs"
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      {showPassword ? <EyeOff /> : <Eye />}
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                {fieldErrors.password ? (
                  <FieldError>{fieldErrors.password}</FieldError>
                ) : (
                  mode === 'register' && <FieldDescription>Не короче 8 символов</FieldDescription>
                )}
              </Field>

              <Button type="submit" size="lg" className="mt-2 w-full" disabled={pending}>
                {pending && <Spinner />}
                {copy.submit}
              </Button>
            </FieldGroup>

            {mode === 'register' && TIERS_ENABLED && (
              <p className="mt-4 text-center text-xs text-muted-foreground">
                Компаниям с особыми задачами — тариф «Индивидуальный» по договору.{' '}
                <Link to="/#contact" className="font-medium text-primary hover:underline">
                  Оставить заявку
                </Link>
              </p>
            )}

            <p className="mt-6 text-center text-sm text-muted-foreground">
              {mode === 'login' ? (
                <>
                  Нет аккаунта?{' '}
                  <Link to="/register" state={location.state} className="font-medium text-primary hover:underline">
                    Зарегистрироваться
                  </Link>
                </>
              ) : (
                <>
                  Уже есть аккаунт?{' '}
                  <Link to="/login" state={location.state} className="font-medium text-primary hover:underline">
                    Войти
                  </Link>
                </>
              )}
            </p>
          </form>
        </div>
      </div>

      <BrandPanel />
    </div>
  );
}

/** Free or the trial of «Профи»: the paid tier itself is activated by the team later. */
function TierChoice({ value, onChange }: { value: ChosenTier; onChange(tier: ChosenTier): void }) {
  const options: Array<{ id: ChosenTier; title: string; note: string }> = [
    { id: 'free', title: tierInfo('free').name, note: 'Бесплатно, 3 схемы' },
    { id: 'pro', title: tierInfo('pro').name, note: `${TRIAL_DAYS} дней бесплатно` },
  ];
  return (
    <div role="radiogroup" aria-label="Тариф" className="grid grid-cols-2 gap-2">
      {options.map((o) => {
        const active = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.id)}
            className={cn(
              'relative rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-muted/60',
            )}
          >
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="block text-xs text-muted-foreground">{o.note}</span>
            {active && <Check className="absolute top-3 right-3 size-4 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}

const FEATURES = [
  { icon: Box, text: 'Раскладка грузов мышью и пальцем — с гравитацией и магнитами' },
  { icon: Ruler, text: 'Размерные линии, LDM и заполнение кузова в реальном времени' },
  { icon: Layers, text: 'Фуры, сцепки и контейнеры — шаблоны или свои размеры' },
];

function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-gradient-to-br from-[#2f6fed] via-[#2a5fd6] to-[#1d3f9e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)',
          backgroundSize: '44px 44px',
          maskImage: 'radial-gradient(ellipse at 60% 40%, black 30%, transparent 75%)',
        }}
      />
      <div className="relative max-w-md">
        <p className="text-sm font-medium tracking-wide text-white/70 uppercase">Планирование загрузки</p>
        <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight text-balance">
          Соберите фуру в 3D до того, как приедет машина
        </h2>
      </div>
      <CargoIllustration className="relative mx-auto my-6 w-full max-w-md drop-shadow-2xl" />
      <ul className="relative max-w-md space-y-3">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-start gap-3 text-sm text-white/85">
            <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-white/15 ring-1 ring-white/20">
              <Icon className="size-4" />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </div>
  );
}
