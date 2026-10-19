import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  PackagePlus,
  PanelRightClose,
  Plus,
  RotateCw,
  Trash2,
  WandSparkles,
} from 'lucide-react';
import type { CargoItem, Dims } from '../core/types';
import { CARGO_COLORS, CARGO_PRESETS, ITEM_WEIGHT_LIMIT } from '../core/presets';
import type { Placement } from '../core/stats';
import { formatDims, formatVolume, formatWeight, type Units } from '../core/units';
import { getEngine } from '../scene/engineRegistry';
import { useStore } from '../store/useStore';
import { useUi } from '../store/useUi';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { plural } from '@/lib/format';
import { cn } from '@/lib/utils';
import { NumberField, Stepper, WeightField } from './fields';
import { usePlacements, useStats, useUnits } from './hooks';

const ITEMS = ['груз', 'груза', 'грузов'] as const;

/** The cargo panel: new cargo, automatic loading, the list with the inspector of the selected item. */
export function CargoPanel({ onHide }: { onHide?: () => void }) {
  const count = useStore((s) => s.items.length);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pr-1.5 pl-4">
        <h2 className="text-sm font-semibold">Грузы</h2>
        <Badge variant="secondary" className="h-5 px-1.5 tabular-nums">
          {count}
        </Badge>
        {onHide && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="ml-auto text-muted-foreground" onClick={onHide} aria-label="Скрыть панель">
                <PanelRightClose />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Скрыть панель — вся сцена на экране</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AddCargoForm />
        <AutoloadCard />
        <CargoList />
      </div>
    </div>
  );
}

function SectionTitle({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('text-xs font-medium text-muted-foreground', className)}>{children}</div>;
}

function AddCargoForm() {
  const addItems = useStore((s) => s.addItems);
  const isEmpty = useStore((s) => s.items.length === 0);
  const collapsed = useUi((s) => s.addFormCollapsed) && !isEmpty;
  const setCollapsed = useUi((s) => s.setAddFormCollapsed);
  const units = useUnits();
  const [dims, setDims] = useState<Dims>(CARGO_PRESETS[0].dims);
  const [name, setName] = useState(CARGO_PRESETS[0].name);
  const [weight, setWeight] = useState(CARGO_PRESETS[0].weight);
  const [count, setCount] = useState(1);
  const preset = CARGO_PRESETS.find(
    (p) => p.name === name && p.dims.l === dims.l && p.dims.w === dims.w && p.dims.h === dims.h,
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    addItems({ dims, name, count, weight });
  };

  return (
    <form className="border-b" onSubmit={submit}>
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 pt-3 pb-2 text-left text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:cursor-default"
        onClick={() => setCollapsed(!collapsed)}
        disabled={isEmpty}
        aria-expanded={!collapsed}
      >
        <PackagePlus className="size-4 text-primary" />
        Новый груз
        {!isEmpty && (
          <ChevronDown className={cn('ml-auto size-4 text-muted-foreground transition-transform', collapsed && '-rotate-90')} />
        )}
      </button>

      {!collapsed && (
        <div className="space-y-3.5 px-4 pb-4">
          <div className="space-y-1.5">
            <SectionTitle>Типовой груз</SectionTitle>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Типовой груз">
              {CARGO_PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  role="radio"
                  aria-checked={preset === p}
                  title={`${formatDims(p.dims, units)} · ${formatWeight(p.weight)}`}
                  onClick={() => {
                    setDims(p.dims);
                    setName(p.name);
                    setWeight(p.weight);
                  }}
                  className={cn(
                    'h-7 rounded-full border bg-background px-2.5 text-xs font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50',
                    preset === p && 'border-primary bg-primary/10 text-primary hover:bg-primary/10',
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="new-cargo-name" className="text-xs font-medium text-muted-foreground">
              Название
            </label>
            <Input
              id="new-cargo-name"
              placeholder="Например, «Паллета с плиткой»"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <NumberField live label="Ширина" value={dims.w} units={units} onCommit={(w) => setDims((d) => ({ ...d, w }))} />
            <NumberField live label="Высота" value={dims.h} units={units} onCommit={(h) => setDims((d) => ({ ...d, h }))} />
            <NumberField live label="Длина" value={dims.l} units={units} onCommit={(l) => setDims((d) => ({ ...d, l }))} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <WeightField live label="Вес одного" kg={weight} max={ITEM_WEIGHT_LIMIT} onCommit={setWeight} />
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Количество</span>
              <Stepper value={count} onChange={setCount} label="Количество" />
            </div>
          </div>

          <Button type="submit" className="w-full">
            <Plus />
            {count > 1 ? `Добавить ${plural(count, ITEMS)}` : 'Добавить груз'}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">
            Грузы появятся на доке у задних дверей{count > 1 && weight > 0 ? ` · всего ${formatWeight(weight * count)}` : ''}
          </p>
        </div>
      )}
    </form>
  );
}

/** Call to action while there is cargo on the dock. */
function AutoloadCard() {
  const stats = useStats();
  const setAutoloadOpen = useUi((s) => s.setAutoloadOpen);
  if (stats.dock === 0) return null;
  return (
    <div className="border-b p-3">
      <button
        type="button"
        onClick={() => setAutoloadOpen(true)}
        className="group/auto flex w-full items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-2.5 text-left transition-colors outline-none hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
          <WandSparkles className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Загрузить в кузов</span>
          <span className="block truncate text-xs text-muted-foreground">
            На доке {plural(stats.dock, ITEMS)}
            {stats.dockWeight > 0 && ` · ${formatWeight(stats.dockWeight)}`} — разложим автоматически
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-primary transition-transform group-hover/auto:translate-x-0.5" />
      </button>
    </div>
  );
}

function CargoList() {
  const items = useStore((s) => s.items);
  const selectedId = useStore((s) => s.selectedId);
  const clearItems = useStore((s) => s.clearItems);
  const setAutoloadOpen = useUi((s) => s.setAutoloadOpen);
  const placements = usePlacements();

  return (
    <section>
      <div className="flex items-center gap-1 px-4 pt-3 pb-1.5">
        <h3 className="text-sm font-semibold">Список</h3>
        <span className="ml-1.5 text-[11px] text-muted-foreground">Ш × В × Д · вес</span>
        {items.length > 0 && (
          <div className="ml-auto flex items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-xs" className="text-muted-foreground" onClick={() => setAutoloadOpen(true)} aria-label="Автозагрузка">
                  <WandSparkles />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Автозагрузка и перераскладка</TooltipContent>
            </Tooltip>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="xs" className="text-muted-foreground">
                  Очистить
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Убрать все грузы?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Из схемы будут удалены {plural(items.length, ITEMS)}. Вернуть можно через «Отменить» (Ctrl+Z).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Отмена</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={clearItems}>
                    Убрать все
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <Empty className="mx-4 mb-4 border border-dashed py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PackagePlus />
            </EmptyMedia>
            <EmptyTitle>Грузов пока нет</EmptyTitle>
            <EmptyDescription>Выберите типовой груз или задайте размеры и нажмите «Добавить груз».</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-1 px-2 pb-3">
          {items.map((item) => (
            <CargoRow key={item.id} item={item} placement={placements.get(item.id)} selected={item.id === selectedId} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusBadge({ placement, multiBody }: { placement?: Placement; multiBody: boolean }) {
  if (!placement) return null;
  if (placement.status === 'overflow') {
    return <Badge className="shrink-0 bg-destructive/10 text-destructive">За габаритами</Badge>;
  }
  if (placement.status === 'inside') {
    return (
      <Badge className="max-w-24 shrink-0 truncate bg-success/10 text-success">
        {multiBody && placement.body ? placement.body.body.name : 'В кузове'}
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="shrink-0 text-muted-foreground">
      Док
    </Badge>
  );
}

function CargoRow({ item, placement, selected }: { item: CargoItem; placement?: Placement; selected: boolean }) {
  const select = useStore((s) => s.select);
  const removeItem = useStore((s) => s.removeItem);
  const multiBody = useStore((s) => s.bodies.length > 1);
  const units = useUnits();
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  return (
    <li
      ref={ref}
      className={cn(
        'group/row rounded-lg border border-transparent transition-colors',
        selected ? 'border-primary/30 bg-primary/[0.035] shadow-sm' : 'hover:bg-muted/70',
      )}
    >
      <div className="flex items-center gap-1 pr-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-2 pl-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => select(selected ? null : item.id)}
          onDoubleClick={() => getEngine()?.focusItem(item.id)}
          title="Выбрать (двойной клик — показать на сцене)"
        >
          <span
            className="grid size-8 shrink-0 place-items-center rounded-md text-[11px] font-bold text-white tabular-nums shadow-[inset_0_-2px_0_rgba(0,0,0,0.12)]"
            style={{ background: item.color }}
          >
            {item.seq}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm leading-tight font-medium">{item.name}</span>
            <span className="block truncate text-xs text-muted-foreground tabular-nums">
              {formatDims(item.dims, units)}
              {item.weight ? ` · ${formatWeight(item.weight)}` : ''}
            </span>
          </span>
          <StatusBadge placement={placement} multiBody={multiBody} />
        </button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Удалить"
          className="shrink-0 text-muted-foreground opacity-0 group-hover/row:opacity-100 hover:text-destructive focus-visible:opacity-100 pointer-coarse:opacity-100"
          onClick={() => removeItem(item.id)}
        >
          <Trash2 />
        </Button>
      </div>
      {selected && <ItemInspector item={item} units={units} />}
    </li>
  );
}

function ItemInspector({ item, units }: { item: CargoItem; units: Units }) {
  const updateItem = useStore((s) => s.updateItem);
  const rotateItem = useStore((s) => s.rotateItem);
  const duplicateItem = useStore((s) => s.duplicateItem);
  const removeItem = useStore((s) => s.removeItem);
  const [name, setName] = useState(item.name);
  useEffect(() => setName(item.name), [item.name]);

  const commitName = () => {
    if (name.trim() && name !== item.name) updateItem(item.id, { name });
    else setName(item.name);
  };
  const setDim = (key: keyof Dims) => (v: number) => updateItem(item.id, { dims: { ...item.dims, [key]: v } });

  const actions = [
    { icon: RotateCw, label: 'Повернуть на 90°', keys: 'R', run: () => rotateItem(item.id) },
    { icon: Copy, label: 'Дублировать', keys: 'Ctrl+D', run: () => duplicateItem(item.id) },
    { icon: Crosshair, label: 'Показать на сцене', keys: 'F', run: () => getEngine()?.focusItem(item.id) },
  ];

  return (
    <div className="space-y-3 border-t border-primary/15 px-3 pt-3 pb-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`name-${item.id}`}>
          Название
        </label>
        <Input
          id={`name-${item.id}`}
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <NumberField label="Ширина" value={item.dims.w} units={units} onCommit={setDim('w')} />
        <NumberField label="Высота" value={item.dims.h} units={units} onCommit={setDim('h')} />
        <NumberField label="Длина" value={item.dims.l} units={units} onCommit={setDim('l')} />
      </div>
      <div className="grid grid-cols-3 items-end gap-2">
        <WeightField label="Вес" kg={item.weight} max={ITEM_WEIGHT_LIMIT} onCommit={(kg) => updateItem(item.id, { weight: kg })} />
        <p className="col-span-2 pb-2 text-xs text-muted-foreground">
          {item.orientation.yaw === 90 ? 'Повёрнут на 90°' : 'Исходная ориентация'} ·{' '}
          {formatVolume(item.dims.l * item.dims.w * item.dims.h)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <div className="mr-auto flex flex-wrap gap-1.5" role="radiogroup" aria-label="Цвет">
          {CARGO_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={c === item.color}
              aria-label={c}
              className={cn(
                'size-5 rounded-full ring-offset-2 ring-offset-card transition-transform outline-none hover:scale-110 focus-visible:ring-2 focus-visible:ring-ring',
                c === item.color && 'ring-2 ring-foreground/70',
              )}
              style={{ background: c }}
              onClick={() => updateItem(item.id, { color: c })}
            />
          ))}
        </div>
      </div>
      <div className="flex items-center justify-end gap-1">
        {actions.map(({ icon: Icon, label, keys, run }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon-sm" aria-label={label} onClick={run}>
                <Icon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {label} · {keys}
            </TooltipContent>
          </Tooltip>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="destructive" size="icon-sm" aria-label="Удалить" onClick={() => removeItem(item.id)}>
              <Trash2 />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Удалить · Del</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
