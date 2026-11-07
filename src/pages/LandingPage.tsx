import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router';
import {
  ArrowRight,
  Boxes,
  Check,
  Container,
  Factory,
  FileText,
  Gauge,
  Layers,
  Magnet,
  Plus,
  Rotate3d,
  Route,
  ScanEye,
  ShieldCheck,
  TabletSmartphone,
  Truck,
  WandSparkles,
  Warehouse,
} from 'lucide-react';
import { LeadForm } from '@/components/LeadForm';
import { Logo } from '@/components/Logo';
import { SessionLoader } from '@/components/RouteGuards';
import { Button } from '@/components/ui/button';
import { TIERS, TIERS_ENABLED, TRIAL_DAYS, formatPrice, type TierInfo } from '@/lib/tiers';
import { cn } from '@/lib/utils';
import { useAuth, wasSignedIn } from '@/store/useAuth';

/**
 * The public product page at `/` (prerendered into index.html by scripts/prerender.mjs for search
 * engines, so it renders without a browser too: no window access while rendering). A logged-in user
 * goes on to their plans; `/pricing` shows the same page at the tariffs, without the redirect.
 * With TIERS_ENABLED off the page says nothing about tariffs.
 */
export function LandingRoute({ section }: { section?: 'pricing' }) {
  const status = useAuth((s) => s.status);
  if (!section) {
    if (status === 'authenticated') return <Navigate to="/plans" replace />;
    if (status === 'loading' && wasSignedIn()) return <SessionLoader />;
  }
  return <LandingPage section={section} />;
}

/** Shown in the FAQ section and as FAQPage structured data in index.html (the same list). */
/** `tiers`: shown only with tariffs on (true) or only with them off (false). */
const ALL_FAQ: Array<{ q: string; a: string; tiers?: boolean }> = [
  {
    q: 'Нужно ли что-то устанавливать?',
    a: 'Нет. Loader3D работает в браузере на компьютере и на планшете. Схемы хранятся в аккаунте и открываются с любого устройства.',
  },
  {
    q: 'Какой транспорт есть в планировщике?',
    a: 'Готовые шаблоны: еврофура 13,6 м, мега, рефрижератор, сцепка 7,7 + 8,2 м, контейнеры 20′ и 40′, грузовики. Любой кузов можно задать своими размерами и грузоподъёмностью, добавить прицеп.',
  },
  {
    q: 'Сколько паллет поместится в фуру?',
    a: 'В еврофуру 13,6 м в один ярус встают 33 европаллеты 120 × 80. Но реальный груз почти всегда разный: добавьте свои места с размерами и весом — Loader3D покажет, что поместится, сколько останется и где окажется центр тяжести.',
  },
  {
    q: 'Учитывается ли вес и перегруз?',
    a: 'Да. У каждого груза есть вес, у кузова — грузоподъёмность. Статистика показывает массу, LDM, заполнение и центр тяжести, а автозагрузка не превышает грузоподъёмность и ставит лёгкое на тяжёлое только с полной опорой.',
  },
  {
    q: 'Что будет после пробного периода «Профи»?',
    a: `Через ${TRIAL_DAYS} дней аккаунт перейдёт на бесплатный тариф «Старт», все схемы сохранятся. Подключить «Профи» можно в любой момент — без автоматических списаний.`,
    tiers: true,
  },
  {
    q: 'Чем отличается тариф «Индивидуальный»?',
    a: 'Это условия по договору для компаний: лимиты, срок и стоимость под ваши объёмы, оплата по счёту, помощь с внедрением. Оставьте заявку — обсудим задачу.',
    tiers: true,
  },
  {
    q: 'Можно ли помочь с внедрением?',
    a: 'Да. Напишите через форму на этой странице: поможем завести ваш транспорт и типовые грузы и покажем команде, как работать с планировщиком.',
    tiers: false,
  },
];

export const FAQ = ALL_FAQ.filter((f) => f.tiers === undefined || f.tiers === TIERS_ENABLED).map(({ q, a }) => ({ q, a }));

const AUDIENCE = [
  { icon: Route, label: 'Экспедиторам' },
  { icon: Warehouse, label: 'Складам и 3PL' },
  { icon: Truck, label: 'Перевозчикам' },
  { icon: Factory, label: 'Производителям' },
  { icon: Container, label: 'Отделам ВЭД' },
];

const BENEFITS = [
  {
    title: 'Меньше рейсов',
    text: 'Сразу видно, сколько на самом деле помещается в кузов. Машина не уезжает полупустой, а груз не остаётся на складе.',
  },
  {
    title: 'Без перегруза',
    text: 'Вес, грузоподъёмность и центр тяжести под контролем ещё до погрузки — а не на весах и не в дороге.',
  },
  {
    title: 'Понятно складу и водителю',
    text: 'PDF со схемой, списком мест и порядком погрузки вместо устных указаний и рисунков от руки.',
  },
];

const FEATURES: Array<{ icon: typeof Boxes; title: string; text: string; wide?: boolean }> = [
  {
    icon: Magnet,
    title: 'Раскладка руками, как в жизни',
    text: 'Тяните груз мышью или пальцем: он встаёт на пол или на другой груз, не висит и не проходит сквозь соседей, прилипает к стенкам и граням. Стопка едет целиком, под «мостик» из грузов можно подсунуть то, что туда влезает.',
    wide: true,
  },
  {
    icon: WandSparkles,
    title: 'Автозагрузка',
    text: 'Тяжёлое — на пол и ближе к середине, лёгкое — сверху. С предпросмотром и одной кнопкой отмены.',
  },
  {
    icon: Gauge,
    title: 'LDM, вес и центр тяжести',
    text: 'Погрузочные метры, заполнение по объёму, масса и ЦТ — пересчитываются на лету.',
  },
  {
    icon: Layers,
    title: 'Несколько машин и сцепки',
    text: 'До 10 машин в одной схеме: перекладывайте груз между ними, общий или отдельный док.',
  },
  {
    icon: FileText,
    title: 'PDF для водителя и склада',
    text: 'Виды сверху и сбоку с номерами мест, итог по кузову и пошаговая инструкция погрузки.',
    wide: true,
  },
  {
    icon: ScanEye,
    title: 'Рентген груза',
    text: 'Грузы, которые закрывают обзор, становятся прозрачными — видно всё, что внутри.',
  },
  {
    icon: Rotate3d,
    title: 'Кантование',
    text: 'Шесть положений груза: на бок, на торец, поворот по вертикали. Физика честно учитывает новую высоту.',
    wide: true,
  },
  {
    icon: TabletSmartphone,
    title: 'На планшете у рампы',
    text: 'Интерфейс для пальцев: проверяйте и правьте схему прямо на складе, изменения сохраняются сами.',
    wide: true,
  },
];

const STEPS = [
  {
    title: 'Выберите транспорт',
    text: 'Еврофура, мега, реф, сцепка, контейнер — или свои размеры кузова и грузоподъёмность.',
  },
  {
    title: 'Добавьте грузы',
    text: 'Типовые паллеты и IBC в один клик или свои места: размеры, вес, количество.',
  },
  {
    title: 'Разложите и отправьте',
    text: 'Вручную или автозагрузкой. Схема сохраняется сама, PDF — в один клик.',
  },
];

const FACTS = [
  { value: '6', label: 'положений груза' },
  { value: 'до 10', label: 'машин в схеме' },
  { value: '5000', label: 'грузов в схеме' },
  { value: '1 клик', label: 'до PDF-схемы' },
];

export function LandingPage({ section }: { section?: 'pricing' }) {
  const { hash } = useLocation();
  useEffect(() => {
    const id = section ?? hash.slice(1);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, [hash, section]);

  return (
    <div className="min-h-dvh bg-white text-[#0b1220]">
      <LandingHeader />
      <main>
        <Hero />
        <Audience />
        <Benefits />
        <Features />
        <Steps />
        {TIERS_ENABLED && <Pricing />}
        <Faq />
        <Contact />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}

// ------------------------------------------------------------------ building blocks

function Container_({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', className)}>{children}</div>;
}

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('text-[13px] font-semibold tracking-[0.14em] text-primary uppercase', className)}>{children}</p>
  );
}

function SectionTitle({ eyebrow, title, text, center }: { eyebrow: string; title: ReactNode; text?: ReactNode; center?: boolean }) {
  return (
    <div className={cn('max-w-2xl', center && 'mx-auto text-center')}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.6rem]">{title}</h2>
      {text && <p className="mt-4 text-lg leading-relaxed text-pretty text-[#4a5568]">{text}</p>}
    </div>
  );
}

const NAV = [
  { href: '#features', label: 'Возможности' },
  { href: '#how', label: 'Как это работает' },
  ...(TIERS_ENABLED ? [{ href: '#pricing', label: 'Тарифы' }] : []),
  { href: '#faq', label: 'Вопросы' },
];

function LandingHeader() {
  const user = useAuth((s) => s.user);
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.06] bg-white/75 backdrop-blur-xl">
      <Container_ className="flex h-16 items-center gap-6">
        <Logo />
        <nav aria-label="Разделы" className="hidden flex-1 items-center justify-center gap-7 text-sm text-[#4a5568] md:flex">
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className="transition-colors hover:text-[#0b1220]">
              {n.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 md:ml-0">
          {user ? (
            <Button asChild className="rounded-full px-4">
              <Link to="/plans">
                Мои схемы <ArrowRight />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="rounded-full">
                <Link to="/login">Войти</Link>
              </Button>
              <Button asChild className="rounded-full px-4">
                <Link to="/register">Начать бесплатно</Link>
              </Button>
            </>
          )}
        </div>
      </Container_>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Blueprint grid fading out from the top. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(47,111,237,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(47,111,237,0.07) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 80%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(47,111,237,0.18),transparent)] blur-2xl"
      />
      <Container_ className="relative pt-16 pb-10 text-center sm:pt-24">
        <div className="landing-rise mx-auto inline-flex items-center gap-2 rounded-full border border-primary/15 bg-white/80 px-3.5 py-1.5 text-[13px] font-medium text-[#334155] shadow-sm">
          <span className="size-1.5 rounded-full bg-primary" />
          3D-планировщик загрузки фуры и контейнера
        </div>
        <h1 className="landing-rise mx-auto mt-6 max-w-5xl text-[2.6rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance [animation-delay:60ms] sm:text-6xl lg:text-[4.1rem]">
          Загрузите фуру в 3D <span className="text-primary lg:block">до того, как приедет машина</span>
        </h1>
        <p className="landing-rise mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-[#4a5568] [animation-delay:120ms] sm:text-xl">
          Раскладывайте паллеты и коробки по кузову с физикой и магнитами, следите за LDM, весом и центром тяжести и
          отдавайте водителю PDF-схему погрузки. В браузере, без установки.
        </p>
        <div className="landing-rise mt-9 flex flex-col items-center justify-center gap-3 [animation-delay:180ms] sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full px-7 text-base shadow-lg shadow-primary/25">
            <Link to="/register">
              Начать бесплатно <ArrowRight />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-12 rounded-full bg-white px-7 text-base">
            {TIERS_ENABLED ? <a href="#pricing">Тарифы</a> : <a href="#features">Возможности</a>}
          </Button>
        </div>
        <p className="landing-rise mt-4 text-sm text-[#64748b] [animation-delay:220ms]">
          {TIERS_ENABLED
            ? `Бесплатный тариф навсегда · «Профи» ${TRIAL_DAYS} дней без оплаты · Без карты`
            : 'Без установки · В браузере и на планшете · Схемы сохраняются в аккаунте'}
        </p>

        <ProductShot />
      </Container_>
    </section>
  );
}

function ProductShot() {
  return (
    <div className="landing-rise relative mx-auto mt-14 max-w-5xl [animation-delay:280ms] sm:mt-16">
      <div className="rounded-[22px] border border-black/[0.08] bg-white/70 p-1.5 shadow-[0_30px_80px_-20px_rgba(15,35,80,0.35)] backdrop-blur sm:p-2">
        <div className="overflow-hidden rounded-[16px] border border-black/[0.06] bg-[#e7ebf0]">
          <div className="flex items-center gap-1.5 border-b border-black/[0.06] bg-white/80 px-4 py-2.5">
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-3 truncate text-xs text-[#64748b]">Рейс Москва → Казань · Loader3D</span>
          </div>
          <img
            src="/landing/hero.webp"
            width={1600}
            height={1000}
            alt="Схема загрузки еврофуры в Loader3D: паллеты, IBC-кубы и коробки в кузове, док с грузами у задних дверей"
            className="block h-auto w-full"
            fetchPriority="high"
          />
        </div>
      </div>
      <FloatingStat className="top-[22%] -left-3 hidden sm:flex lg:-left-10" label="Погрузочные метры" value="LDM 12,8 м" />
      <FloatingStat className="top-[52%] -right-3 hidden sm:flex lg:-right-10" label="Центр тяжести" value="В норме" ok />
      <FloatingStat className="bottom-[10%] left-[8%] hidden md:flex" label="Вес груза" value="13,1 т из 20 т" />
    </div>
  );
}

function FloatingStat({ label, value, ok, className }: { label: string; value: string; ok?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'absolute items-center gap-3 rounded-2xl border border-black/[0.06] bg-white/90 px-4 py-3 text-left shadow-[0_12px_32px_-8px_rgba(15,35,80,0.25)] backdrop-blur-md',
        className,
      )}
    >
      <span className={cn('grid size-8 place-items-center rounded-full', ok ? 'bg-emerald-500/12 text-emerald-600' : 'bg-primary/10 text-primary')}>
        {ok ? <ShieldCheck className="size-4" /> : <Gauge className="size-4" />}
      </span>
      <span>
        <span className="block text-[11px] font-medium tracking-wide text-[#64748b] uppercase">{label}</span>
        <span className="block text-sm font-semibold tabular-nums">{value}</span>
      </span>
    </div>
  );
}

function Audience() {
  return (
    <section aria-label="Для кого" className="border-y border-black/[0.06] bg-[#fafbfd]">
      <Container_ className="py-8 text-center">
        <p className="text-xs font-semibold tracking-[0.14em] text-[#94a3b8] uppercase">Для тех, кто грузит каждый день</p>
        <ul className="mt-4 flex flex-wrap items-center justify-center gap-x-9 gap-y-3 text-[15px] font-medium text-[#475569]">
          {AUDIENCE.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon className="size-4 text-primary" /> {label}
            </li>
          ))}
        </ul>
      </Container_>
    </section>
  );
}

function Benefits() {
  return (
    <section className="py-24 sm:py-28">
      <Container_>
        <SectionTitle
          eyebrow="Зачем"
          title="Схема загрузки — до рампы, а не на ней"
          text="Когда раскладку видно заранее, склад собирает груз в нужном порядке, а логист отправляет ровно столько машин, сколько нужно."
        />
        <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-black/[0.07] bg-black/[0.07] md:grid-cols-3">
          {BENEFITS.map((b, i) => (
            <div key={b.title} className="bg-white p-8">
              <span className="text-sm font-semibold text-primary tabular-nums">0{i + 1}</span>
              <h3 className="mt-4 text-xl font-semibold tracking-tight">{b.title}</h3>
              <p className="mt-3 leading-relaxed text-[#4a5568]">{b.text}</p>
            </div>
          ))}
        </div>
      </Container_>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-16 bg-[#0b1220] py-24 text-white sm:py-28">
      <Container_>
        <div className="max-w-2xl">
          <Eyebrow className="text-[#7aa7ff]">Возможности</Eyebrow>
          <h2 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-[2.6rem]">
            Всё, что нужно для схемы загрузки, — в одном окне
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-pretty text-white/60">
            Не чертёж и не таблица: настоящая 3D-сцена, в которой груз ведёт себя как груз.
          </p>
        </div>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, text, wide }) => (
            <article
              key={title}
              className={cn(
                'group rounded-3xl border border-white/[0.08] bg-white/[0.03] p-7 transition-colors hover:bg-white/[0.06]',
                wide && 'lg:col-span-2',
              )}
            >
              <span className="grid size-11 place-items-center rounded-2xl bg-primary/15 text-[#7aa7ff] ring-1 ring-primary/25">
                <Icon className="size-5" />
              </span>
              <h3 className="mt-6 text-lg font-semibold tracking-tight">{title}</h3>
              <p className="mt-2 leading-relaxed text-white/60">{text}</p>
            </article>
          ))}
        </div>
        <dl className="mt-16 grid grid-cols-2 gap-8 border-t border-white/[0.08] pt-12 sm:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.label}>
              <dt className="sr-only">{f.label}</dt>
              <dd className="text-4xl font-semibold tracking-[-0.03em] tabular-nums">{f.value}</dd>
              <dd className="mt-1 text-sm text-white/50">{f.label}</dd>
            </div>
          ))}
        </dl>
      </Container_>
    </section>
  );
}

function Steps() {
  return (
    <section id="how" className="scroll-mt-16 py-24 sm:py-28">
      <Container_>
        <SectionTitle eyebrow="Как это работает" title="Три шага от заявки до схемы погрузки" center />
        <ol className="mt-14 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative rounded-3xl border border-black/[0.07] bg-gradient-to-b from-[#f7f9fc] to-white p-8">
              <span className="grid size-10 place-items-center rounded-full bg-[#0b1220] text-sm font-semibold text-white tabular-nums">
                {i + 1}
              </span>
              <h3 className="mt-6 text-xl font-semibold tracking-tight">{s.title}</h3>
              <p className="mt-3 leading-relaxed text-[#4a5568]">{s.text}</p>
            </li>
          ))}
        </ol>
      </Container_>
    </section>
  );
}

function Pricing() {
  const [yearly, setYearly] = useState(false);
  return (
    <section id="pricing" className="scroll-mt-16 border-t border-black/[0.06] bg-[#fafbfd] py-24 sm:py-28">
      <Container_>
        <SectionTitle
          eyebrow="Тарифы"
          title="Начните бесплатно. Платите, когда планировщик начнёт экономить рейсы"
          text={`Без автоматических списаний: «Профи» можно попробовать ${TRIAL_DAYS} дней, а подключить — по счёту.`}
          center
        />
        <div className="mt-10 flex justify-center">
          <div role="radiogroup" aria-label="Период оплаты" className="inline-flex rounded-full border border-black/[0.08] bg-white p-1 text-sm shadow-sm">
            {[
              { value: false, label: 'Помесячно' },
              { value: true, label: 'За год −20%' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={yearly === o.value}
                onClick={() => setYearly(o.value)}
                className={cn(
                  'rounded-full px-4 py-1.5 font-medium transition-colors',
                  yearly === o.value ? 'bg-[#0b1220] text-white' : 'text-[#475569] hover:text-[#0b1220]',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto mt-10 grid max-w-5xl gap-5 lg:grid-cols-3">
          {TIERS.map((t) => (
            <PriceCard key={t.id} tier={t} yearly={yearly} />
          ))}
        </div>
      </Container_>
    </section>
  );
}

function PriceCard({ tier, yearly }: { tier: TierInfo; yearly: boolean }) {
  const href = tier.id === 'free' ? '/register' : tier.id === 'pro' ? '/register?tier=pro' : '#contact';
  const price = tier.price && (yearly ? tier.price.yearly : tier.price.monthly);
  return (
    <article
      className={cn(
        'relative flex flex-col rounded-3xl border bg-white p-8',
        tier.highlighted
          ? 'border-primary shadow-[0_24px_60px_-24px_rgba(47,111,237,0.55)] ring-1 ring-primary'
          : 'border-black/[0.08]',
      )}
    >
      {tier.highlighted && (
        <span className="absolute -top-3 left-8 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white">
          Выбор логистов
        </span>
      )}
      <h3 className="text-lg font-semibold">{tier.name}</h3>
      <p className="mt-1 min-h-10 text-sm text-[#64748b]">{tier.tagline}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        {price === null ? (
          <span className="text-4xl font-semibold tracking-[-0.03em]">По договору</span>
        ) : price === 0 ? (
          <>
            <span className="text-4xl font-semibold tracking-[-0.03em]">0 ₽</span>
            <span className="text-sm text-[#64748b]">навсегда</span>
          </>
        ) : (
          <>
            <span className="text-4xl font-semibold tracking-[-0.03em] tabular-nums">{formatPrice(price)}</span>
            <span className="text-sm text-[#64748b]">/ мес</span>
          </>
        )}
      </div>
      <p className="mt-1 min-h-5 text-xs text-[#64748b]">
        {tier.price && tier.price.monthly > 0 && (yearly ? `${formatPrice(tier.price.yearly * 12)} за год` : 'при оплате помесячно')}
        {tier.price === null && 'лимиты, срок и цена — под ваши объёмы'}
      </p>
      <Button
        asChild
        size="lg"
        variant={tier.highlighted ? 'default' : 'outline'}
        className={cn('mt-6 h-11 rounded-full', !tier.highlighted && 'bg-white')}
      >
        {href.startsWith('#') ? <a href={href}>{tier.cta}</a> : <Link to={href}>{tier.cta}</Link>}
      </Button>
      <ul className="mt-8 space-y-3 text-sm">
        {tier.features.map((f) => (
          <li key={f} className="flex items-start gap-2.5">
            <Check className={cn('mt-0.5 size-4 shrink-0', tier.highlighted ? 'text-primary' : 'text-[#94a3b8]')} />
            <span className="text-[#334155]">{f}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Faq() {
  return (
    <section id="faq" className="scroll-mt-16 py-24 sm:py-28">
      <Container_ className="grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <SectionTitle
          eyebrow="Вопросы"
          title="Частые вопросы"
          text="Не нашли ответ — напишите нам через форму ниже, ответим в течение рабочего дня."
        />
        <div className="divide-y divide-black/[0.07] border-y border-black/[0.07]">
          {FAQ.map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
                {item.q}
                <Plus className="size-5 shrink-0 text-[#94a3b8] transition-transform group-open:rotate-45" />
              </summary>
              <p className="mt-3 pr-10 leading-relaxed text-[#4a5568]">{item.a}</p>
            </details>
          ))}
        </div>
      </Container_>
    </section>
  );
}

const CONTACT = TIERS_ENABLED
  ? {
      eyebrow: 'Индивидуальный тариф',
      title: 'Особые объёмы и условия — обсудим лично',
      text: 'Для компаний, которым нужны свои лимиты, договор и оплата по счёту, а также помощь с внедрением: настроим транспорт и типовые грузы, обучим команду.',
      points: ['Условия и срок — по договору', 'Закрывающие документы', 'Персональный контакт для вопросов'],
      submit: 'Обсудить условия',
    }
  : {
      eyebrow: 'Связаться с нами',
      title: 'Особая задача или большие объёмы — обсудим',
      text: 'Расскажите, что и как вы грузите: поможем с внедрением, заведём ваш транспорт и типовые грузы, покажем команде, как работать с планировщиком.',
      points: ['Помощь с внедрением', 'Настройка под ваш транспорт и грузы', 'Ответ в течение рабочего дня'],
      submit: 'Отправить',
    };

function Contact() {
  return (
    <section id="contact" className="scroll-mt-16 pb-24 sm:pb-28">
      <Container_>
        <div className="grid gap-10 overflow-hidden rounded-[32px] border border-black/[0.07] bg-gradient-to-br from-[#f3f6fc] via-white to-[#eef3ff] p-8 sm:p-12 lg:grid-cols-2">
          <div>
            <Eyebrow>{CONTACT.eyebrow}</Eyebrow>
            <h2 className="mt-3 text-3xl leading-[1.1] font-semibold tracking-[-0.025em] text-balance sm:text-4xl">
              {CONTACT.title}
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-pretty text-[#4a5568]">{CONTACT.text}</p>
            <ul className="mt-8 space-y-3 text-[#334155]">
              {CONTACT.points.map((x) => (
                <li key={x} className="flex items-center gap-2.5">
                  <Check className="size-4 text-primary" /> {x}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-black/[0.06] bg-white p-6 shadow-[0_20px_50px_-24px_rgba(15,35,80,0.3)] sm:p-8">
            <LeadForm tier={TIERS_ENABLED ? 'custom' : undefined} submitLabel={CONTACT.submit} />
          </div>
        </div>
      </Container_>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#0b1220] py-24 text-center text-white">
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 left-1/2 h-[480px] w-[880px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(47,111,237,0.45),transparent)] blur-2xl"
      />
      <Container_ className="relative">
        <h2 className="mx-auto max-w-3xl text-3xl leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-5xl">
          Следующую машину — загрузите в Loader3D
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg text-white/60">
          {TIERS_ENABLED
            ? 'Регистрация за минуту. Бесплатный тариф — без ограничения по сроку.'
            : 'Регистрация за минуту — и можно загружать первую машину.'}
        </p>
        <Button asChild size="lg" className="mt-9 h-12 rounded-full px-8 text-base">
          <Link to="/register">
            Создать аккаунт <ArrowRight />
          </Link>
        </Button>
      </Container_>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-black/[0.06] py-10 text-sm text-[#64748b]">
      <Container_ className="flex flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <Logo />
          <span className="hidden sm:inline">· 3D-планирование загрузки фуры и контейнера</span>
        </div>
        <nav aria-label="Ссылки" className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {TIERS_ENABLED && (
            <a href="#pricing" className="hover:text-[#0b1220]">
              Тарифы
            </a>
          )}
          <a href="#faq" className="hover:text-[#0b1220]">
            Вопросы
          </a>
          <a href="#contact" className="hover:text-[#0b1220]">
            Связаться
          </a>
          <Link to="/login" className="hover:text-[#0b1220]">
            Войти
          </Link>
        </nav>
        <span>© {new Date().getFullYear()} Loader3D</span>
      </Container_>
    </footer>
  );
}
