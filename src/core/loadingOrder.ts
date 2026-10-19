import type { Box, CargoItem } from './types';
import { EPS, overlap1D, overlapsXZ } from './geometry';
import { itemBox } from './item';
import type { VehicleLayout } from './layout';
import { CONTACT_TOLERANCE } from './physics';
import { classify } from './stats';

/** Where the cargo goes in: through the rear doors, from a side (tent curtains) or from above (crane). */
export type LoadDirection = 'rear' | 'right' | 'left' | 'top';

export interface LoadingStep {
  bodyId: string;
  /** In loading order. */
  itemIds: string[];
}

export const MAX_ITEMS_PER_STEP = 6;

/**
 * Loading instructions: the cargo of every body (bodies in layout order, the dock is not part of the
 * plan) in an order it can be put in from `direction` — see {@link loadingOrder}. Consecutive items
 * of one row (rear: the same stretch of length, sides: of width, top: the same layer) make one step
 * of at most `maxPerStep` items.
 */
export function loadingSteps(
  items: readonly CargoItem[],
  layout: VehicleLayout,
  direction: LoadDirection,
  maxPerStep = MAX_ITEMS_PER_STEP,
): LoadingStep[] {
  const perBody = new Map<string, CargoItem[]>();
  for (const item of items) {
    const pb = classify(itemBox(item), layout).body;
    if (!pb) continue;
    const list = perBody.get(pb.body.id) ?? [];
    list.push(item);
    perBody.set(pb.body.id, list);
  }

  const steps: LoadingStep[] = [];
  for (const pb of layout.bodies) {
    let step: LoadingStep | null = null;
    let row: [number, number] = [0, 0];
    for (const item of loadingOrder(perBody.get(pb.body.id) ?? [], direction)) {
      const range = depthRange(itemBox(item), direction);
      if (!step || step.itemIds.length >= maxPerStep || overlap1D(row[0], row[1], range[0], range[1]) <= EPS) {
        step = { bodyId: pb.body.id, itemIds: [] };
        steps.push(step);
        row = range;
      }
      step.itemIds.push(item.id);
    }
  }
  return steps;
}

/**
 * Items of one body in an order they can be loaded from `direction`: an item comes after the items
 * it stands on and after the items it would block on the way in (further from the opening in its
 * lane). Among the items that can go next: furthest from the opening first, then bottom first.
 */
export function loadingOrder(items: readonly CargoItem[], direction: LoadDirection): CargoItem[] {
  const nodes = items.map((item) => ({ item, box: itemBox(item), waits: 0, then: [] as number[], done: false }));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = 0; j < nodes.length; j++) {
      if (i !== j && mustPrecede(nodes[i].box, nodes[j].box, direction)) {
        nodes[i].then.push(j);
        nodes[j].waits++;
      }
    }
  }
  const keys = nodes.map((n) => priority(n.box, direction).concat(n.item.seq));
  const byPriority = nodes.map((_, i) => i).sort((a, b) => compareKeys(keys[a], keys[b]));

  const out: CargoItem[] = [];
  while (out.length < nodes.length) {
    // A dependency cycle is only possible in contrived layouts: break it by priority.
    const next =
      byPriority.find((i) => !nodes[i].done && nodes[i].waits === 0) ?? byPriority.find((i) => !nodes[i].done)!;
    const node = nodes[next];
    node.done = true;
    out.push(node.item);
    for (const j of node.then) nodes[j].waits--;
  }
  return out;
}

/** `a` has to be in place before `b`: `b` stands on it, or `b` would block the way to it. */
function mustPrecede(a: Box, b: Box, direction: LoadDirection): boolean {
  if (Math.abs(a.max.y - b.min.y) <= CONTACT_TOLERANCE && overlapsXZ(a, b)) return true;
  const ys = overlap1D(a.min.y, a.max.y, b.min.y, b.max.y) > EPS;
  switch (direction) {
    case 'rear': // rear doors at min X of the body
      return a.min.x >= b.max.x - EPS && ys && overlap1D(a.min.z, a.max.z, b.min.z, b.max.z) > EPS;
    case 'right': // +Z is the right-hand side in the driving direction
      return a.max.z <= b.min.z + EPS && ys && overlap1D(a.min.x, a.max.x, b.min.x, b.max.x) > EPS;
    case 'left':
      return a.min.z >= b.max.z - EPS && ys && overlap1D(a.min.x, a.max.x, b.min.x, b.max.x) > EPS;
    case 'top':
      return false;
  }
}

/** Smaller goes first: furthest from the opening, then lower, then from the front wall / left. */
function priority(b: Box, direction: LoadDirection): number[] {
  switch (direction) {
    case 'rear':
      return [-b.max.x, b.min.y, b.min.z];
    case 'right':
      return [b.min.z, -b.max.x, b.min.y];
    case 'left':
      return [-b.max.z, -b.max.x, b.min.y];
    case 'top':
      return [b.min.y, -b.max.x, b.min.z];
  }
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    if (Math.abs(d) > EPS) return d;
  }
  return 0;
}

/** Interval along the axis the cargo advances in: rows of a step overlap on it. */
function depthRange(b: Box, direction: LoadDirection): [number, number] {
  if (direction === 'rear') return [b.min.x, b.max.x];
  if (direction === 'top') return [b.min.y, b.max.y];
  return [b.min.z, b.max.z];
}
