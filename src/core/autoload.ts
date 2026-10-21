import type { Box, CargoItem, Yaw } from './types';
import { itemBox, itemSize, itemWeight } from './item';
import { dockIndexAt, type PlacedBody, type VehicleLayout } from './layout';
import { floorDims } from './orientation';
import { settle } from './physics';
import { dockSpot } from './spawn';
import { COG_LONG_TOLERANCE, centreOfGravity, classify, isBalanced } from './stats';

/**
 * Automatic loading of the cargo from the dock into the bodies.
 *
 * 1. Floor first, heavy first: cargo is sorted by weight and laid out in rows across the body,
 *    from the front wall towards the doors. A row is as deep as its first item; items go in columns
 *    across the width, several shallow items one behind another. Each row picks the item turn
 *    (0° / 90°) that fills it best.
 * 2. Tiers only when the floor is full: a box may go on top of a stack if it is not heavier than
 *    the box below, its base lies completely on that box (centred) and the stack fits under the roof.
 * 3. Weight along the body: rows are reordered so that the centre of gravity comes to the middle of
 *    the body; a short load is moved back from the front wall only if that is still not enough.
 * 4. Weight across: each row is pushed to the left or the right wall, whichever keeps the load
 *    centred.
 * 5. The payload capacity of a body is never exceeded; what does not fit stays on the dock.
 *
 * Items keep the side they stand on (tilting is the user's call): only the turn about the
 * vertical is chosen. Several vehicles are filled one after another, each from its own dock or
 * all from the shared one. The result always goes through settle(): no intersections, nothing floating.
 */

export interface AutoloadOptions {
  /** Also re-arrange cargo that is already in the bodies (otherwise it stays and new cargo goes behind it). */
  repackAll?: boolean;
  /** Put cargo on top of other cargo when the floor is full. */
  allowStacking?: boolean;
  /** Vehicles to load, in this order (default: all). Other vehicles and their docks are left alone. */
  vehicleIds?: readonly string[];
}

export type LeftReason = 'too_big' | 'overweight' | 'no_space';

export interface AutoloadBodyResult {
  id: string;
  vehicleId: string;
  name: string;
  count: number;
  weight: number;
  maxLoad?: number;
  cogFromFront: number | null;
  cogOffset: number | null;
  balanced: boolean;
  /** How far (cm) the new load was moved back from the front wall to balance the weight. */
  shiftedBack: number;
}

export interface AutoloadResult {
  items: CargoItem[];
  /** Ids of the items that were placed into a body. */
  loaded: string[];
  /** Items that stayed on the dock, with the reason. */
  left: Array<{ id: string; reason: LeftReason }>;
  bodies: AutoloadBodyResult[];
}

interface Candidate {
  item: CargoItem;
  weight: number;
  h: number;
  /** Floor area it takes, cm². */
  area: number;
}

/** Footprint in body terms: `x` along the body, `z` across it. */
interface Footprint {
  x: number;
  z: number;
  yaw: Yaw;
}

/** An item placed relative to its row: `u` back from the front of the row, `v` from its left edge. */
interface Placed {
  cand: Candidate;
  fp: Footprint;
  u: number;
  v: number;
  y: number;
}

interface Stack {
  base: Placed;
  top: Placed;
  height: number;
}

interface Row {
  depth: number;
  width: number;
  placed: Placed[];
  stacks: Stack[];
  /** Assigned during balancing: distance of the row front from the front wall, and sideways shift. */
  u: number;
  shift: number;
}

interface BodyPlan {
  pb: PlacedBody;
  rows: Row[];
  /** Where free space starts, measured from the front wall (behind cargo that stays). */
  startU: number;
  budget: number;
  fixed: Array<{ box: Box; weight: number }>;
  shiftedBack: number;
}

const EPS = 1e-6;

function footprints(item: CargoItem): Footprint[] {
  const [a, b] = floorDims(item.dims, item.orientation);
  const along: Footprint = { x: a, z: b, yaw: 0 };
  return a === b ? [along] : [along, { x: b, z: a, yaw: 90 }];
}

function fitsBody(c: Candidate, pb: PlacedBody): boolean {
  const { l, w, h } = pb.body.dims;
  return c.h <= h + EPS && footprints(c.item).some((fp) => fp.x <= l + EPS && fp.z <= w + EPS);
}

function rowWeight(row: Row): number {
  return row.placed.reduce((sum, p) => sum + p.cand.weight, 0);
}

/**
 * Fills one row of the given depth with candidates in order: first into existing columns (behind
 * items that are shallower than the row), otherwise into a new column while the width allows.
 */
function fillRow(depth: number, pool: readonly Candidate[], width: number, height: number, budget: number): Row {
  const columns: Array<{ v: number; width: number; used: number }> = [];
  const placed: Placed[] = [];
  let next = 0;
  let left = budget;

  for (const cand of pool) {
    if (cand.h > height + EPS || cand.weight > left + EPS) continue;
    const fps = footprints(cand.item).sort((a, b) => b.x - a.x);
    let spot: Placed | null = null;
    for (const col of columns) {
      const fp = fps.find((f) => f.z <= col.width + EPS && f.x <= depth - col.used + EPS);
      if (fp) {
        spot = { cand, fp, u: col.used, v: col.v, y: 0 };
        col.used += fp.x;
        break;
      }
    }
    if (!spot) {
      const fp = fps.find((f) => f.x <= depth + EPS && f.z <= width - next + EPS);
      if (!fp) continue;
      columns.push({ v: next, width: fp.z, used: fp.x });
      spot = { cand, fp, u: 0, v: next, y: 0 };
      next += fp.z;
    }
    placed.push(spot);
    left -= cand.weight;
  }
  return {
    depth,
    width: next,
    placed,
    stacks: placed.map((p) => ({ base: p, top: p, height: p.cand.h })),
    u: 0,
    shift: 0,
  };
}

/** Builds floor rows in one body from the front of its free space; returns the used candidates. */
function layFloor(plan: BodyPlan, pool: Candidate[]): Set<Candidate> {
  const { l: length, w: width, h: height } = plan.pb.body.dims;
  const used = new Set<Candidate>();
  let u = plan.startU + plan.rows.reduce((sum, r) => sum + r.depth, 0);

  for (;;) {
    const free = pool.filter((c) => !used.has(c));
    const leader = free.find(
      (c) =>
        c.h <= height + EPS &&
        c.weight <= plan.budget + EPS &&
        footprints(c.item).some((fp) => fp.x <= length - u + EPS && fp.z <= width + EPS),
    );
    if (!leader) break;

    let best: Row | null = null;
    let bestScore = -1;
    for (const fp of footprints(leader.item)) {
      if (fp.x > length - u + EPS || fp.z > width + EPS) continue;
      const row = fillRow(fp.x, [leader, ...free.filter((c) => c !== leader)], width, height, plan.budget);
      if (row.placed.length === 0) continue;
      const area = row.placed.reduce((sum, p) => sum + p.fp.x * p.fp.z, 0);
      // Look ahead: the floor area that rows like this one would cover in the remaining length
      // (e.g. 3 rows of 3 pallets beat 4 rows of 2 in 3.6 m). A shallower row wins a tie.
      const rows = Math.min(Math.floor((length - u + EPS) / fp.x), Math.ceil(free.length / row.placed.length));
      const score = rows * area - fp.x * 1e-6;
      if (score > bestScore) {
        best = row;
        bestScore = score;
      }
    }
    if (!best || best.placed.length === 0) break;
    for (const p of best.placed) used.add(p.cand);
    plan.budget -= rowWeight(best);
    plan.rows.push(best);
    u += best.depth;
  }
  return used;
}

/** Puts candidates on top of stacks (lighter on heavier, fully supported, centred). */
function stackOnTop(plan: BodyPlan, pool: Candidate[]): Set<Candidate> {
  const height = plan.pb.body.dims.h;
  const used = new Set<Candidate>();
  for (const cand of pool) {
    if (cand.weight > plan.budget + EPS) continue;
    let best: { row: Row; stack: Stack; fp: Footprint; waste: number } | null = null;
    for (const row of plan.rows) {
      for (const stack of row.stacks) {
        const top = stack.top;
        if (cand.weight > top.cand.weight + EPS || stack.height + cand.h > height + EPS) continue;
        for (const fp of footprints(cand.item)) {
          if (fp.x > top.fp.x + EPS || fp.z > top.fp.z + EPS) continue;
          const waste = top.fp.x * top.fp.z - fp.x * fp.z + stack.height * 1e-3;
          if (!best || waste < best.waste) best = { row, stack, fp, waste };
        }
      }
    }
    if (!best) continue;
    const { row, stack, fp } = best;
    const top = stack.top;
    const placed: Placed = {
      cand,
      fp,
      u: top.u + (top.fp.x - fp.x) / 2,
      v: top.v + (top.fp.z - fp.z) / 2,
      y: stack.height,
    };
    row.placed.push(placed);
    stack.top = placed;
    stack.height += cand.h;
    plan.budget -= cand.weight;
    used.add(cand);
  }
  return used;
}

/** Reorders rows (and, if needed, moves the block back) to bring the centre of gravity to the middle. */
function balanceAlong(plan: BodyPlan): void {
  const length = plan.pb.body.dims.l;
  const target = length / 2;
  const front = plan.pb.box.max.x;

  // Weight and moment of each row about its own front edge; cargo that stays is a constant term.
  const stats = new Map<Row, { weight: number; moment: number }>();
  for (const row of plan.rows) {
    let weight = 0;
    let moment = 0;
    for (const p of row.placed) {
      weight += p.cand.weight;
      moment += p.cand.weight * (p.u + p.fp.x / 2);
    }
    stats.set(row, { weight, moment });
  }
  let fixedWeight = 0;
  let fixedMoment = 0;
  for (const f of plan.fixed) {
    fixedWeight += f.weight;
    fixedMoment += f.weight * (front - (f.box.min.x + f.box.max.x) / 2);
  }
  const rowsWeight = [...stats.values()].reduce((sum, r) => sum + r.weight, 0);
  const total = fixedWeight + rowsWeight;
  /** Centre of gravity (distance from the front wall) for a row order starting at `start`. */
  const cogU = (order: Row[], start: number): number => {
    if (total <= 0) return target;
    let moment = fixedMoment;
    let u = start;
    for (const row of order) {
      const r = stats.get(row)!;
      moment += r.moment + r.weight * u;
      u += row.depth;
    }
    return moment / total;
  };

  // Pairwise swaps while they improve the balance (rows are independent cross-sections).
  let order = plan.rows.slice();
  let current = Math.abs(cogU(order, plan.startU) - target);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const next = order.slice();
        [next[i], next[j]] = [next[j], next[i]];
        const c = Math.abs(cogU(next, plan.startU) - target);
        if (c < current - 0.5) {
          order = next;
          current = c;
          improved = true;
        }
      }
    }
  }

  // Loads are kept against the front wall; a short load whose weight is still too far forward is
  // moved back just enough to get into the allowed zone.
  let start = plan.startU;
  const blockLength = order.reduce((sum, r) => sum + r.depth, 0);
  const gap = length - plan.startU - blockLength;
  const u = cogU(order, start);
  const limit = target - COG_LONG_TOLERANCE * length * 0.9;
  if (u < limit && gap > EPS && rowsWeight > 0) {
    start += Math.round(Math.min(gap, ((limit - u) * total) / rowsWeight));
    plan.shiftedBack = start - plan.startU;
  }

  let at = start;
  for (const row of order) {
    row.u = at;
    at += row.depth;
  }
  plan.rows = order;
}

/** Pushes every row to the wall that keeps the load centred across the body. */
function balanceAcross(plan: BodyPlan): void {
  const width = plan.pb.body.dims.w;
  const middle = plan.pb.box.min.z + width / 2;
  let moment = plan.fixed.reduce((sum, f) => sum + f.weight * ((f.box.min.z + f.box.max.z) / 2 - middle), 0);
  const rows = plan.rows.slice().sort((a, b) => rowWeight(b) - rowWeight(a));
  for (const row of rows) {
    const own = row.placed.reduce((sum, p) => sum + p.cand.weight * (p.v + p.fp.z / 2 - width / 2), 0);
    const weight = rowWeight(row);
    const room = width - row.width;
    // Against a wall unless centring is clearly better: cargo against a wall cannot slide sideways.
    const options = [
      { shift: 0, penalty: 0 },
      { shift: room, penalty: 0 },
      { shift: room / 2, penalty: weight * 2 },
    ];
    let best = options[0];
    let bestCost = Infinity;
    for (const o of options) {
      const c = Math.abs(moment + own + weight * o.shift) + o.penalty;
      if (c < bestCost - EPS) {
        best = o;
        bestCost = c;
      }
    }
    row.shift = best.shift;
    moment += own + weight * best.shift;
  }
}

function sortCandidates(list: Candidate[]): Candidate[] {
  return list.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.area - a.area ||
      b.h - a.h ||
      a.item.seq - b.item.seq,
  );
}

export function autoload(
  items: readonly CargoItem[],
  layout: VehicleLayout,
  options: AutoloadOptions = {},
): AutoloadResult {
  const { repackAll = false, allowStacking = true, vehicleIds } = options;
  const targets = vehicleIds
    ? layout.vehicles.filter((pv) => vehicleIds.includes(pv.vehicle.id)).sort(
        (a, b) => vehicleIds.indexOf(a.vehicle.id) - vehicleIds.indexOf(b.vehicle.id),
      )
    : layout.vehicles;
  const own = layout.dockMode === 'own';
  // Docks the target vehicles are loaded from.
  const docks = new Set(targets.map((pv) => (own ? pv.index : 0)));
  /** Own docks: each vehicle takes only its own cargo; a shared dock is one pool for all of them. */
  const source = (vehicleId: string) => (own ? vehicleId : '');
  const candidates = new Map<string, Candidate[]>();
  const addCandidate = (key: string, c: Candidate) => candidates.set(key, [...(candidates.get(key) ?? []), c]);
  const wasOnDock = new Set<string>();
  /** Vehicle of the body a repacked item was taken from: it goes back to that vehicle's dock. */
  const takenFrom = new Map<string, string>();
  const plans: BodyPlan[] = targets.flatMap((pv) =>
    pv.bodies.map((pb) => ({
      pb,
      rows: [],
      startU: 0,
      budget: pb.body.maxLoad ?? Infinity,
      fixed: [],
      shiftedBack: 0,
    })),
  );
  const candidate = (item: CargoItem): Candidate => {
    const [a, b] = floorDims(item.dims, item.orientation);
    return { item, weight: itemWeight(item), h: itemSize(item).h, area: a * b };
  };

  for (const item of items) {
    const box = itemBox(item);
    const placement = classify(box, layout);
    if (placement.status === 'dock') {
      const dock = dockIndexAt(box, layout);
      if (!docks.has(dock)) continue;
      wasOnDock.add(item.id);
      addCandidate(source(layout.vehicles[dock]?.vehicle.id ?? ''), candidate(item));
      continue;
    }
    // Cargo of vehicles that are not loaded now stays where it is.
    const plan = plans.find((p) => p.pb === placement.body);
    if (!plan) continue;
    if (repackAll) {
      takenFrom.set(item.id, plan.pb.vehicleId);
      addCandidate(source(plan.pb.vehicleId), candidate(item));
      continue;
    }
    // Cargo that stays: new rows start behind it, its weight counts.
    plan.startU = Math.max(plan.startU, plan.pb.box.max.x - box.min.x);
    plan.budget -= itemWeight(item);
    plan.fixed.push({ box, weight: itemWeight(item) });
  }

  const pool: Candidate[] = [];
  const left: AutoloadResult['left'] = [];
  for (const [key, list] of candidates) {
    const group = plans.filter((p) => source(p.pb.vehicleId) === key);
    let rest = sortCandidates(list);
    for (const plan of group) {
      const used = layFloor(plan, rest);
      rest = rest.filter((c) => !used.has(c));
    }
    if (allowStacking) {
      for (const plan of group) {
        const used = stackOnTop(plan, rest);
        rest = rest.filter((c) => !used.has(c));
      }
    }
    pool.push(...rest);
    left.push(...rest.map((c) => ({ id: c.item.id, reason: leftReason(c, group) })));
  }

  // Final positions.
  const moved = new Map<string, CargoItem>();
  for (const plan of plans) {
    balanceAlong(plan);
    balanceAcross(plan);
    const { box } = plan.pb;
    for (const row of plan.rows) {
      for (const p of row.placed) {
        const x = box.max.x - (row.u + p.u) - p.fp.x;
        const z = box.min.z + row.shift + p.v;
        moved.set(p.cand.item.id, {
          ...p.cand.item,
          orientation: { ...p.cand.item.orientation, yaw: p.fp.yaw },
          pos: { x: round(x), y: round(p.y), z: round(z) },
        });
      }
    }
  }

  // Cargo taken out of a body for repacking that found no place goes back to the dock.
  const homeless = new Set(pool.filter((c) => !wasOnDock.has(c.item.id)).map((c) => c.item.id));
  const occupied: Box[] = items.filter((i) => !homeless.has(i.id)).map((i) => itemBox(moved.get(i.id) ?? i));
  for (const c of pool) {
    if (!homeless.has(c.item.id)) continue;
    const spot = dockSpot(itemSize(c.item), layout, takenFrom.get(c.item.id), occupied);
    const next = { ...c.item, pos: { x: spot.x, y: 0, z: spot.z } };
    moved.set(c.item.id, next);
    occupied.push(itemBox(next));
  }

  const result = settle(items.map((i) => moved.get(i.id) ?? i));
  const notLoaded = new Set(pool.map((c) => c.item.id));
  const loaded = items.filter((i) => moved.has(i.id) && !notLoaded.has(i.id)).map((i) => i.id);

  return { items: result, loaded, left, bodies: plans.map((plan) => bodyResult(plan, result, layout)) };
}

function round(v: number): number {
  return Math.round(v * 10) / 10;
}

function leftReason(c: Candidate, plans: BodyPlan[]): LeftReason {
  const fitting = plans.filter((p) => fitsBody(c, p.pb));
  if (fitting.length === 0) return 'too_big';
  if (fitting.every((p) => c.weight > p.budget + EPS)) return 'overweight';
  return 'no_space';
}

function bodyResult(plan: BodyPlan, items: readonly CargoItem[], layout: VehicleLayout): AutoloadBodyResult {
  const entries: Array<{ box: Box; weight: number }> = [];
  for (const item of items) {
    const box = itemBox(item);
    if (classify(box, layout).body === plan.pb) entries.push({ box, weight: itemWeight(item) });
  }
  const cog = centreOfGravity(entries, plan.pb.box);
  return {
    id: plan.pb.body.id,
    vehicleId: plan.pb.vehicleId,
    name: plan.pb.body.name,
    count: entries.length,
    weight: entries.reduce((sum, e) => sum + e.weight, 0),
    maxLoad: plan.pb.body.maxLoad,
    cogFromFront: cog.fromFront,
    cogOffset: cog.offset,
    balanced: isBalanced(cog.fromFront, cog.offset, plan.pb.box),
    shiftedBack: plan.shiftedBack,
  };
}
