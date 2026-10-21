import type { Box, CargoBody, CargoItem, DockMode, Plan, Vehicle } from './types';
import { overlapsXZ } from './geometry';
import { itemBox, itemSize } from './item';
import {
  bodyAt,
  computeLayout,
  dockIndexAt,
  findVehicle,
  nearestVehicle,
  onFloor,
  ownerVehicle,
  remapItems,
  type VehicleLayout,
} from './layout';
import { CONTACT_TOLERANCE, settle } from './physics';
import { dockSpot } from './spawn';

/** Id and name given to the vehicle of a plan saved before there could be several. */
export const LEGACY_VEHICLE_ID = 'veh-1';

export function defaultVehicleName(index: number): string {
  return `Машина ${index + 1}`;
}

/** «Машина N» with the first N not taken by another vehicle. */
export function nextVehicleName(vehicles: readonly Vehicle[]): string {
  const names = new Set(vehicles.map((v) => v.name));
  let index = vehicles.length;
  while (names.has(defaultVehicleName(index))) index++;
  return defaultVehicleName(index);
}

export function planBodies(plan: Pick<Plan, 'vehicles'>): CargoBody[] {
  return plan.vehicles.flatMap((v) => v.bodies);
}

function isBody(b: unknown): b is CargoBody {
  const body = b as CargoBody | null;
  return !!body && typeof body.id === 'string' && !!body.dims && body.dims.l > 0;
}

function isItem(i: unknown): i is CargoItem {
  const item = i as CargoItem | null;
  return !!item && typeof item.id === 'string' && !!item.dims && !!item.pos && !!item.orientation;
}

/**
 * Checks the shape of a plan from a file, the server or old local storage and brings it to the
 * current format: plans from before several vehicles have `bodies` instead of `vehicles`.
 */
export function parsePlan(raw: unknown): Plan | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const source: unknown[] | null = Array.isArray(p.vehicles)
    ? p.vehicles
    : Array.isArray(p.bodies)
      ? [{ id: LEGACY_VEHICLE_ID, name: defaultVehicleName(0), bodies: p.bodies }]
      : null;
  if (!source || source.length === 0 || !Array.isArray(p.items) || !p.items.every(isItem)) return null;
  const vehicles: Vehicle[] = [];
  for (const [index, entry] of source.entries()) {
    const v = entry as Partial<Vehicle> | null;
    if (!v || typeof v.id !== 'string' || !Array.isArray(v.bodies) || v.bodies.length === 0 || !v.bodies.every(isBody)) {
      return null;
    }
    vehicles.push({ id: v.id, name: typeof v.name === 'string' && v.name.trim() ? v.name : defaultVehicleName(index), bodies: v.bodies });
  }
  const dockMode: DockMode = p.dockMode === 'own' ? 'own' : 'shared';
  return { vehicles, dockMode, items: p.items, nextSeq: typeof p.nextSeq === 'number' ? p.nextSeq : 1 };
}

/**
 * Moves cargo along with the vehicles after they changed (see {@link remapItems}). Cargo whose body
 * or dock is gone, that is now off every floor, or that would overlap other cargo where two docks
 * became one, goes to a free spot on the dock of its vehicle (or of `fallbackVehicleId`).
 * Ends with settle().
 */
export function relayout(
  items: readonly CargoItem[],
  from: VehicleLayout,
  to: VehicleLayout,
  fallbackVehicleId?: string | null,
): CargoItem[] {
  const { items: remapped, orphans } = remapItems(items, from, to);
  const homeless = new Set(orphans);
  const floorLevel: Box[] = [];
  for (const item of remapped) {
    if (homeless.has(item.id)) continue;
    const box = itemBox(item);
    if (!onFloor(box, to)) {
      homeless.add(item.id);
      continue;
    }
    if (box.min.y > CONTACT_TOLERANCE || bodyAt(box, to)) continue;
    if (floorLevel.some((b) => overlapsXZ(b, box))) homeless.add(item.id);
    else floorLevel.push(box);
  }
  if (homeless.size === 0) return settle(remapped);

  const original = new Map(items.map((i) => [i.id, i]));
  const occupied = remapped.filter((i) => !homeless.has(i.id)).map(itemBox);
  const moved = new Map<string, CargoItem>();
  for (const item of remapped) {
    if (!homeless.has(item.id)) continue;
    const before = itemBox(original.get(item.id)!);
    const home = ownerVehicle(before, from) ?? nearestVehicle(before, from);
    const vehicleId = home && findVehicle(to, home.vehicle.id) ? home.vehicle.id : fallbackVehicleId;
    const size = itemSize(item);
    const spot = dockSpot(size, to, vehicleId, occupied);
    const next = { ...item, pos: { x: spot.x, y: 0, z: spot.z } };
    occupied.push(itemBox(next));
    moved.set(item.id, next);
  }
  return settle(
    remapped.map((i) => moved.get(i.id) ?? i),
    { yieldIds: homeless },
  );
}

/**
 * One vehicle of the plan on its own, moved to Z = 0 (reports): the cargo in its bodies, and the
 * cargo on its dock when that dock is its own (a shared dock belongs to no vehicle).
 */
export function vehiclePlan(plan: Plan, vehicleId: string): Plan {
  const layout = computeLayout(plan.vehicles, plan.dockMode);
  const pv = findVehicle(layout, vehicleId) ?? layout.vehicles[0];
  const single = plan.vehicles.length === 1;
  const items = plan.items
    .filter((item) => {
      const box = itemBox(item);
      const pb = bodyAt(box, layout);
      if (pb) return pb.vehicleId === pv.vehicle.id;
      return single || (plan.dockMode === 'own' && layout.vehicles[dockIndexAt(box, layout)] === pv);
    })
    .map((item) => (pv.lane === 0 ? item : { ...item, pos: { ...item.pos, z: item.pos.z - pv.lane } }));
  return { vehicles: [pv.vehicle], dockMode: plan.dockMode, items, nextSeq: plan.nextSeq };
}
