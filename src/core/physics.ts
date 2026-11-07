import type { Box, CargoItem } from './types';
import { EPS, overlaps, overlapsXZ } from './geometry';
import { itemBox } from './item';

/** Vertical tolerance (cm) for deciding that one box rests on another. */
export const CONTACT_TOLERANCE = 0.05;

/**
 * Height at which a box with this footprint comes to rest: the highest top among obstacles under
 * (or above) the footprint, or the floor. Placing a box there can never intersect an obstacle and
 * never leaves it hanging in the air.
 */
export function supportHeight(footprint: Box, obstacles: readonly Box[]): number {
  let y = 0;
  for (const o of obstacles) {
    if (o.max.y > y && overlapsXZ(footprint, o)) y = o.max.y;
  }
  return y;
}

/**
 * Every base Y at which a rigid group can rest without intersecting an obstacle, ascending: on the
 * floor or with a member on top of an obstacle. `members` are positioned in XZ, their Y is relative
 * to the group base. The highest level is on top of everything under (or above) the footprint, as in
 * {@link supportHeight}; lower ones are gaps under overhanging cargo (a "bridge" over two stacks).
 */
export function restingLevels(members: readonly Box[], obstacles: readonly Box[]): number[] {
  const pairs: Array<[Box, Box]> = [];
  for (const m of members) {
    for (const o of obstacles) if (overlapsXZ(m, o)) pairs.push([m, o]);
  }
  const candidates = [0];
  for (const [m, o] of pairs) {
    const y = o.max.y - m.min.y;
    if (y > 0) candidates.push(y);
  }
  candidates.sort((a, b) => a - b);

  const levels: number[] = [];
  for (const y of candidates) {
    if (levels.length > 0 && y - levels[levels.length - 1] < EPS) continue;
    const free = pairs.every(([m, o]) => y + m.max.y <= o.min.y + EPS || y + m.min.y >= o.max.y - EPS);
    if (free) levels.push(y);
  }
  return levels;
}

export interface SettleOptions {
  /** Items that give way to others resting at the same level (e.g. one that was just rotated). */
  yieldIds?: ReadonlySet<string>;
  /** Items placed after everything else, on top of whatever is under them (e.g. a dropped stack). */
  topIds?: ReadonlySet<string>;
}

/**
 * Gravity pass: drops every item onto the floor or onto the items under it, bottom-up.
 * The result never has intersections or floating items, whatever the input was. Order of the
 * returned array matches the input; unchanged items keep their identity.
 */
export function settle(items: readonly CargoItem[], options: SettleOptions = {}): CargoItem[] {
  const { yieldIds, topIds } = options;
  const level = (y: number) => Math.round(y / EPS);
  const order = items.map((item, index) => {
    const box = itemBox(item);
    return {
      item,
      index,
      box,
      level: level(box.min.y),
      top: topIds?.has(item.id) ? 1 : 0,
      yields: yieldIds?.has(item.id) ? 1 : 0,
    };
  });
  order.sort(
    (a, b) => a.top - b.top || a.level - b.level || a.yields - b.yields || a.index - b.index,
  );

  const placed: Box[] = [];
  const out = items.slice();
  for (const { item, index, box } of order) {
    const y = supportHeight(box, placed);
    const h = box.max.y - box.min.y;
    placed.push({ min: { ...box.min, y }, max: { ...box.max, y: y + h } });
    if (Math.abs(item.pos.y - y) > 1e-9) out[index] = { ...item, pos: { ...item.pos, y } };
  }
  return out;
}

/** Ids of the items `item` directly rests on. */
function supportersOf(box: Box, id: string, all: ReadonlyArray<{ id: string; box: Box }>): string[] {
  if (box.min.y < CONTACT_TOLERANCE) return [];
  const result: string[] = [];
  for (const other of all) {
    if (other.id === id) continue;
    if (Math.abs(other.box.max.y - box.min.y) < CONTACT_TOLERANCE && overlapsXZ(box, other.box)) {
      result.push(other.id);
    }
  }
  return result;
}

/**
 * The item plus everything that rests on it — directly or indirectly — and on nothing else.
 * Picking up a box carries this stack along.
 */
export function collectStack(rootId: string, items: readonly CargoItem[]): Set<string> {
  const all = items.map((i) => ({ id: i.id, box: itemBox(i) }));
  const supporters = new Map<string, string[]>();
  for (const entry of all) supporters.set(entry.id, supportersOf(entry.box, entry.id, all));

  const group = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, sup] of supporters) {
      if (group.has(id) || sup.length === 0) continue;
      if (sup.every((s) => group.has(s))) {
        group.add(id);
        changed = true;
      }
    }
  }
  return group;
}

/**
 * Items that must stay where they are: the locked ones and everything they rest on, directly or
 * through other items (moving a support would drop a locked item). Gravity never moves them either:
 * their supports stay.
 */
export function pinnedIds(items: readonly CargoItem[]): Set<string> {
  const pinned = new Set<string>();
  if (!items.some((i) => i.locked)) return pinned;
  const all = items.map((i) => ({ id: i.id, box: itemBox(i) }));
  const byId = new Map(all.map((e) => [e.id, e]));
  const queue = items.filter((i) => i.locked).map((i) => i.id);
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (pinned.has(id)) continue;
    pinned.add(id);
    for (const s of supportersOf(byId.get(id)!.box, id, all)) if (!pinned.has(s)) queue.push(s);
  }
  return pinned;
}

/** Pairs of intersecting items (diagnostics and tests). */
export function findCollisions(items: readonly CargoItem[]): Array<[string, string]> {
  const boxes = items.map(itemBox);
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlaps(boxes[i], boxes[j])) pairs.push([items[i].id, items[j].id]);
    }
  }
  return pairs;
}

/** Items that neither stand on the floor nor rest on another item (diagnostics and tests). */
export function findFloating(items: readonly CargoItem[]): string[] {
  const all = items.map((i) => ({ id: i.id, box: itemBox(i) }));
  return all
    .filter((e) => e.box.min.y >= CONTACT_TOLERANCE && supportersOf(e.box, e.id, all).length === 0)
    .map((e) => e.id);
}
