import { useMemo, useState } from 'react';
import { CircleCheck, Info, TriangleAlert, WandSparkles } from 'lucide-react';
import { toast } from 'sonner';
import { autoload, type AutoloadBodyResult, type LeftReason } from '../core/autoload';
import { COG_LONG_TOLERANCE } from '../core/stats';
import { formatLength, formatPercent, formatWeight } from '../core/units';
import { activeVehicle, layoutOf, useStore } from '../store/useStore';
import { useUi } from '../store/useUi';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';

const ITEMS = ['груз', 'груза', 'грузов'] as const;

const REASONS: Record<LeftReason, string> = {
  no_space: 'не хватило места',
  overweight: 'превысили бы грузоподъёмность',
  too_big: 'больше кузова',
};

/** Automatic loading: options, a live preview of the result, apply as one undoable step. */
export function AutoloadDialog() {
  const open = useUi((s) => s.autoloadOpen);
  const setOpen = useUi((s) => s.setAutoloadOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">{open && <AutoloadForm />}</DialogContent>
    </Dialog>
  );
}

function AutoloadForm() {
  const items = useStore((s) => s.items);
  const vehicles = useStore((s) => s.vehicles);
  const dockMode = useStore((s) => s.dockMode);
  const active = useStore(activeVehicle);
  const applyItems = useStore((s) => s.applyItems);
  const setOpen = useUi((s) => s.setAutoloadOpen);
  const [allowStacking, setAllowStacking] = useState(true);
  const [repackAll, setRepackAll] = useState(false);
  const [target, setTarget] = useState<'active' | 'all'>('active');
  const many = vehicles.length > 1;

  const result = useMemo(
    () =>
      autoload(items, layoutOf({ vehicles, dockMode }), {
        allowStacking,
        repackAll,
        // All vehicles: the active one first.
        vehicleIds: target === 'active' ? [active.id] : [active.id, ...vehicles.filter((v) => v !== active).map((v) => v.id)],
      }),
    [items, vehicles, dockMode, active, target, allowStacking, repackAll],
  );
  const vehicleName = new Map(vehicles.map((v) => [v.id, v.name]));
  const considered = result.loaded.length + result.left.length;
  const reasons = Object.entries(
    result.left.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.reason]: (acc[l.reason] ?? 0) + 1 }), {}),
  ) as Array<[LeftReason, number]>;

  const apply = () => {
    applyItems(result.items, 'autoload');
    setOpen(false);
    toast.success(
      result.loaded.length > 0 ? `Загружено: ${plural(result.loaded.length, ITEMS)}` : 'Груз переразложен',
      { description: 'Отменить — Ctrl+Z' },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <WandSparkles className="size-5 text-primary" /> Автоматическая загрузка
        </DialogTitle>
        <DialogDescription className="text-pretty">
          Тяжёлые грузы — на пол и ближе к середине кузова, лёгкие — сверху. Центр тяжести держим посередине и по оси,
          грузоподъёмность не превышаем.
        </DialogDescription>
      </DialogHeader>

      {many && (
        <div className="space-y-1.5">
          <div className="text-sm font-medium">Куда грузить</div>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            className="w-full"
            value={target}
            onValueChange={(v) => v && setTarget(v as 'active' | 'all')}
            aria-label="Куда грузить"
          >
            <ToggleGroupItem value="active" className="min-w-0 flex-1">
              <span className="truncate">В «{active.name}»</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="all" className="flex-1">
              Во все машины
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {dockMode === 'own'
              ? 'Каждая машина берёт грузы со своей зоны накопления.'
              : 'Грузы берутся с общей зоны накопления' + (target === 'all' ? ', машины заполняются по очереди.' : '.')}
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Option
          id="autoload-stack"
          checked={allowStacking}
          onChange={setAllowStacking}
          title="Ставить грузы друг на друга"
          hint="Только когда на полу нет места: лёгкий на более тяжёлый, целиком на опоре"
        />
        <Option
          id="autoload-repack"
          checked={repackAll}
          onChange={setRepackAll}
          title="Переложить заново всё"
          hint={many ? 'Включая грузы, которые уже стоят в выбранных машинах' : 'Включая грузы, которые уже стоят в кузове'}
        />
      </div>

      <div className="rounded-xl border bg-muted/40 p-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium">Результат</span>
          <span className="text-sm tabular-nums">
            {considered === 0 ? (
              <span className="text-muted-foreground">на доке нет грузов</span>
            ) : (
              <>
                загрузим <b className="font-semibold">{result.loaded.length}</b> из {considered}
              </>
            )}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {result.bodies.map((b) => (
            <BodyResult key={b.id} b={b} vehicleName={many ? vehicleName.get(b.vehicleId) : undefined} />
          ))}
        </div>

        {reasons.length > 0 && (
          <div className="mt-3 flex gap-2 rounded-lg bg-warning/10 p-2.5 text-xs text-warning">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span>
              Останутся на доке:{' '}
              {reasons.map(([reason, count], i) => (
                <span key={reason}>
                  {i > 0 && '; '}
                  {plural(count, ITEMS)} — {REASONS[reason]}
                </span>
              ))}
            </span>
          </div>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline">Отмена</Button>
        </DialogClose>
        <Button onClick={apply} disabled={result.loaded.length === 0 && !repackAll}>
          <WandSparkles /> Разложить
        </Button>
      </DialogFooter>
    </>
  );
}

function Option(props: { id: string; checked: boolean; onChange(v: boolean): void; title: string; hint: string }) {
  return (
    <label htmlFor={props.id} className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{props.title}</span>
        <span className="block text-xs text-muted-foreground">{props.hint}</span>
      </span>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onChange} className="mt-0.5" />
    </label>
  );
}

function BodyResult({ b, vehicleName }: { b: AutoloadBodyResult; vehicleName?: string }) {
  const share = b.maxLoad ? Math.min(1, b.weight / b.maxLoad) : null;
  const offset = Math.round(b.cogOffset ?? 0);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate font-medium">
          {vehicleName && <span className="text-muted-foreground">{vehicleName} · </span>}
          {b.name}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {plural(b.count, ITEMS)} · {formatWeight(b.weight)}
          {b.maxLoad !== undefined && ` из ${formatWeight(b.maxLoad)}`}
        </span>
      </div>
      {share !== null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
          <div className="h-full rounded-full bg-primary" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      {b.cogFromFront !== null && (
        <div className={cn('mt-1.5 flex items-start gap-1.5 text-xs', b.balanced ? 'text-success' : 'text-warning')}>
          {b.balanced ? <CircleCheck className="mt-px size-3.5 shrink-0" /> : <TriangleAlert className="mt-px size-3.5 shrink-0" />}
          <span>
            Центр тяжести — {formatPercent(b.cogFromFront)} длины от передней стенки
            {offset !== 0 ? `, ${Math.abs(offset)} см ${offset > 0 ? 'вправо' : 'влево'}` : ', по оси'}
            {!b.balanced && ` (норма ${formatPercent(0.5 - COG_LONG_TOLERANCE)}–${formatPercent(0.5 + COG_LONG_TOLERANCE)})`}
          </span>
        </div>
      )}
      {b.shiftedBack > 0 && (
        <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          <span>
            Груз отодвинут от передней стенки на {formatLength(b.shiftedBack, 'm')} для развесовки — закрепите его
            ремнями.
          </span>
        </div>
      )}
    </div>
  );
}
