import { useEffect, useRef, useState } from 'react';
import { Lock, LockOpen, Scale, Scan, TriangleAlert, X } from 'lucide-react';
import { COG_LAT_TOLERANCE, COG_LONG_TOLERANCE, type BodyStats } from '../core/stats';
import { formatMeters, formatPercent, formatVolume, formatWeight } from '../core/units';
import type { ViewPreset } from '../scene/CameraRig';
import { SceneEngine } from '../scene/SceneEngine';
import { getEngine, setEngine } from '../scene/engineRegistry';
import { useStore } from '../store/useStore';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useActiveVehicle, useStats } from './hooks';
import { VehiclePanel } from './VehiclePanel';
import { XrayControl } from './XrayControl';

const HINT_KEY = 'loader3d:hint-dismissed';

function readHintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

/** The 3D scene with its floating overlays; `rightInset` keeps them clear of the cargo panel. */
export function Viewport({ rightInset = 0 }: { rightInset?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let engine: SceneEngine;
    try {
      engine = new SceneEngine(hostRef.current!);
    } catch (e) {
      console.error(e);
      setError('Не удалось запустить 3D (WebGL недоступен в этом браузере).');
      return;
    }
    setEngine(engine);
    // Handy for debugging in the browser console during development.
    if (import.meta.env.DEV) Object.assign(window, { __loader3d: engine });
    return () => {
      setEngine(null);
      engine.dispose();
    };
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden bg-scene">
      <div ref={hostRef} className="viewport-host" />
      {error && <div className="absolute inset-0 grid place-items-center p-6 text-center text-muted-foreground">{error}</div>}

      <div
        className="pointer-events-none absolute top-3 bottom-3 left-3 flex flex-col gap-3"
        style={{ right: rightInset + 12 }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:content-start sm:items-start">
          <ViewToolbar />
          <VehiclePanel className="w-full sm:order-first sm:max-h-full sm:w-[320px]" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <Hint />
          <StatsBar />
        </div>
      </div>
    </div>
  );
}

const floating = 'pointer-events-auto rounded-xl border bg-card/95 shadow-lg shadow-foreground/5 backdrop-blur-md';

const VIEWS: Array<{ id: ViewPreset; label: string; title: string }> = [
  { id: 'iso', label: '3D', title: 'Общий вид' },
  { id: 'top', label: 'Сверху', title: 'Вид сверху' },
  { id: 'side', label: 'Сбоку', title: 'Вид сбоку' },
  { id: 'rear', label: 'Сзади', title: 'Вид со стороны дверей' },
];

/** Camera presets, "show all" and the optional camera lock. */
function ViewToolbar() {
  const locked = useStore((s) => s.settings.cameraLocked);
  const setSetting = useStore((s) => s.setSetting);

  return (
    <div
      className={cn(floating, 'flex shrink-0 items-center gap-0.5 self-end p-1 sm:ml-auto sm:self-auto')}
      role="toolbar"
      aria-label="Камера"
    >
      {VIEWS.map((v) => (
        <Tooltip key={v.id}>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" className="px-2 text-xs" onClick={() => getEngine()?.setView(v.id)}>
              {v.label}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{v.title}</TooltipContent>
        </Tooltip>
      ))}
      <span className="mx-0.5 h-5 w-px bg-border" />
      <XrayControl />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" onClick={() => getEngine()?.fitAll()} aria-label="Показать всё">
            <Scan />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Показать всё</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={locked}
            aria-label="Фиксация камеры"
            className={cn(locked && 'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary')}
            onClick={() => setSetting('cameraLocked', !locked)}
          >
            {locked ? <Lock /> : <LockOpen />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {locked ? 'Камера зафиксирована — нажмите, чтобы освободить' : 'Зафиксировать камеру'}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function Hint() {
  const [dismissed, setDismissed] = useState(readHintDismissed);
  const coarse = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  if (dismissed) return null;
  const close = () => {
    setDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* private mode */
    }
  };
  const kbd = 'h-4.5 border-white/15 bg-white/15 text-white';
  return (
    <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-foreground/85 py-1 pr-1 pl-3.5 text-xs text-white/85 shadow-lg backdrop-blur-md">
      {coarse ? (
        <span className="truncate">
          <b className="font-medium text-white">Палец по фону</b> — вращение · <b className="font-medium text-white">на грузе</b> —
          перемещение · <b className="font-medium text-white">два пальца</b> — масштаб
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          <b className="font-medium text-white">Тянуть фон</b> — вращение ·<b className="font-medium text-white">тянуть груз</b>— перемещение ·
          <Kbd className={kbd}>R</Kbd> поворот · <Kbd className={kbd}>Del</Kbd> удалить
        </span>
      )}
      <button
        type="button"
        onClick={close}
        aria-label="Скрыть подсказку"
        className="grid size-6 shrink-0 place-items-center rounded-full text-white/70 hover:bg-white/15 hover:text-white"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

/**
 * Fill level, weight and balance per body of the active vehicle; counts of its cargo inside / on
 * its dock / sticking out.
 */
function StatsBar() {
  const stats = useStats();
  const total = useStore((s) => s.items.length);
  const many = useStore((s) => s.vehicles.length > 1);
  const vehicle = useActiveVehicle();
  const counts = stats.vehicles.find((v) => v.id === vehicle.id) ?? stats;
  const bodies = stats.bodies.filter((b) => b.vehicleId === vehicle.id);

  return (
    <div
      className={cn(
        floating,
        'flex w-full max-w-4xl flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 sm:gap-x-6 sm:gap-y-3 sm:px-4 sm:py-3',
      )}
    >
      {bodies.map((b) => (
        <BodyStat key={b.id} b={b} vehicleName={many && b === bodies[0] ? vehicle.name : undefined} />
      ))}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Stat tone="ok" label={many ? 'В машине' : 'В кузове'} value={String(counts.inside)} />
        <Stat
          label="На доке"
          value={counts.dockWeight > 0 ? `${counts.dock} · ${formatWeight(counts.dockWeight)}` : String(counts.dock)}
        />
        {counts.overflow > 0 && <Stat tone="danger" label="За габаритами" value={String(counts.overflow)} />}
        <span className="ml-1 hidden text-muted-foreground tabular-nums sm:inline">
          всего {total} · {formatVolume(stats.cargoVolume)}
          {stats.cargoWeight > 0 && ` · ${formatWeight(stats.cargoWeight)}`}
        </span>
      </div>
    </div>
  );
}

function BodyStat({ b, vehicleName }: { b: BodyStats; vehicleName?: string }) {
  return (
    <div className="min-w-[130px] flex-1 sm:min-w-[200px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {vehicleName && <span className="text-foreground">{vehicleName} · </span>}
          {b.name}
        </span>
        <span className="text-sm font-semibold tabular-nums">{formatPercent(b.fill)}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={`Заполнение по объёму: ${b.name}`}
        aria-valuenow={Math.round(b.fill * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full bg-primary transition-[width] duration-300', b.fill > 1 && 'bg-destructive')}
          style={{ width: `${Math.min(100, b.fill * 100)}%` }}
        />
      </div>
      <div className="mt-1 hidden text-[11px] text-muted-foreground tabular-nums sm:block">
        {formatVolume(b.used)} из {formatVolume(b.capacity)} · LDM {formatMeters(b.ldm)}
      </div>
      {(b.weight > 0 || b.maxLoad !== undefined) && (
        <div className="mt-1 flex items-center gap-2 text-[11px] tabular-nums">
          <span
            className={cn(
              'flex items-center gap-1 text-muted-foreground',
              b.overweight && 'font-medium text-destructive',
            )}
          >
            {b.overweight ? <TriangleAlert className="size-3" /> : <Scale className="size-3" />}
            {formatWeight(b.weight)}
            {b.maxLoad !== undefined && ` из ${formatWeight(b.maxLoad)}`}
          </span>
          {b.cogFromFront !== null && <CogBadge b={b} />}
        </div>
      )}
    </div>
  );
}

/** Centre of gravity of the load: green inside the safe zone, amber outside. */
function CogBadge({ b }: { b: BodyStats }) {
  const offset = Math.round(b.cogOffset ?? 0);
  const side = offset === 0 ? 'по оси кузова' : `${Math.abs(offset)} см ${offset > 0 ? 'вправо' : 'влево'} от оси`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            'inline-flex h-4.5 items-center gap-1 rounded-full px-1.5 font-medium outline-none',
            b.balanced ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning',
          )}
        >
          {!b.balanced && <TriangleAlert className="size-3" />}
          ЦТ {formatPercent(b.cogFromFront!)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">
        Центр тяжести груза — {formatPercent(b.cogFromFront!)} длины от передней стенки, {side}. Безопасно:{' '}
        {formatPercent(0.5 - COG_LONG_TOLERANCE)}–{formatPercent(0.5 + COG_LONG_TOLERANCE)} длины и не дальше{' '}
        {formatPercent(COG_LAT_TOLERANCE)} ширины от оси.
      </TooltipContent>
    </Tooltip>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'danger' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-full bg-muted px-2.5 font-medium text-muted-foreground tabular-nums',
        tone === 'ok' && 'bg-success/10 text-success',
        tone === 'danger' && 'bg-destructive/10 text-destructive',
      )}
    >
      {tone === 'danger' && <TriangleAlert className="size-3.5" />}
      {label}: {value}
    </span>
  );
}
