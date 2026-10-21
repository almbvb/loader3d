import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { CargoBody, CargoItem, Dims, DockMode, Plan, Vehicle } from '../core/types';
import { computeLayout, ownerVehicle, type VehicleLayout } from '../core/layout';
import { itemBox, itemSize, sanitizeItemDims, uid } from '../core/item';
import { settle } from '../core/physics';
import { dockSpot } from '../core/spawn';
import { effectiveDims, rotate90, type RotationAxis } from '../core/orientation';
import { beginMove, evaluateMove, finishMove } from '../core/move';
import { nextVehicleName, parsePlan, relayout } from '../core/plan';
import {
  BODY_LIMITS,
  BODY_MAX_LOAD_LIMIT,
  CARGO_COLORS,
  ITEM_WEIGHT_LIMIT,
  DEFAULT_TRAILER,
  MAX_BODIES,
  MAX_VEHICLES,
  VEHICLE_PRESETS,
  type BodyTemplate,
} from '../core/presets';
import type { Units } from '../core/units';

/**
 * See-through cargo: nothing, the cargo in front of the selected item, every item that hides
 * another one, or all cargo but the selected item.
 */
export type XrayMode = 'off' | 'selection' | 'auto' | 'all';

export interface Settings {
  highlightOverflow: boolean;
  showDimensions: boolean;
  showLabels: boolean;
  snapping: boolean;
  resizeHandles: boolean;
  cameraLocked: boolean;
  units: Units;
  /** Quarter turns about all three axes (tipping cargo over), not only about the vertical. */
  allowTilt: boolean;
  xray: XrayMode;
  /** Opacity of see-through cargo, XRAY_OPACITY_RANGE. */
  xrayOpacity: number;
}

export const XRAY_OPACITY_RANGE: [number, number] = [0.08, 0.8];

/** The undoable part of the state. */
export interface PlanState extends Plan {
  paletteIndex: number;
}

interface History {
  past: PlanState[];
  future: PlanState[];
  /** Consecutive commits with the same key (e.g. arrow-key nudges) collapse into one undo step. */
  lastKey: string | null;
  lastAt: number;
}

export interface NewCargo {
  dims: Dims;
  name?: string;
  count?: number;
  /** kg per item */
  weight?: number;
}

export interface AppState extends PlanState {
  selectedId: string | null;
  /** The vehicle the transport panel, the stats and new cargo refer to. Not part of the plan. */
  activeVehicleId: string;
  settings: Settings;
  history: History;

  addItems(input: NewCargo): void;
  updateItem(id: string, patch: { name?: string; color?: string; dims?: Dims; weight?: number }): void;
  /** Replaces the item list after an interactive edit in the scene (move, resize). */
  applyItems(items: CargoItem[], key?: string): void;
  removeItem(id: string): void;
  duplicateItem(id: string): void;
  /** A quarter turn about a world axis (default: the vertical). */
  rotateItem(id: string, axis?: RotationAxis): void;
  nudgeItem(id: string, dx: number, dz: number): void;
  clearItems(): void;
  /** Selecting cargo in another vehicle makes that vehicle the active one. */
  select(id: string | null): void;

  updateBody(id: string, dims: Dims): void;
  /** Payload capacity in kg; undefined removes the limit. */
  setBodyMaxLoad(id: string, maxLoad: number | undefined): void;
  addTrailer(vehicleId?: string): void;
  removeBody(id: string): void;
  /** Replaces the bodies of a vehicle (default: the active one). */
  applyVehiclePreset(presetId: string, vehicleId?: string): void;

  /** Adds a vehicle of a preset next to the others and makes it active; returns its id. */
  addVehicle(presetId: string): string | null;
  /** Cargo of the removed vehicle goes to the dock. */
  removeVehicle(id: string): void;
  renameVehicle(id: string, name: string): void;
  setDockMode(mode: DockMode): void;
  setActiveVehicle(id: string): void;

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  undo(): void;
  redo(): void;
  /** Replaces the plan as an undoable edit (import from a file, the example). */
  loadPlan(plan: unknown): void;
  /** Opens a saved plan: replaces everything and starts a fresh undo history. */
  openPlan(plan: unknown): void;
}

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1000;

const DEFAULT_SETTINGS: Settings = {
  highlightOverflow: true,
  showDimensions: true,
  showLabels: true,
  snapping: true,
  resizeHandles: true,
  cameraLocked: false,
  units: 'cm',
  allowTilt: false,
  xray: 'selection',
  xrayOpacity: 0.22,
};

const layoutCache = new WeakMap<readonly Vehicle[], Partial<Record<DockMode, VehicleLayout>>>();

/** Memoized layout of the current vehicles array. */
export function getLayout(vehicles: readonly Vehicle[], dockMode: DockMode): VehicleLayout {
  let byMode = layoutCache.get(vehicles);
  if (!byMode) {
    byMode = {};
    layoutCache.set(vehicles, byMode);
  }
  return (byMode[dockMode] ??= computeLayout(vehicles, dockMode));
}

export function layoutOf(s: Pick<Plan, 'vehicles' | 'dockMode'>): VehicleLayout {
  return getLayout(s.vehicles, s.dockMode);
}

function pickPlan(s: PlanState): PlanState {
  return { vehicles: s.vehicles, dockMode: s.dockMode, items: s.items, nextSeq: s.nextSeq, paletteIndex: s.paletteIndex };
}

function makeBody(t: BodyTemplate, id = uid('body')): CargoBody {
  const body: CargoBody = { id, kind: t.kind, name: t.name, dims: { ...t.dims } };
  if (t.maxLoad !== undefined) body.maxLoad = t.maxLoad;
  return body;
}

export function sanitizeWeight(kg: number): number {
  return Math.min(ITEM_WEIGHT_LIMIT, Math.max(0, Math.round(kg * 10) / 10));
}

function clampBodyDims(d: Dims): Dims {
  const clamp = (v: number, [lo, hi]: [number, number]) =>
    Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
  return { l: clamp(d.l, BODY_LIMITS.l), w: clamp(d.w, BODY_LIMITS.w), h: clamp(d.h, BODY_LIMITS.h) };
}

/** Puts `item` on a free spot of the vehicle's dock (or on top of something there if it is full). */
function placeOnDock(
  item: CargoItem,
  existing: readonly CargoItem[],
  layout: VehicleLayout,
  vehicleId: string | null,
): CargoItem {
  const spot = dockSpot(itemSize(item), layout, vehicleId, existing.map(itemBox));
  return { ...item, pos: { x: spot.x, y: 0, z: spot.z } };
}

/** Vehicles with the body `id` changed by `change` (null removes it). */
function mapBody(vehicles: Vehicle[], id: string, change: (b: CargoBody) => CargoBody | null): Vehicle[] {
  return vehicles.map((v) => {
    if (!v.bodies.some((b) => b.id === id)) return v;
    const bodies: CargoBody[] = [];
    for (const b of v.bodies) {
      const next = b.id === id ? change(b) : b;
      if (next) bodies.push(next);
    }
    return { ...v, bodies };
  });
}

function keepActive(vehicles: readonly Vehicle[], id: string): string {
  return vehicles.some((v) => v.id === id) ? id : vehicles[0].id;
}

export function createDemoPlan(): PlanState {
  const preset = VEHICLE_PRESETS[0];
  const vehicles: Vehicle[] = [{ id: uid('veh'), name: nextVehicleName([]), bodies: preset.bodies.map((b) => makeBody(b)) }];
  const layout = computeLayout(vehicles, 'shared');
  const body = layout.bodies[0].box;
  const items: CargoItem[] = [];
  let seq = 1;
  const add = (
    name: string,
    dims: Dims,
    weight: number,
    color: string,
    pos?: { x: number; z: number; y?: number },
  ) => {
    const item: CargoItem = {
      id: uid('cargo'),
      seq: seq++,
      name,
      dims,
      orientation: { yaw: 0 },
      pos: { x: 0, y: 0, z: 0 },
      color,
      weight,
    };
    items.push(pos ? { ...item, pos: { x: pos.x, y: pos.y ?? 0, z: pos.z } } : placeOnDock(item, items, layout, null));
  };

  // Two rows of euro pallets against the front wall, three across.
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      add('Европаллета', { l: 120, w: 80, h: 150 }, 450, CARGO_COLORS[0], {
        x: body.max.x - 120 * (row + 1),
        z: body.min.z + 80 * col,
      });
    }
  }
  add('Коробка', { l: 60, w: 40, h: 40 }, 25, CARGO_COLORS[4], { x: body.max.x - 120, z: body.min.z, y: 150 });
  add('Коробка', { l: 60, w: 40, h: 40 }, 25, CARGO_COLORS[4], { x: body.max.x - 60, z: body.min.z, y: 150 });
  for (let i = 0; i < 3; i++) add('IBC-куб', { l: 120, w: 100, h: 116 }, 1000, CARGO_COLORS[1]);
  for (let i = 0; i < 2; i++) add('Финпаллета', { l: 120, w: 100, h: 150 }, 600, CARGO_COLORS[2]);
  add('Длинномер', { l: 320, w: 60, h: 60 }, 180, CARGO_COLORS[3]);

  return { vehicles, dockMode: 'shared', items: settle(items), nextSeq: seq, paletteIndex: 5 };
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      const commit = (patch: Partial<PlanState>, extra: Partial<AppState> = {}, key?: string) => {
        const s = get();
        const now = Date.now();
        const coalesce = key !== undefined && s.history.lastKey === key && now - s.history.lastAt < COALESCE_MS;
        const past = coalesce ? s.history.past : [...s.history.past, pickPlan(s)].slice(-HISTORY_LIMIT);
        const vehicles = patch.vehicles ?? s.vehicles;
        const activeVehicleId = keepActive(vehicles, extra.activeVehicleId ?? s.activeVehicleId);
        set({ ...patch, ...extra, activeVehicleId, history: { past, future: [], lastKey: key ?? null, lastAt: now } });
      };

      const keepSelection = (items: CargoItem[], selectedId: string | null) =>
        selectedId && items.some((i) => i.id === selectedId) ? selectedId : null;

      /** The vehicle an item belongs to, if any. */
      const vehicleOf = (s: Pick<AppState, 'vehicles' | 'dockMode'>, item: CargoItem | undefined) =>
        item ? (ownerVehicle(itemBox(item), layoutOf(s))?.vehicle.id ?? null) : null;

      /** New vehicles; cargo moves along, cargo of removed bodies goes to the dock. */
      const withVehicles = (s: AppState, vehicles: Vehicle[], dockMode = s.dockMode, fallback = s.activeVehicleId) => ({
        vehicles,
        dockMode,
        items: relayout(s.items, layoutOf(s), getLayout(vehicles, dockMode), keepActive(vehicles, fallback)),
      });

      const setBodies = (s: AppState, vehicleId: string, change: (bodies: CargoBody[]) => CargoBody[]) =>
        withVehicles(
          s,
          s.vehicles.map((v) => (v.id === vehicleId ? { ...v, bodies: change(v.bodies) } : v)),
        );

      const demo = createDemoPlan();
      return {
        ...demo,
        selectedId: null,
        activeVehicleId: demo.vehicles[0].id,
        settings: DEFAULT_SETTINGS,
        history: { past: [], future: [], lastKey: null, lastAt: 0 },

        addItems({ dims, name, count = 1, weight }) {
          const s = get();
          const layout = layoutOf(s);
          const color = CARGO_COLORS[s.paletteIndex % CARGO_COLORS.length];
          const clean = sanitizeItemDims(dims);
          let items = [...s.items];
          let seq = s.nextSeq;
          const ids = new Set<string>();
          for (let n = 0; n < Math.max(1, Math.min(200, Math.round(count))); n++) {
            const item = placeOnDock(
              {
                id: uid('cargo'),
                seq,
                name: name?.trim() || 'Груз',
                dims: clean,
                orientation: { yaw: 0 },
                pos: { x: 0, y: 0, z: 0 },
                color,
                ...(weight !== undefined && weight > 0 ? { weight: sanitizeWeight(weight) } : {}),
              },
              items,
              layout,
              s.activeVehicleId,
            );
            seq++;
            ids.add(item.id);
            items.push(item);
          }
          items = settle(items, { yieldIds: ids });
          const last = items[items.length - 1];
          commit({ items, nextSeq: seq, paletteIndex: s.paletteIndex + 1 }, { selectedId: last.id });
        },

        updateItem(id, patch) {
          const s = get();
          const items = s.items.map((i) => {
            if (i.id !== id) return i;
            const next = { ...i };
            if (patch.name !== undefined) next.name = patch.name.trim() || i.name;
            if (patch.color !== undefined) next.color = patch.color;
            if (patch.dims) next.dims = sanitizeItemDims(patch.dims);
            if (patch.weight !== undefined) next.weight = sanitizeWeight(patch.weight);
            return next;
          });
          const geometryChanged = patch.dims !== undefined;
          commit(
            { items: geometryChanged ? settle(items, { yieldIds: new Set([id]) }) : items },
            {},
            `item:${id}:${Object.keys(patch).join(',')}`,
          );
        },

        applyItems(items, key) {
          const s = get();
          const settled = settle(items);
          const selectedId = keepSelection(settled, s.selectedId);
          // A dragged item takes the active vehicle along to wherever it was dropped.
          const follow = key === undefined ? vehicleOf(s, settled.find((i) => i.id === selectedId)) : null;
          commit({ items: settled }, { selectedId, activeVehicleId: follow ?? s.activeVehicleId }, key);
        },

        removeItem(id) {
          const s = get();
          const items = settle(s.items.filter((i) => i.id !== id));
          commit({ items }, { selectedId: s.selectedId === id ? null : s.selectedId });
        },

        duplicateItem(id) {
          const s = get();
          const source = s.items.find((i) => i.id === id);
          if (!source) return;
          const copy = placeOnDock(
            { ...source, id: uid('cargo'), seq: s.nextSeq, pos: { ...source.pos } },
            s.items,
            layoutOf(s),
            vehicleOf(s, source) ?? s.activeVehicleId,
          );
          const items = settle([...s.items, copy], { yieldIds: new Set([copy.id]) });
          commit({ items, nextSeq: s.nextSeq + 1 }, { selectedId: copy.id });
        },

        rotateItem(id, axis = 'y') {
          const s = get();
          const items = s.items.map((i) => {
            if (i.id !== id) return i;
            // About the centre of the footprint; the bottom stays where it was, gravity does the rest.
            const box = itemBox(i);
            const orientation = rotate90(i.orientation, axis);
            const size = effectiveDims(i.dims, orientation);
            const cx = (box.min.x + box.max.x) / 2;
            const cz = (box.min.z + box.max.z) / 2;
            return { ...i, orientation, pos: { x: cx - size.l / 2, y: i.pos.y, z: cz - size.w / 2 } };
          });
          commit({ items: settle(items, { yieldIds: new Set([id]) }) });
        },

        nudgeItem(id, dx, dz) {
          const s = get();
          if (!s.items.some((i) => i.id === id)) return;
          const layout = layoutOf(s);
          const session = beginMove(s.items, id, true);
          const root = session.members[0];
          const result = evaluateMove(
            session,
            { x: root.pos.x + dx, z: root.pos.z + dz },
            { floors: layout.floors, walls: layout.walls, snapThreshold: 0 },
          );
          commit({ items: finishMove(s.items, session, result.members) }, {}, `nudge:${id}`);
        },

        clearItems() {
          if (get().items.length === 0) return;
          commit({ items: [] }, { selectedId: null });
        },

        select(id) {
          const s = get();
          const activeVehicleId = vehicleOf(s, s.items.find((i) => i.id === id)) ?? s.activeVehicleId;
          if (s.selectedId !== id || s.activeVehicleId !== activeVehicleId) set({ selectedId: id, activeVehicleId });
        },

        updateBody(id, dims) {
          const s = get();
          const vehicles = mapBody(s.vehicles, id, (b) => ({ ...b, dims: clampBodyDims(dims) }));
          commit(withVehicles(s, vehicles), {}, `body:${id}`);
        },

        setBodyMaxLoad(id, maxLoad) {
          const s = get();
          const vehicles = mapBody(s.vehicles, id, (b) => {
            const { maxLoad: _, ...rest } = b;
            return maxLoad === undefined
              ? rest
              : { ...rest, maxLoad: Math.min(BODY_MAX_LOAD_LIMIT, Math.max(0, Math.round(maxLoad))) };
          });
          commit({ vehicles }, {}, `body-load:${id}`);
        },

        addTrailer(vehicleId) {
          const s = get();
          const target = s.vehicles.find((v) => v.id === (vehicleId ?? s.activeVehicleId));
          if (!target || target.bodies.length >= MAX_BODIES) return;
          const last = target.bodies[target.bodies.length - 1];
          const trailer = makeBody({
            ...DEFAULT_TRAILER,
            dims: { ...DEFAULT_TRAILER.dims, w: last.dims.w, h: last.dims.h },
          });
          commit(setBodies(s, target.id, (bodies) => [...bodies, trailer]), { activeVehicleId: target.id });
        },

        removeBody(id) {
          const s = get();
          const owner = s.vehicles.find((v) => v.bodies.some((b) => b.id === id));
          if (!owner || owner.bodies.length <= 1) return;
          commit(withVehicles(s, mapBody(s.vehicles, id, () => null), s.dockMode, owner.id));
        },

        applyVehiclePreset(presetId, vehicleId) {
          const s = get();
          const preset = VEHICLE_PRESETS.find((p) => p.id === presetId);
          const target = s.vehicles.find((v) => v.id === (vehicleId ?? s.activeVehicleId));
          if (!preset || !target) return;
          // Reuse body ids by position so cargo stays in "the first body", "the second body"...
          commit(
            setBodies(s, target.id, (bodies) => preset.bodies.map((t, i) => makeBody(t, bodies[i]?.id))),
            { activeVehicleId: target.id },
          );
        },

        addVehicle(presetId) {
          const s = get();
          if (s.vehicles.length >= MAX_VEHICLES) return null;
          const preset = VEHICLE_PRESETS.find((p) => p.id === presetId) ?? VEHICLE_PRESETS[0];
          const vehicle: Vehicle = {
            id: uid('veh'),
            name: nextVehicleName(s.vehicles),
            bodies: preset.bodies.map((b) => makeBody(b)),
          };
          commit(withVehicles(s, [...s.vehicles, vehicle]), { activeVehicleId: vehicle.id });
          return vehicle.id;
        },

        removeVehicle(id) {
          const s = get();
          const index = s.vehicles.findIndex((v) => v.id === id);
          if (index < 0 || s.vehicles.length <= 1) return;
          const vehicles = s.vehicles.filter((v) => v.id !== id);
          const active = s.activeVehicleId === id ? vehicles[Math.max(0, index - 1)].id : s.activeVehicleId;
          commit(withVehicles(s, vehicles, s.dockMode, active), { activeVehicleId: active });
        },

        renameVehicle(id, name) {
          const s = get();
          const clean = name.trim().slice(0, 100);
          if (!clean) return;
          const vehicles = s.vehicles.map((v) => (v.id === id && v.name !== clean ? { ...v, name: clean } : v));
          if (vehicles.every((v, i) => v === s.vehicles[i])) return;
          commit({ vehicles }, {}, `vehicle-name:${id}`);
        },

        setDockMode(mode) {
          const s = get();
          if (s.dockMode === mode) return;
          commit(withVehicles(s, s.vehicles, mode));
        },

        setActiveVehicle(id) {
          const s = get();
          if (s.activeVehicleId !== id && s.vehicles.some((v) => v.id === id)) set({ activeVehicleId: id });
        },

        setSetting(key, value) {
          set({ settings: { ...get().settings, [key]: value } });
        },

        undo() {
          const s = get();
          const prev = s.history.past[s.history.past.length - 1];
          if (!prev) return;
          set({
            ...prev,
            selectedId: keepSelection(prev.items, s.selectedId),
            activeVehicleId: keepActive(prev.vehicles, s.activeVehicleId),
            history: {
              past: s.history.past.slice(0, -1),
              future: [pickPlan(s), ...s.history.future],
              lastKey: null,
              lastAt: 0,
            },
          });
        },

        redo() {
          const s = get();
          const next = s.history.future[0];
          if (!next) return;
          set({
            ...next,
            selectedId: keepSelection(next.items, s.selectedId),
            activeVehicleId: keepActive(next.vehicles, s.activeVehicleId),
            history: {
              past: [...s.history.past, pickPlan(s)],
              future: s.history.future.slice(1),
              lastKey: null,
              lastAt: 0,
            },
          });
        },

        loadPlan(raw) {
          const plan = parsePlan(raw);
          if (!plan) throw new Error('Файл не похож на план загрузки');
          const items = settle(plan.items);
          const nextSeq = Math.max(plan.nextSeq || 1, ...items.map((i) => i.seq + 1));
          commit(
            { vehicles: plan.vehicles, dockMode: plan.dockMode, items, nextSeq },
            { selectedId: null, activeVehicleId: plan.vehicles[0].id },
          );
        },

        openPlan(raw) {
          const plan = parsePlan(raw);
          if (!plan) throw new Error('Схема повреждена');
          const items = settle(plan.items);
          set({
            vehicles: plan.vehicles,
            dockMode: plan.dockMode,
            items,
            nextSeq: Math.max(plan.nextSeq || 1, ...items.map((i) => i.seq + 1)),
            paletteIndex: items.length,
            selectedId: null,
            activeVehicleId: plan.vehicles[0].id,
            history: { past: [], future: [], lastKey: null, lastAt: 0 },
          });
        },
      };
    },
    {
      // Plans live on the server; only display preferences stay in the browser.
      // (The pre-accounts plan is still under LEGACY_PLAN_KEY until the user imports it.)
      name: 'loader3d:settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ settings: s.settings }),
      merge: (persisted, current) => {
        const settings = (persisted as Partial<AppState> | undefined)?.settings;
        return { ...current, settings: { ...DEFAULT_SETTINGS, ...settings } };
      },
    },
  ),
);

/** localStorage key of the plan saved by the app before accounts existed. */
export const LEGACY_PLAN_KEY = 'loader3d:plan';

export function exportPlan(s: AppState): Plan {
  return { vehicles: s.vehicles, dockMode: s.dockMode, items: s.items, nextSeq: s.nextSeq };
}

/** The active vehicle (always exists: a plan has at least one). */
export function activeVehicle(s: Pick<AppState, 'vehicles' | 'activeVehicleId'>): Vehicle {
  return s.vehicles.find((v) => v.id === s.activeVehicleId) ?? s.vehicles[0];
}
