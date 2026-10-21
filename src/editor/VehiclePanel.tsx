import { useEffect, useState } from 'react';
import { ChevronDown, Plus, Trash2, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import type { DockMode, Vehicle } from '../core/types';
import { BODY_LIMITS, BODY_MAX_LOAD_LIMIT, MAX_BODIES, MAX_VEHICLES, VEHICLE_PRESETS } from '../core/presets';
import { UNIT_LABEL, formatLength, formatWeight } from '../core/units';
import { getEngine } from '../scene/engineRegistry';
import { useStore } from '../store/useStore';
import { useUi } from '../store/useUi';
import { vehicleDims, vehicleIcon } from '@/components/plans/vehicles';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { NumberField, WeightField } from './fields';
import { useActiveVehicle, useStats, useUnits } from './hooks';

/**
 * Floating card over the scene: the vehicles of the plan (switcher, add, remove, shared or own
 * docks) and the active one in detail — preset, one block per cargo body, "+ trailer".
 */
export function VehiclePanel({ className }: { className?: string }) {
  const vehicles = useStore((s) => s.vehicles);
  const vehicle = useActiveVehicle();
  const applyPreset = useStore((s) => s.applyVehiclePreset);
  const collapsed = useUi((s) => s.vehicleCollapsed);
  const setCollapsed = useUi((s) => s.setVehicleCollapsed);
  const units = useUnits();
  const f = (cm: number) => formatLength(cm, units, false);
  const many = vehicles.length > 1;

  return (
    <section
      aria-label="Транспорт"
      className={cn(
        'pointer-events-auto flex max-h-full w-[320px] max-w-full flex-col overflow-hidden rounded-2xl border bg-card/95 shadow-lg shadow-foreground/5 backdrop-blur-md',
        className,
      )}
    >
      <header className="flex items-center gap-2 py-2 pr-2 pl-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Truck className="size-[18px]" />
        </span>
        <button
          type="button"
          className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
        >
          <span className="block truncate text-sm font-semibold">{many ? vehicle.name : 'Транспорт'}</span>
          {collapsed && (
            <span className="block truncate text-[11px] text-muted-foreground tabular-nums">
              {vehicle.bodies.map((b) => `${f(b.dims.l)} × ${f(b.dims.w)} × ${f(b.dims.h)}`).join(' + ')} {UNIT_LABEL[units]}
            </span>
          )}
        </button>
        {!collapsed && (
          <Select value="" onValueChange={(id) => applyPreset(id, vehicle.id)}>
            <SelectTrigger size="sm" className="w-[118px] text-xs" aria-label="Шаблон транспорта">
              <SelectValue placeholder="Шаблон…" />
            </SelectTrigger>
            <SelectContent align="end">
              {VEHICLE_PRESETS.map((p) => {
                const Icon = vehicleIcon(p.id);
                return (
                  <SelectItem key={p.id} value={p.id}>
                    <Icon className="text-muted-foreground" />
                    <span className="flex flex-1 items-baseline justify-between gap-3">
                      {p.name}
                      <span className="text-xs text-muted-foreground tabular-nums">{vehicleDims(p)}</span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Развернуть' : 'Свернуть'}
        >
          <ChevronDown className={cn('transition-transform', !collapsed && 'rotate-180')} />
        </Button>
      </header>

      {many && <VehicleSwitcher />}

      {!collapsed && (
        <div className="min-h-0 space-y-2.5 overflow-y-auto overscroll-contain border-t px-3 pt-3 pb-3">
          {many && <VehicleName key={vehicle.id} vehicle={vehicle} />}
          <BodyList vehicle={vehicle} />
          <div className="grid grid-cols-2 gap-2">
            <AddTrailer vehicle={vehicle} />
            <AddVehicle />
          </div>
          {many && <DockModeSwitch />}
        </div>
      )}
    </section>
  );
}

/** Makes a vehicle active and slides the camera over to it. */
function switchTo(id: string): void {
  useStore.getState().setActiveVehicle(id);
  getEngine()?.focusVehicle(id);
}

/** One chip per vehicle: the active one is highlighted, the count is the cargo in it. */
function VehicleSwitcher() {
  const vehicles = useStore((s) => s.vehicles);
  const activeId = useStore((s) => s.activeVehicleId);
  const stats = useStats();
  return (
    <div className="flex gap-1 overflow-x-auto overscroll-contain border-t px-2.5 py-2" role="group" aria-label="Машины">
      {vehicles.map((v) => {
        const active = v.id === activeId;
        const s = stats.vehicles.find((x) => x.id === v.id);
        const count = (s?.inside ?? 0) + (s?.overflow ?? 0);
        return (
          <button
            key={v.id}
            type="button"
            aria-pressed={active}
            onClick={() => switchTo(v.id)}
            title={v.bodies.map((b) => b.name).join(' + ')}
            className={cn(
              'flex h-7 max-w-36 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              active ? 'border-primary bg-primary text-primary-foreground' : 'bg-background hover:bg-muted',
            )}
          >
            <span className="truncate">{v.name}</span>
            <span className={cn('tabular-nums', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{count}</span>
          </button>
        );
      })}
    </div>
  );
}

function VehicleName({ vehicle }: { vehicle: Vehicle }) {
  const renameVehicle = useStore((s) => s.renameVehicle);
  const removeVehicle = useStore((s) => s.removeVehicle);
  const undo = useStore((s) => s.undo);
  const [name, setName] = useState(vehicle.name);
  useEffect(() => setName(vehicle.name), [vehicle.name]);

  const commit = () => {
    if (name.trim() && name !== vehicle.name) renameVehicle(vehicle.id, name);
    else setName(vehicle.name);
  };
  const remove = () => {
    removeVehicle(vehicle.id);
    toast(`«${vehicle.name}» убрана`, {
      description: 'Её грузы переехали на док',
      action: { label: 'Вернуть', onClick: undo },
    });
  };

  return (
    <div className="flex items-end gap-1.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground" htmlFor={`vehicle-${vehicle.id}`}>
          Название машины
        </label>
        <Input
          id={`vehicle-${vehicle.id}`}
          value={name}
          maxLength={100}
          className="h-8"
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="mb-px text-muted-foreground hover:text-destructive" aria-label="Убрать машину" onClick={remove}>
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Убрать машину — грузы переедут на док</TooltipContent>
      </Tooltip>
    </div>
  );
}

function BodyList({ vehicle }: { vehicle: Vehicle }) {
  const updateBody = useStore((s) => s.updateBody);
  const setBodyMaxLoad = useStore((s) => s.setBodyMaxLoad);
  const removeBody = useStore((s) => s.removeBody);
  const units = useUnits();
  const stats = useStats();
  const [lMin, lMax] = BODY_LIMITS.l;
  const [wMin, wMax] = BODY_LIMITS.w;
  const [hMin, hMax] = BODY_LIMITS.h;
  const { bodies } = vehicle;

  return bodies.map((b, i) => {
    const s = stats.bodies.find((x) => x.id === b.id);
    return (
      <div key={b.id} className="space-y-2">
        {bodies.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="grid size-5 place-items-center rounded bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">
              {i + 1}
            </span>
            <span className="flex-1 truncate text-xs font-semibold">{b.name}</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Убрать кузов"
                  onClick={() => removeBody(b.id)}
                >
                  <X />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Убрать кузов — грузы переедут на док</TooltipContent>
            </Tooltip>
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <NumberField label="Длина" value={b.dims.l} units={units} min={lMin} max={lMax} onCommit={(l) => updateBody(b.id, { ...b.dims, l })} />
          <NumberField label="Ширина" value={b.dims.w} units={units} min={wMin} max={wMax} onCommit={(w) => updateBody(b.id, { ...b.dims, w })} />
          <NumberField label="Высота" value={b.dims.h} units={units} min={hMin} max={hMax} onCommit={(h) => updateBody(b.id, { ...b.dims, h })} />
        </div>
        <div className="grid grid-cols-[1fr_auto] items-end gap-2">
          <WeightField
            label="Грузоподъёмность"
            kg={b.maxLoad}
            unit="t"
            max={BODY_MAX_LOAD_LIMIT}
            onCommit={(kg) => setBodyMaxLoad(b.id, kg > 0 ? kg : undefined)}
          />
          {s && (
            <span
              className={cn(
                'pb-2 text-right text-[11px] text-muted-foreground tabular-nums',
                s.overweight && 'font-medium text-destructive',
              )}
            >
              загружено {formatWeight(s.weight)}
            </span>
          )}
        </div>
        {i < bodies.length - 1 && <div className="border-t pt-0.5" />}
      </div>
    );
  });
}

function AddTrailer({ vehicle }: { vehicle: Vehicle }) {
  const addTrailer = useStore((s) => s.addTrailer);
  const full = vehicle.bodies.length >= MAX_BODIES;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="min-w-0">
          <Button
            variant="outline"
            size="sm"
            className="w-full border-dashed text-muted-foreground"
            onClick={() => addTrailer(vehicle.id)}
            disabled={full}
          >
            <Plus /> Прицеп
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{full ? `Не больше ${MAX_BODIES} кузовов в сцепке` : 'Прицеп к этой машине'}</TooltipContent>
    </Tooltip>
  );
}

/** "+ Машина" with the vehicle presets to pick from. */
function AddVehicle() {
  const addVehicle = useStore((s) => s.addVehicle);
  const full = useStore((s) => s.vehicles.length >= MAX_VEHICLES);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full border-dashed text-muted-foreground" disabled={full}>
          <Plus /> Машина
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>{full ? `Не больше ${MAX_VEHICLES} машин` : 'Добавить машину рядом'}</DropdownMenuLabel>
        {VEHICLE_PRESETS.map((p) => {
          const Icon = vehicleIcon(p.id);
          return (
            <DropdownMenuItem key={p.id} onSelect={() => addVehicle(p.id)}>
              <Icon className="text-muted-foreground" />
              <span className="flex flex-1 items-baseline justify-between gap-3">
                {p.name}
                <span className="text-xs text-muted-foreground tabular-nums">{vehicleDims(p)}</span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const DOCK_MODES: Array<{ value: DockMode; label: string; hint: string }> = [
  { value: 'shared', label: 'Общая', hint: 'Одна платформа вдоль всех машин: машины рядом, груз легко перекладывать' },
  { value: 'own', label: 'У каждой своя', hint: 'Отдельная платформа за каждой машиной: свои грузы у каждой' },
];

/** Shared staging platform for all vehicles, or one behind each. */
function DockModeSwitch() {
  const dockMode = useStore((s) => s.dockMode);
  const setDockMode = useStore((s) => s.setDockMode);
  return (
    <div className="space-y-1.5 border-t pt-2.5">
      <div className="text-xs font-medium text-muted-foreground">Зона накопления</div>
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        spacing={0}
        className="w-full"
        value={dockMode}
        onValueChange={(v) => v && setDockMode(v as DockMode)}
        aria-label="Зона накопления"
      >
        {DOCK_MODES.map((m) => (
          <ToggleGroupItem key={m.value} value={m.value} className="flex-1 text-xs" title={m.hint}>
            {m.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <p className="text-[11px] text-pretty text-muted-foreground">{DOCK_MODES.find((m) => m.value === dockMode)?.hint}</p>
    </div>
  );
}
