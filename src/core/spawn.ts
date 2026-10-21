import type { Box, Dims, Rect } from './types';
import { EPS, overlapsXZ } from './geometry';
import { stagingRegions, type VehicleLayout } from './layout';

/**
 * A floor spot on the dock of a vehicle for new or unloaded cargo (see {@link stagingRegions}).
 * When the dock is full, the corner by the doors: the gravity pass then puts the item on top.
 */
export function dockSpot(
  size: Dims,
  layout: VehicleLayout,
  vehicleId: string | null | undefined,
  occupied: readonly Box[],
): { x: number; z: number } {
  const regions = stagingRegions(layout, vehicleId);
  for (const region of regions) {
    const spot = findFreeSpot(size, region, occupied);
    if (spot) return spot;
  }
  return { x: regions[0].maxX - size.l, z: regions[0].minZ };
}

/**
 * First free floor spot for a new item inside `region`, filling rows from the region's max X
 * (the truck's rear doors) outwards, left to right. Candidates are "extreme points" next to the
 * already occupied boxes, so items line up neatly with `gap` between them.
 */
export function findFreeSpot(
  size: Dims,
  region: Rect,
  occupied: readonly Box[],
  gap = 10,
): { x: number; z: number } | null {
  const xs = new Set<number>([region.maxX - size.l]);
  const zs = new Set<number>([region.minZ]);
  for (const o of occupied) {
    xs.add(o.min.x - gap - size.l);
    xs.add(o.max.x - size.l);
    zs.add(o.max.z + gap);
    zs.add(o.min.z);
  }
  const xList = [...xs]
    .filter((x) => x >= region.minX - EPS && x + size.l <= region.maxX + EPS)
    .sort((a, b) => b - a);
  const zList = [...zs]
    .filter((z) => z >= region.minZ - EPS && z + size.w <= region.maxZ + EPS)
    .sort((a, b) => a - b);

  for (const x of xList) {
    for (const z of zList) {
      const fp: Box = { min: { x, y: 0, z }, max: { x: x + size.l, y: size.h, z: z + size.w } };
      if (!occupied.some((o) => overlapsXZ(fp, o))) return { x, z };
    }
  }
  return null;
}
