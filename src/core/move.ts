import type { Box, CargoItem, Rect, Vec3 } from './types';
import { EPS, boxCenter, clampToRects, inRects, translateBox, unionBoxes } from './geometry';
import { itemBox } from './item';
import { collectStack, restingLevels, settle } from './physics';
import { snapFootprint, type SnapGuide } from './snapping';

/**
 * Moving cargo: the picked item and the stack resting on it move as one rigid group.
 * Everything else is settled once at the start, so the session can evaluate positions cheaply
 * on every pointer move.
 */
export interface MoveSession {
  rootId: string;
  /** Original members, root first. */
  members: CargoItem[];
  memberIds: ReadonlySet<string>;
  /** member.pos − root.pos */
  offsets: Map<string, Vec3>;
  /** Member boxes relative to root.pos (same order as members). */
  relBoxes: Box[];
  /** Union of relBoxes. */
  bounds: Box;
  /** Items not in the group, settled without it. */
  others: CargoItem[];
  obstacles: Box[];
}

export interface MoveContext {
  /** Areas the group's centre must stay over (dock and decks). */
  floors: readonly Rect[];
  /** Snap targets besides other items. */
  walls: readonly Box[];
  /** Snap distance in world units; 0 disables snapping. */
  snapThreshold: number;
  /**
   * Base Y the group tries to keep: of the levels where it fits ({@link restingLevels}) the closest
   * one is taken, so cargo slides under a "bridge" it fits under. Default: the highest level, on top
   * of everything under the footprint.
   */
  preferY?: number;
}

export interface MoveResult {
  rootPos: Vec3;
  members: CargoItem[];
  guides: SnapGuide[];
  /** Base Ys the group could rest at in this spot, ascending (rootPos.y is one of them). */
  levels: number[];
}

/** The level of `levels` closest to `y`; the lower one on a tie. */
function closestLevel(levels: readonly number[], y: number): number {
  let best = levels[0];
  for (const l of levels) if (Math.abs(l - y) < Math.abs(best - y) - EPS) best = l;
  return best;
}

/** The nearest level above (dir 1) or below (dir −1) `y`, or null. */
export function adjacentLevel(levels: readonly number[], y: number, dir: 1 | -1): number | null {
  if (dir > 0) return levels.find((l) => l > y + EPS) ?? null;
  for (let i = levels.length - 1; i >= 0; i--) if (levels[i] < y - EPS) return levels[i];
  return null;
}

/** Levels the group could rest at without moving sideways, ascending. */
export function moveLevels(s: MoveSession): number[] {
  const root = s.members[0];
  return restingLevels(
    s.relBoxes.map((b) => translateBox(b, root.pos.x, 0, root.pos.z)),
    s.obstacles,
  );
}

export interface VerticalOptions {
  /** Base Y of the nearest free level above / below the item, null when there is none. */
  up: number | null;
  down: number | null;
}

/**
 * Where the item (with the stack resting on it) can go straight up or down: e.g. from under a
 * "bridge" on top of it, or back into the gap under it.
 */
export function verticalOptions(items: readonly CargoItem[], id: string): VerticalOptions {
  if (!items.some((i) => i.id === id)) return { up: null, down: null };
  const s = beginMove(items, id);
  const levels = moveLevels(s);
  const y = s.members[0].pos.y;
  return { up: adjacentLevel(levels, y, 1), down: adjacentLevel(levels, y, -1) };
}

export function beginMove(items: readonly CargoItem[], rootId: string, carryStack = true): MoveSession {
  const root = items.find((i) => i.id === rootId);
  if (!root) throw new Error(`Unknown cargo item ${rootId}`);
  const memberIds = carryStack ? collectStack(rootId, items) : new Set([rootId]);
  const members = [root, ...items.filter((i) => i.id !== rootId && memberIds.has(i.id))];
  const others = settle(items.filter((i) => !memberIds.has(i.id)));
  const offsets = new Map(
    members.map((m) => [
      m.id,
      { x: m.pos.x - root.pos.x, y: m.pos.y - root.pos.y, z: m.pos.z - root.pos.z },
    ]),
  );
  const relBoxes = members.map((m) => translateBox(itemBox(m), -root.pos.x, -root.pos.y, -root.pos.z));
  return {
    rootId,
    members,
    memberIds,
    offsets,
    relBoxes,
    bounds: unionBoxes(relBoxes)!,
    others,
    obstacles: others.map(itemBox),
  };
}

/** Where the group ends up if the root's min corner is dragged to `target` (XZ). */
export function evaluateMove(
  s: MoveSession,
  target: { x: number; z: number },
  ctx: MoveContext,
): MoveResult {
  const levelsAt = (x: number, z: number) =>
    restingLevels(
      s.relBoxes.map((b) => translateBox(b, x, 0, z)),
      s.obstacles,
    );
  const pick = (levels: number[]) =>
    ctx.preferY === undefined ? levels[levels.length - 1] : closestLevel(levels, ctx.preferY);
  const baseYAt = (x: number, z: number) => pick(levelsAt(x, z));
  const centerAt = (x: number, z: number) => boxCenter(translateBox(s.bounds, x, 0, z));

  let { x, z } = target;

  // Keep the group over something it can stand on.
  const c = centerAt(x, z);
  const clamped = clampToRects(c.x, c.z, ctx.floors);
  x += clamped.x - c.x;
  z += clamped.z - c.z;

  let guides: SnapGuide[] = [];
  if (ctx.snapThreshold > 0) {
    const snap = snapFootprint(
      translateBox(s.bounds, x, 0, z),
      { items: s.obstacles, walls: ctx.walls },
      ctx.snapThreshold,
    );
    const variants: Array<{ dx: number; dz: number; guides: SnapGuide[] }> = [];
    if (snap.x && snap.z) {
      variants.push({ dx: snap.x.delta, dz: snap.z.delta, guides: [snap.x.guide, snap.z.guide] });
    }
    if (snap.x) variants.push({ dx: snap.x.delta, dz: 0, guides: [snap.x.guide] });
    if (snap.z) variants.push({ dx: 0, dz: snap.z.delta, guides: [snap.z.guide] });

    // A snap must never make the group hop onto something it was not already standing on.
    const base = baseYAt(x, z);
    for (const v of variants) {
      const nx = x + v.dx;
      const nz = z + v.dz;
      const nc = centerAt(nx, nz);
      if (!inRects(nc.x, nc.z, ctx.floors)) continue;
      if (baseYAt(nx, nz) > base + EPS) continue;
      x = nx;
      z = nz;
      guides = v.guides;
      break;
    }
  }

  const levels = levelsAt(x, z);
  const y = pick(levels);
  const members = s.members.map((m) => {
    const o = s.offsets.get(m.id)!;
    return { ...m, pos: { x: x + o.x, y: y + o.y, z: z + o.z } };
  });
  return { rootPos: { x, y, z }, members, guides, levels };
}

/** Full item list (original order) with the session applied — for previews. */
export function composeMove(
  items: readonly CargoItem[],
  s: MoveSession,
  members: readonly CargoItem[],
): CargoItem[] {
  const byId = new Map<string, CargoItem>();
  for (const o of s.others) byId.set(o.id, o);
  for (const m of members) byId.set(m.id, m);
  return items.map((i) => byId.get(i.id) ?? i);
}

/**
 * Final item list after dropping the group. The group already fits where it is (possibly under
 * other cargo), so plain bottom-up gravity keeps it there.
 */
export function finishMove(
  items: readonly CargoItem[],
  s: MoveSession,
  members: readonly CargoItem[],
): CargoItem[] {
  return settle(composeMove(items, s, members));
}
