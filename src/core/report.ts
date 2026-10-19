import type { CargoItem, Dims } from './types';
import { intersection } from './geometry';
import { itemBox } from './item';
import type { VehicleLayout } from './layout';
import { classify, computeStats, type BodyStats, type PlacementStatus } from './stats';

/** What a printed report says about one cargo body: used vs. available, per parameter. */
export interface BodySummary extends BodyStats {
  /** Internal dimensions of the body, cm. */
  dims: Dims;
  /** cm² of the deck under items standing on it. */
  floorUsed: number;
  floorCapacity: number;
  /** Extent of the cargo inside the body, cm: length from the front wall, width across, height. */
  length: number;
  width: number;
  height: number;
}

export interface LoadSummary {
  bodies: BodySummary[];
  /** Items left on the dock and their weight, kg. */
  dock: number;
  dockWeight: number;
  /** Items sticking out of their body. */
  overflow: number;
}

/**
 * Report figures for every body. Everything is measured on the part of the cargo inside the body,
 * so items sticking out (reported separately) never push "used" above the capacity.
 */
export function summarizeLoad(items: readonly CargoItem[], layout: VehicleLayout): LoadSummary {
  const stats = computeStats(items, layout);
  const extents = new Map(
    layout.bodies.map((pb) => [pb.body.id, { floor: 0, minZ: Infinity, maxZ: -Infinity, top: 0 }]),
  );
  for (const item of items) {
    const box = itemBox(item);
    const placement = classify(box, layout);
    if (!placement.body) continue;
    const part = intersection(box, placement.body.box);
    const e = extents.get(placement.body.body.id);
    if (!part || !e) continue;
    if (part.min.y <= placement.body.box.min.y + 0.05) {
      e.floor += (part.max.x - part.min.x) * (part.max.z - part.min.z);
    }
    e.minZ = Math.min(e.minZ, part.min.z);
    e.maxZ = Math.max(e.maxZ, part.max.z);
    e.top = Math.max(e.top, part.max.y - placement.body.box.min.y);
  }
  const bodies = layout.bodies.map((pb, i): BodySummary => {
    const e = extents.get(pb.body.id)!;
    const { dims } = pb.body;
    return {
      ...stats.bodies[i],
      dims,
      floorUsed: e.floor,
      floorCapacity: dims.l * dims.w,
      length: stats.bodies[i].ldm * 100,
      width: e.maxZ > e.minZ ? e.maxZ - e.minZ : 0,
      height: e.top,
    };
  });
  return { bodies, dock: stats.dock, dockWeight: stats.dockWeight, overflow: stats.overflow };
}

/** One line of the cargo list: identical items in the same place are counted together. */
export interface CargoRow {
  seqs: number[];
  name: string;
  color: string;
  /** Own dimensions (independent of rotation). */
  dims: Dims;
  /** kg per item, undefined when not set. */
  weight: number | undefined;
  count: number;
  status: PlacementStatus;
  /** Body the items are in (null: on the dock). */
  bodyId: string | null;
}

/** Cargo list for a report: grouped by place (bodies in layout order, then the dock), then by number. */
export function cargoRows(items: readonly CargoItem[], layout: VehicleLayout): CargoRow[] {
  const rows = new Map<string, CargoRow>();
  const sorted = [...items].sort((a, b) => a.seq - b.seq);
  for (const item of sorted) {
    const placement = classify(itemBox(item), layout);
    const bodyId = placement.body?.body.id ?? null;
    const { l, w, h } = item.dims;
    const key = [item.name, item.color, l, w, h, item.weight ?? '', placement.status, bodyId].join('|');
    const row = rows.get(key);
    if (row) {
      row.seqs.push(item.seq);
      row.count++;
    } else {
      rows.set(key, {
        seqs: [item.seq],
        name: item.name,
        color: item.color,
        dims: item.dims,
        weight: item.weight,
        count: 1,
        status: placement.status,
        bodyId,
      });
    }
  }
  const place = (row: CargoRow) => {
    const index = layout.bodies.findIndex((pb) => pb.body.id === row.bodyId);
    return index < 0 ? layout.bodies.length : index;
  };
  return [...rows.values()].sort((a, b) => place(a) - place(b) || a.seqs[0] - b.seqs[0]);
}

/** «1–3, 5, 8–9» for [1, 2, 3, 5, 8, 9]. */
export function formatSeqList(seqs: readonly number[]): string {
  const sorted = [...new Set(seqs)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++;
    const end = sorted[i];
    parts.push(end === start ? `${start}` : end === start + 1 ? `${start}, ${end}` : `${start}–${end}`);
  }
  return parts.join(', ');
}
