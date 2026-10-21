import type { Box, CargoBody, CargoItem, DockMode, Rect, Vehicle } from './types';
import { boxCenter, inRects, intersection, rectOf, unionBoxes, volume } from './geometry';
import { itemBox } from './item';

/** Distance between consecutive cargo bodies of a road train. */
export const COUPLING_GAP = 110;
/** Gap between the first cargo body and the cab. */
export const CAB_GAP = 40;
export const CAB_LENGTH = 230;
export const CAB_WIDTH = 250;
/** Deck height above the yard; the dock platform is level with the deck. */
export const DECK_HEIGHT = 120;
export const DOCK_DEPTH = 900;
export const DOCK_WIDTH = 1300;
/** Free aisle between the rear doors and the staging rows on the dock. */
export const DOCK_AISLE = 70;
/**
 * Distance between the centrelines of neighbouring vehicles. At a shared dock they stand close
 * (any body up to 4 m wide still has a gap); with their own docks the platforms do not touch.
 */
export const LANE_SPACING: Record<DockMode, number> = { shared: 520, own: DOCK_WIDTH + 300 };

export interface PlacedBody {
  body: CargoBody;
  /** Index within its vehicle: 0 is right behind the cab. */
  index: number;
  vehicleId: string;
  box: Box;
}

export interface PlacedVehicle {
  vehicle: Vehicle;
  index: number;
  /** Z of the centreline. */
  lane: number;
  /** Same order as `vehicle.bodies`. */
  bodies: PlacedBody[];
  /** X of the front wall of the first body. */
  front: number;
  /** The dock the vehicle is loaded from: its own or the shared one. */
  dock: Rect;
}

export interface VehicleLayout {
  dockMode: DockMode;
  vehicles: PlacedVehicle[];
  /** Every body of every vehicle (vehicle order, then from the cab back). */
  bodies: PlacedBody[];
  /** Staging platforms behind the rear doors: the shared one, or one per vehicle. */
  docks: Rect[];
  /** Everything an item may stand on: the docks and every body's deck. */
  floors: Rect[];
  /** Body boxes — snap targets for cargo. */
  walls: Box[];
}

/**
 * Vehicles are parked side by side along Z with their rear doors at X = 0, the first one on Z = 0.
 * Within a vehicle the bodies are laid out along X from the dock: the last body is at the doors,
 * the first one (behind the cab) is the furthest. The docks occupy X < 0.
 */
export function computeLayout(vehicles: readonly Vehicle[], dockMode: DockMode = 'shared'): VehicleLayout {
  const spacing = LANE_SPACING[dockMode];
  const placed: PlacedVehicle[] = vehicles.map((vehicle, index) => {
    const lane = index * spacing;
    const bodies: PlacedBody[] = new Array(vehicle.bodies.length);
    let x = 0;
    for (let i = vehicle.bodies.length - 1; i >= 0; i--) {
      const body = vehicle.bodies[i];
      const { l, w, h } = body.dims;
      bodies[i] = {
        body,
        index: i,
        vehicleId: vehicle.id,
        box: { min: { x, y: 0, z: lane - w / 2 }, max: { x: x + l, y: h, z: lane + w / 2 } },
      };
      x += l + COUPLING_GAP;
    }
    const front = bodies.length ? bodies[0].box.max.x : 0;
    return { vehicle, index, lane, bodies, front, dock: dockRect(lane, lane) };
  });

  const lastLane = Math.max(0, (vehicles.length - 1) * spacing);
  const docks = dockMode === 'own' && placed.length > 0 ? placed.map((pv) => pv.dock) : [dockRect(0, lastLane)];
  if (dockMode === 'shared') for (const pv of placed) pv.dock = docks[0];

  const bodies = placed.flatMap((pv) => pv.bodies);
  return {
    dockMode,
    vehicles: placed,
    bodies,
    docks,
    floors: [...docks, ...bodies.map((pb) => rectOf(pb.box))],
    walls: bodies.map((pb) => pb.box),
  };
}

function dockRect(firstLane: number, lastLane: number): Rect {
  return { minX: -DOCK_DEPTH, maxX: 0, minZ: firstLane - DOCK_WIDTH / 2, maxZ: lastLane + DOCK_WIDTH / 2 };
}

export function findVehicle(layout: VehicleLayout, id: string | null | undefined): PlacedVehicle | null {
  return layout.vehicles.find((pv) => pv.vehicle.id === id) ?? null;
}

/** Margins of the staging area: off the edges and clear of the aisle along the rear doors. */
function staging(d: Rect, minZ = d.minZ, maxZ = d.maxZ): Rect {
  return { minX: d.minX + 30, maxX: d.maxX - DOCK_AISLE, minZ: minZ + 30, maxZ: maxZ - 30 };
}

/**
 * Where new or unloaded cargo of a vehicle is put, in order of preference: its own dock, or on a
 * shared dock first the stretch behind the vehicle, then anywhere on the dock.
 */
export function stagingRegions(layout: VehicleLayout, vehicleId?: string | null): Rect[] {
  const pv = findVehicle(layout, vehicleId) ?? layout.vehicles[0];
  if (!pv) return layout.docks.map((d) => staging(d));
  const d = pv.dock;
  if (layout.dockMode === 'own' || layout.vehicles.length === 1) return [staging(d)];
  const half = LANE_SPACING.shared / 2;
  const minZ = pv.index > 0 ? pv.lane - half : d.minZ;
  const maxZ = pv.index < layout.vehicles.length - 1 ? pv.lane + half : d.maxZ;
  return [staging(d, minZ, maxZ), staging(d)];
}

/** Part of the dock where new or unloaded cargo is put (the first of {@link stagingRegions}). */
export function stagingRegion(layout: VehicleLayout, vehicleId?: string | null): Rect {
  return stagingRegions(layout, vehicleId)[0];
}

/** Bounding box of one vehicle including the cab (camera framing, reports). */
export function vehicleBounds(pv: PlacedVehicle): Box {
  const union = unionBoxes(pv.bodies.map((pb) => pb.box)) ?? {
    min: { x: 0, y: 0, z: pv.lane },
    max: { x: 0, y: 0, z: pv.lane },
  };
  const halfWidth = Math.max(union.max.z - pv.lane, CAB_WIDTH / 2);
  return {
    min: { ...union.min, z: pv.lane - halfWidth },
    max: { ...union.max, x: pv.front + CAB_GAP + CAB_LENGTH, z: pv.lane + halfWidth },
  };
}

/** Every vehicle and dock (camera framing, shadows). */
export function layoutBounds(layout: VehicleLayout): Box {
  const boxes = layout.vehicles.map(vehicleBounds);
  for (const d of layout.docks) boxes.push({ min: { x: d.minX, y: 0, z: d.minZ }, max: { x: d.maxX, y: 0, z: d.maxZ } });
  return unionBoxes(boxes) ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
}

/** The body that contains the largest part of `box`, if any. */
export function bodyAt(box: Box, layout: VehicleLayout): PlacedBody | null {
  let best: PlacedBody | null = null;
  let bestVolume = 1; // cm³ — ignore numerical slivers
  for (const pb of layout.bodies) {
    const v = volume(intersection(box, pb.box));
    if (v > bestVolume) {
      bestVolume = v;
      best = pb;
    }
  }
  return best;
}

/** Index in `layout.docks` of the dock under the centre of `box` (the nearest one if none). */
export function dockIndexAt(box: Box, layout: VehicleLayout): number {
  const c = boxCenter(box);
  let best = 0;
  let bestDist = Infinity;
  layout.docks.forEach((d, i) => {
    const dx = Math.max(d.minX - c.x, 0, c.x - d.maxX);
    const dz = Math.max(d.minZ - c.z, 0, c.z - d.maxZ);
    const dist = dx * dx + dz * dz;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

/** The vehicle whose lane is closest to the centre of `box`. */
export function nearestVehicle(box: Box, layout: VehicleLayout): PlacedVehicle | null {
  const z = boxCenter(box).z;
  let best: PlacedVehicle | null = null;
  for (const pv of layout.vehicles) {
    if (!best || Math.abs(pv.lane - z) < Math.abs(best.lane - z)) best = pv;
  }
  return best;
}

/**
 * The vehicle an item belongs to: the one whose body it is in, or whose own dock it stands on.
 * Cargo on a shared dock belongs to no vehicle.
 */
export function ownerVehicle(box: Box, layout: VehicleLayout): PlacedVehicle | null {
  const pb = bodyAt(box, layout);
  if (pb) return findVehicle(layout, pb.vehicleId);
  if (layout.dockMode !== 'own') return null;
  return layout.vehicles[dockIndexAt(box, layout)] ?? null;
}

/** True when the centre of `box` is over something cargo can stand on. */
export function onFloor(box: Box, layout: VehicleLayout): boolean {
  const c = boxCenter(box);
  return inRects(c.x, c.z, layout.floors);
}

/**
 * Keeps cargo attached to its place when the vehicles change (resize, trailer or vehicle added or
 * removed, dock mode switched). Items in a body keep their position relative to its front wall and
 * centreline, as trucks are loaded from the front; items on a dock follow their vehicle's lane
 * (a shared dock does not move). Items whose body or dock disappeared are returned as orphans.
 */
export function remapItems(
  items: readonly CargoItem[],
  from: VehicleLayout,
  to: VehicleLayout,
): { items: CargoItem[]; orphans: string[] } {
  const orphans: string[] = [];
  const lanes = new Map(to.vehicles.map((pv) => [pv.vehicle.id, pv.lane]));
  const next = items.map((item) => {
    const box = itemBox(item);
    const old = bodyAt(box, from);
    let dx = 0;
    let dz = 0;
    if (old) {
      const target = to.bodies.find((pb) => pb.body.id === old.body.id);
      if (!target) {
        orphans.push(item.id);
        return item;
      }
      dx = target.box.max.x - old.box.max.x;
      dz = (target.box.min.z + target.box.max.z) / 2 - (old.box.min.z + old.box.max.z) / 2;
    } else if (from.dockMode === 'own' || to.dockMode === 'own') {
      // Dock cargo moves with its vehicle: from its own dock, or from the stretch of the shared one behind it.
      const anchor = from.dockMode === 'own' ? from.vehicles[dockIndexAt(box, from)] : nearestVehicle(box, from);
      const lane = anchor ? lanes.get(anchor.vehicle.id) : undefined;
      if (anchor && lane === undefined && from.dockMode === 'own') {
        orphans.push(item.id);
        return item;
      }
      if (anchor && lane !== undefined) dz = lane - anchor.lane;
    }
    return dx === 0 && dz === 0 ? item : { ...item, pos: { ...item.pos, x: item.pos.x + dx, z: item.pos.z + dz } };
  });
  return { items: next, orphans };
}
