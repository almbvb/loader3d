import { describe, expect, it } from 'vitest';
import type { Box, CargoBody, CargoItem, Dims, DockMode, Orientation, Plan } from './types';
import { boxAt, inRects, subtractBox, volume } from './geometry';
import { itemBox } from './item';
import { LANE_SPACING, computeLayout, onFloor, ownerVehicle, remapItems, stagingRegion, stagingRegions } from './layout';
import { effectiveDims, intrinsicDims, rotate90 } from './orientation';
import { parsePlan, relayout, vehiclePlan } from './plan';
import { layoutOf, vehicle } from './testing';
import { findOccluders, segmentHitsBox } from './xray';
import { collectStack, findCollisions, findFloating, settle } from './physics';
import { beginMove, evaluateMove, finishMove } from './move';
import { snapFootprint } from './snapping';
import { resizeBox } from './resize';
import { dockSpot, findFreeSpot } from './spawn';
import { classify, computeStats } from './stats';
import { cargoRows, formatSeqList, summarizeLoad } from './report';
import { loadingOrder, loadingSteps } from './loadingOrder';

let n = 0;
function item(dims: Partial<Dims>, pos: { x: number; y?: number; z: number }, id = `i${++n}`): CargoItem {
  return {
    id,
    seq: n,
    name: id,
    dims: { l: 100, w: 100, h: 100, ...dims },
    orientation: { yaw: 0 },
    pos: { x: pos.x, y: pos.y ?? 0, z: pos.z },
    color: '#000',
  };
}

const body = (l = 1360, w = 245, h = 270, id = 'b1'): CargoBody => ({ id, name: id, kind: 'semi', dims: { l, w, h } });
const layout = layoutOf([body()]);
const ctx = { floors: layout.floors, walls: layout.walls, snapThreshold: 0 };

describe('settle (gravity)', () => {
  it('drops floating items and stacks overlapping ones', () => {
    const items = [
      item({}, { x: 0, z: 0 }, 'a'),
      item({}, { x: 50, y: 0, z: 50 }, 'b'), // intersects a
      item({}, { x: 500, y: 300, z: 0 }, 'c'), // floating
    ];
    const out = settle(items);
    expect(findCollisions(out)).toEqual([]);
    expect(findFloating(out)).toEqual([]);
    expect(out.find((i) => i.id === 'b')!.pos.y).toBe(100);
    expect(out.find((i) => i.id === 'c')!.pos.y).toBe(0);
  });

  it('keeps stack order and identity of untouched items', () => {
    const a = item({}, { x: 0, z: 0 }, 'a');
    const b = item({}, { x: 0, y: 100, z: 0 }, 'b');
    const out = settle([b, a]);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });

  it('lets a yielding item go on top of a neighbour at the same level', () => {
    const a = item({}, { x: 0, z: 0 }, 'a');
    const b = item({}, { x: 50, z: 0 }, 'b');
    const out = settle([b, a], { yieldIds: new Set(['b']) });
    expect(out[1].pos.y).toBe(0);
    expect(out[0].pos.y).toBe(100);
  });

  it('places "top" items above everything they overlap', () => {
    const a = item({}, { x: 0, z: 0 }, 'a');
    const t = item({}, { x: 0, y: 100, z: 0 }, 't');
    const m = item({ h: 50 }, { x: 0, z: 50 }, 'm');
    const out = settle([a, t, m], { topIds: new Set(['m']) });
    expect(out[2].pos.y).toBe(200);
    expect(findCollisions(out)).toEqual([]);
  });
});

describe('collectStack', () => {
  it('collects items resting only on the picked one', () => {
    const items = [
      item({}, { x: 0, z: 0 }, 'base'),
      item({ l: 50 }, { x: 0, y: 100, z: 0 }, 'top'),
      item({}, { x: 200, z: 0 }, 'other'),
      item({ l: 300 }, { x: 0, y: 100, z: 120 }, 'bridge'), // not over base
    ];
    expect([...collectStack('base', items)].sort()).toEqual(['base', 'top']);
  });

  it('does not take an item that also rests on something else', () => {
    const items = [
      item({}, { x: 0, z: 0 }, 'a'),
      item({}, { x: 100, z: 0 }, 'b'),
      item({ l: 200 }, { x: 0, y: 100, z: 0 }, 'bridge'),
    ];
    expect([...collectStack('a', items)]).toEqual(['a']);
  });
});

describe('move', () => {
  it('carries the stack and lands it on the floor', () => {
    const items = settle([item({}, { x: -400, z: 0 }, 'a'), item({ h: 50 }, { x: -400, y: 100, z: 0 }, 'b')]);
    const s = beginMove(items, 'a');
    const r = evaluateMove(s, { x: 100, z: 0 }, ctx);
    const out = finishMove(items, s, r.members);
    expect(out.find((i) => i.id === 'a')!.pos).toEqual({ x: 100, y: 0, z: 0 });
    expect(out.find((i) => i.id === 'b')!.pos).toEqual({ x: 100, y: 100, z: 0 });
  });

  it('climbs on top of an item it is dragged onto', () => {
    const items = [item({}, { x: 0, z: 0 }, 'a'), item({}, { x: 300, z: 0 }, 'b')];
    const s = beginMove(items, 'b');
    const r = evaluateMove(s, { x: 20, z: 10 }, ctx);
    expect(r.rootPos.y).toBe(100);
    expect(findCollisions(finishMove(items, s, r.members))).toEqual([]);
  });

  it('magnetises to a neighbour face instead of climbing when close', () => {
    const items = [item({}, { x: 0, z: 0 }, 'a'), item({}, { x: 300, z: 0 }, 'b')];
    const s = beginMove(items, 'b');
    const r = evaluateMove(s, { x: 96, z: 3 }, { ...ctx, snapThreshold: 8 });
    expect(r.rootPos).toEqual({ x: 100, y: 0, z: 0 });
    expect(r.guides.map((g) => g.axis).sort()).toEqual(['x', 'z']);
  });

  it('snaps to inner walls of the body', () => {
    const items = [item({}, { x: 300, z: 0 }, 'a')];
    const s = beginMove(items, 'a');
    const r = evaluateMove(s, { x: 600, z: 26 }, { ...ctx, snapThreshold: 8 });
    expect(r.rootPos.z).toBeCloseTo(122.5 - 100);
    expect(r.guides[0].kind).toBe('wall');
  });

  it('keeps the group centre over a floor', () => {
    const items = [item({}, { x: 0, z: 0 }, 'a')];
    const s = beginMove(items, 'a');
    for (const target of [{ x: 600, z: 2000 }, { x: 5000, z: 0 }, { x: -3000, z: -3000 }]) {
      const r = evaluateMove(s, target, ctx);
      expect(inRects(r.rootPos.x + 50, r.rootPos.z + 50, layout.floors)).toBe(true);
    }
  });
});

describe('snapping', () => {
  it('prefers face contact over alignment at similar distance', () => {
    const fp = boxAt({ x: 103, y: 0, z: 0 }, { l: 100, w: 100, h: 100 });
    const res = snapFootprint(fp, { items: [boxAt({ x: 0, y: 0, z: 0 }, { l: 100, w: 100, h: 100 })], walls: [] }, 10);
    expect(res.x?.delta).toBe(-3);
  });

  it('ignores far targets', () => {
    const fp = boxAt({ x: 103, y: 0, z: 500 }, { l: 100, w: 100, h: 100 });
    const res = snapFootprint(fp, { items: [boxAt({ x: 0, y: 0, z: 0 }, { l: 100, w: 100, h: 100 })], walls: [] }, 10);
    expect(res.x).toBeNull();
  });
});

describe('resize', () => {
  const start = boxAt({ x: 0, y: 0, z: 0 }, { l: 100, w: 100, h: 100 });
  const base = { obstacles: [], walls: [], snapThreshold: 0, step: 1 };

  it('pushes a face and rounds to the step', () => {
    expect(resizeBox(start, 'x+', 20.4, base).max.x).toBe(120);
    expect(resizeBox(start, 'z-', -10.6, base).min.z).toBe(-11);
  });

  it('stops at the first obstacle in the way', () => {
    const wall = boxAt({ x: 150, y: 0, z: 50 }, { l: 50, w: 50, h: 50 });
    expect(resizeBox(start, 'x+', 200, { ...base, obstacles: [wall] }).max.x).toBe(150);
  });

  it('keeps a minimum size', () => {
    expect(resizeBox(start, 'y+', -500, base).max.y).toBe(5);
  });
});

describe('geometry & placement', () => {
  it('splits the part outside a body', () => {
    const a = boxAt({ x: -50, y: 0, z: 0 }, { l: 100, w: 100, h: 300 });
    const b = boxAt({ x: 0, y: 0, z: 0 }, { l: 1000, w: 245, h: 270 });
    const parts = subtractBox(a, b);
    expect(parts.reduce((s, p) => s + volume(p), 0)).toBeCloseTo(volume(a) - 50 * 100 * 270);
  });

  it('classifies inside / overflow / dock', () => {
    const inside = itemBox(item({}, { x: 100, z: 0 }));
    const over = itemBox(item({}, { x: -30, z: 0 }));
    const dock = itemBox(item({}, { x: -300, z: 0 }));
    expect(classify(inside, layout).status).toBe('inside');
    expect(classify(over, layout).status).toBe('overflow');
    expect(classify(over, layout).outside).toHaveLength(1);
    expect(classify(dock, layout).status).toBe('dock');
  });

  it('computes fill and loading metres', () => {
    const stats = computeStats([item({ l: 120, w: 80, h: 150 }, { x: 1240, z: -122.5 })], layout);
    expect(stats.inside).toBe(1);
    expect(stats.bodies[0].ldm).toBeCloseTo(1.2);
  });

  it('finds free spots in rows without overlaps', () => {
    const region = { minX: -900, maxX: -70, minZ: -620, maxZ: 620 };
    const placed: Box[] = [];
    for (let i = 0; i < 12; i++) {
      const spot = findFreeSpot({ l: 120, w: 80, h: 150 }, region, placed)!;
      placed.push(boxAt({ x: spot.x, y: 0, z: spot.z }, { l: 120, w: 80, h: 150 }));
    }
    const asItems = placed.map((b, i) => item({ l: 120, w: 80, h: 150 }, { x: b.min.x, z: b.min.z }, `p${i}`));
    expect(findCollisions(asItems)).toEqual([]);
    expect(placed[0].max.x).toBe(-70);
  });

  it('keeps cargo attached to the front wall when the body changes', () => {
    const before = layoutOf([body(1360, 245, 270, 'semi'), body(800, 245, 270, 'tr')]);
    const after = layoutOf([body(1360, 245, 270, 'semi')]);
    const front = item({}, { x: before.bodies[0].box.max.x - 100, z: 0 }, 'f');
    const trailer = item({}, { x: 100, z: 0 }, 't');
    const dock = item({}, { x: -400, z: 0 }, 'd');
    const { items, orphans } = remapItems([front, trailer, dock], before, after);
    expect(items[0].pos.x).toBe(after.bodies[0].box.max.x - 100);
    expect(orphans).toEqual(['t']);
    expect(items[2]).toBe(dock);
  });
});

describe('report', () => {
  it('measures the cargo inside each body', () => {
    const base = item({ l: 120, w: 80, h: 150 }, { x: 1240, z: -122.5 });
    const top = item({ l: 60, w: 60, h: 60 }, { x: 1250, y: 150, z: -110 });
    const dock = item({}, { x: -400, z: 0 });
    const summary = summarizeLoad([base, top, dock], layout);
    const b = summary.bodies[0];
    expect(b.count).toBe(2);
    expect(b.floorUsed).toBeCloseTo(120 * 80);
    expect(b.floorCapacity).toBe(1360 * 245);
    expect(b.length).toBeCloseTo(120);
    expect(b.width).toBeCloseTo(80);
    expect(b.height).toBeCloseTo(210);
    expect(summary.dock).toBe(1);
  });

  it('groups identical items of one place into a row', () => {
    const pallets = [0, 100, 200].map((x) => ({ ...item({}, { x, z: 0 }), name: 'Паллета', weight: 400 }));
    const heavier = { ...item({}, { x: 300, z: 0 }), name: 'Паллета', weight: 500 };
    const waiting = { ...item({}, { x: -400, z: 0 }), name: 'Паллета', weight: 400 };
    const rows = cargoRows([waiting, ...pallets, heavier], layout);
    expect(rows.map((r) => [r.count, r.status])).toEqual([
      [3, 'inside'],
      [1, 'inside'],
      [1, 'dock'],
    ]);
    expect(rows[0].seqs).toEqual(pallets.map((p) => p.seq));
  });

  it('writes numbers as ranges', () => {
    expect(formatSeqList([5, 1, 2, 3, 9, 8])).toBe('1–3, 5, 8, 9');
    expect(formatSeqList([])).toBe('');
  });
});

describe('loading order', () => {
  const ids = (list: CargoItem[]) => list.map((i) => i.id);

  it('through the rear doors: from the front wall, each stack bottom-up', () => {
    const front = item({}, { x: 1260, z: -100 }, 'front');
    const onFront = item({}, { x: 1260, y: 100, z: -100 }, 'onFront');
    const back = item({}, { x: 0, z: -100 }, 'back');
    const beside = item({}, { x: 1260, z: 0 }, 'beside');
    expect(ids(loadingOrder([back, onFront, beside, front], 'rear'))).toEqual(['front', 'beside', 'onFront', 'back']);
  });

  it('from the side: the far side first; from above: layer by layer', () => {
    const far = item({}, { x: 0, z: -122.5 }, 'far');
    const near = item({}, { x: 1260, z: 22.5 }, 'near');
    expect(ids(loadingOrder([near, far], 'right'))).toEqual(['far', 'near']);
    expect(ids(loadingOrder([far, near], 'left'))).toEqual(['near', 'far']);
    expect(ids(loadingOrder([near, far], 'rear'))).toEqual(['near', 'far']);

    const front = item({}, { x: 1260, z: 0 }, 'front');
    const onFront = item({}, { x: 1260, y: 100, z: 0 }, 'onFront');
    const back = item({}, { x: 0, z: 0 }, 'back');
    expect(ids(loadingOrder([back, onFront, front], 'top'))).toEqual(['front', 'back', 'onFront']);
    expect(ids(loadingOrder([back, onFront, front], 'rear'))).toEqual(['front', 'onFront', 'back']);
  });

  it('never puts an item before the one it stands on', () => {
    // `high` overhangs `low` towards the front wall and the far side: by priority alone it would go first.
    const low = item({ l: 300 }, { x: 0, z: 0 }, 'low');
    const high = item({}, { x: 250, y: 100, z: -50 }, 'high');
    for (const dir of ['rear', 'right', 'left', 'top'] as const) {
      expect(ids(loadingOrder([high, low], dir))).toEqual(['low', 'high']);
    }
  });

  it('makes steps of one row, skipping the dock', () => {
    const row = [0, 1, 2, 3, 4].map((k) => item({ l: 100, w: 40 }, { x: 1260, z: -122.5 + k * 45 }));
    const next = item({}, { x: 1100, z: 0 });
    const dock = item({}, { x: -400, z: 0 });
    const steps = loadingSteps([dock, next, ...row], layout, 'rear', 3);
    expect(steps.map((s) => s.itemIds)).toEqual([ids(row.slice(0, 3)), ids(row.slice(3)), [next.id]]);
    expect(steps.every((s) => s.bodyId === 'b1')).toBe(true);
  });
});

describe('orientation (tilting)', () => {
  const dims = { l: 120, w: 80, h: 150 };
  const all = (o: Orientation) => effectiveDims(dims, o);

  it('turns about each world axis by swapping the two other sizes', () => {
    const upright: Orientation = { yaw: 0 };
    expect(all(rotate90(upright, 'y'))).toEqual({ l: 80, w: 120, h: 150 });
    expect(all(rotate90(upright, 'x'))).toEqual({ l: 120, w: 150, h: 80 });
    expect(all(rotate90(upright, 'z'))).toEqual({ l: 150, w: 80, h: 120 });
  });

  it('reaches all six orientations and comes back after two turns', () => {
    const seen = new Set<string>();
    let frontier: Orientation[] = [{ yaw: 0 }];
    while (frontier.length) {
      const next: Orientation[] = [];
      for (const o of frontier) {
        const key = JSON.stringify(all(o));
        if (seen.has(key)) continue;
        seen.add(key);
        for (const axis of ['x', 'y', 'z'] as const) {
          expect(all(rotate90(rotate90(o, axis), axis))).toEqual(all(o));
          next.push(rotate90(o, axis));
        }
      }
      frontier = next;
    }
    expect(seen.size).toBe(6);
  });

  it('keeps old plans as they were: upright has no `up`', () => {
    expect(rotate90({ yaw: 0 }, 'y')).toEqual({ yaw: 90 });
    expect(rotate90(rotate90({ yaw: 0 }, 'x'), 'x')).toEqual({ yaw: 0 });
    expect(rotate90({ yaw: 0 }, 'z')).toEqual({ yaw: 90, up: 'l' });
  });

  it('converts world sizes back to own dimensions for any orientation', () => {
    for (const o of [{ yaw: 0 }, { yaw: 90 }, { yaw: 0, up: 'l' }, { yaw: 90, up: 'w' }] as Orientation[]) {
      expect(intrinsicDims(effectiveDims(dims, o), o)).toEqual(dims);
    }
  });

  it('settles a tilted item on the floor with its new height', () => {
    const tilted = { ...item({ l: 300, w: 50, h: 100 }, { x: 0, y: 40, z: 0 }), orientation: { yaw: 0, up: 'l' } as Orientation };
    const [out] = settle([tilted]);
    expect(out.pos.y).toBe(0);
    expect(itemBox(out).max.y).toBe(300);
  });
});

describe('several vehicles', () => {
  const semi = (id: string) => body(1360, 245, 270, id);
  const two = (mode: DockMode) => computeLayout([vehicle([semi('a1')], 'A'), vehicle([semi('b1')], 'B')], mode);

  it('parks vehicles side by side with their rear doors on the dock edge', () => {
    for (const mode of ['shared', 'own'] as const) {
      const l = two(mode);
      expect(l.vehicles.map((v) => v.lane)).toEqual([0, LANE_SPACING[mode]]);
      expect(l.bodies.map((b) => b.box.min.x)).toEqual([0, 0]);
      expect(l.bodies[1].box.min.z).toBe(LANE_SPACING[mode] - 122.5);
      expect(l.bodies[1].vehicleId).toBe('B');
    }
    expect(two('shared').docks).toHaveLength(1);
    expect(two('own').docks).toHaveLength(2);
    expect(two('own').docks[0].maxZ).toBeLessThan(two('own').docks[1].minZ);
  });

  it('lays out a single vehicle exactly as before', () => {
    expect(layout.docks).toEqual([{ minX: -900, maxX: 0, minZ: -650, maxZ: 650 }]);
    expect(stagingRegion(layout)).toEqual({ minX: -870, maxX: -70, minZ: -620, maxZ: 620 });
  });

  it('counts cargo per vehicle and per dock', () => {
    const l = two('own');
    const inB = item({}, { x: 100, z: l.vehicles[1].lane }, 'inB');
    const onDockB = item({}, { x: -400, z: l.vehicles[1].lane }, 'dockB');
    const onDockA = item({}, { x: -400, z: 0 }, 'dockA');
    const stats = computeStats([inB, onDockB, onDockA], l);
    expect(stats.vehicles.map((v) => [v.inside, v.dock])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    const shared = computeStats([onDockA, { ...onDockB, pos: { ...onDockB.pos, z: 300 } }], two('shared'));
    expect(shared.vehicles.map((v) => v.dock)).toEqual([2, 2]);
  });

  it('knows which vehicle cargo belongs to', () => {
    const l = two('own');
    expect(ownerVehicle(itemBox(item({}, { x: 100, z: l.vehicles[1].lane })), l)?.vehicle.id).toBe('B');
    expect(ownerVehicle(itemBox(item({}, { x: -400, z: l.vehicles[1].lane })), l)?.vehicle.id).toBe('B');
    expect(ownerVehicle(itemBox(item({}, { x: -400, z: 0 })), two('shared'))).toBeNull();
  });

  it('puts new cargo of a vehicle behind it on a shared dock', () => {
    const l = computeLayout([vehicle([semi('a1')], 'A'), vehicle([semi('b1')], 'B'), vehicle([semi('c1')], 'C')]);
    const [region] = stagingRegions(l, 'B');
    expect(region.minZ).toBeGreaterThan(0);
    expect(region.maxZ).toBeLessThan(l.vehicles[2].lane);
    const spot = dockSpot({ l: 120, w: 80, h: 150 }, l, 'B', []);
    expect(Math.abs(spot.z + 40 - l.vehicles[1].lane)).toBeLessThan(LANE_SPACING.shared / 2);
  });

  it('moves cargo with its vehicle when the dock mode changes', () => {
    const shared = two('shared');
    const own = two('own');
    const laneB = shared.vehicles[1].lane;
    const inB = item({}, { x: 600, z: laneB - 50 }, 'inB');
    const behindB = item({}, { x: -400, z: laneB + 20 }, 'behindB');
    const behindA = item({}, { x: -400, z: -300 }, 'behindA');
    const out = relayout([inB, behindB, behindA], shared, own);
    const byId = new Map(out.map((i) => [i.id, i]));
    expect(byId.get('inB')!.pos).toEqual({ x: 600, y: 0, z: own.vehicles[1].lane - 50 });
    expect(byId.get('behindB')!.pos.z).toBe(own.vehicles[1].lane + 20);
    expect(byId.get('behindA')!.pos.z).toBe(-300);
    expect(ownerVehicle(itemBox(byId.get('behindB')!), own)?.vehicle.id).toBe('B');
  });

  it('never leaves cargo overlapping when own docks merge into one', () => {
    const own = two('own');
    const shared = two('shared');
    // The same spot behind each vehicle: after the merge the lanes are closer, the second one has to move.
    const a = item({ l: 200, w: 400 }, { x: -500, z: 300 }, 'a');
    const b = item({ l: 200, w: 400 }, { x: -500, z: own.vehicles[1].lane - 200 }, 'b');
    const out = relayout([a, b], own, shared);
    expect(findCollisions(out)).toEqual([]);
    expect(findFloating(out)).toEqual([]);
    expect(out.every((i) => i.pos.y === 0 && onFloor(itemBox(i), shared))).toBe(true);
  });

  it('sends the cargo of a removed vehicle to the dock', () => {
    const before = two('own');
    const after = computeLayout([vehicle([semi('a1')], 'A')], 'own');
    const inB = item({}, { x: 600, z: before.vehicles[1].lane }, 'inB');
    const inA = item({}, { x: 600, z: 0 }, 'inA');
    const out = relayout([inA, inB], before, after, 'A');
    expect(out[0]).toBe(inA);
    expect(classify(itemBox(out[1]), after).status).toBe('dock');
    expect(onFloor(itemBox(out[1]), after)).toBe(true);
  });

  it('cuts one vehicle out of a plan for its report', () => {
    const vehicles = [vehicle([semi('a1')], 'A'), vehicle([semi('b1')], 'B')];
    const laneB = computeLayout(vehicles, 'own').vehicles[1].lane;
    const plan: Plan = {
      vehicles,
      dockMode: 'own',
      items: [item({}, { x: 600, z: 0 }, 'inA'), item({}, { x: 600, z: laneB }, 'inB'), item({}, { x: -400, z: laneB }, 'dockB')],
      nextSeq: 1,
    };
    const sub = vehiclePlan(plan, 'B');
    expect(sub.vehicles.map((v) => v.id)).toEqual(['B']);
    expect(sub.items.map((i) => [i.id, i.pos.z])).toEqual([
      ['inB', 0],
      ['dockB', 0],
    ]);
    const sharedLaneB = computeLayout(vehicles, 'shared').vehicles[1].lane;
    const shared: Plan = {
      ...plan,
      dockMode: 'shared',
      items: [item({}, { x: 600, z: sharedLaneB }, 'inB'), item({}, { x: -400, z: sharedLaneB }, 'dockB')],
    };
    expect(vehiclePlan(shared, 'B').items.map((i) => i.id)).toEqual(['inB']);
  });

  it('reads plans saved before several vehicles', () => {
    const legacy = { bodies: [semi('x')], items: [item({}, { x: 0, z: 0 }, 'i')], nextSeq: 2 };
    const plan = parsePlan(legacy)!;
    expect(plan.vehicles).toEqual([{ id: 'veh-1', name: 'Машина 1', bodies: legacy.bodies }]);
    expect(plan.dockMode).toBe('shared');
    expect(parsePlan({ vehicles: [], items: [], nextSeq: 1 })).toBeNull();
    expect(parsePlan({ vehicles: [{ id: 'v', bodies: [] }], items: [], nextSeq: 1 })).toBeNull();
    expect(parsePlan({ items: [] })).toBeNull();
  });
});

describe('x-ray', () => {
  // Orthographic look along +X from far away: screen x = z, screen y = y, depth = x + 10000.
  const eye = { x: -10000, y: 50, z: 50 };
  const toScreen = (p: { x: number; y: number; z: number }) => ({ x: p.z, y: p.y, depth: p.x + 10000 });
  const entry = (id: string, x: number, z = 0, y = 0) => ({ id, box: boxAt({ x, y, z }, { l: 100, w: 100, h: 100 }) });

  it('finds what stands between the camera and a target', () => {
    const entries = [entry('target', 500), entry('front', 0), entry('beside', 0, 300), entry('behind', 800)];
    expect([...findOccluders(eye, entries, toScreen, (id) => id === 'target')]).toEqual(['front']);
  });

  it('finds every box hiding another one, limited by canOcclude', () => {
    const entries = [entry('a', 0), entry('b', 200), entry('c', 400), entry('d', 0, 300)];
    expect([...findOccluders(eye, entries, toScreen, () => true)].sort()).toEqual(['a', 'b']);
    expect([...findOccluders(eye, entries, toScreen, () => true, (id) => id !== 'b')]).toEqual(['a']);
  });

  it('does not count a box the target only rests on', () => {
    const entries = [entry('target', 0, 0, 100), entry('under', 0, 0, 0)];
    const above = { x: 50, y: 5000, z: 50 };
    const down = (p: { x: number; y: number; z: number }) => ({ x: p.z, y: p.x, depth: 5000 - p.y });
    expect(findOccluders(above, entries, down, (id) => id === 'target').size).toBe(0);
    expect(segmentHitsBox({ x: -10, y: 50, z: 50 }, { x: 150, y: 50, z: 50 }, entries[1].box)).toBe(true);
  });
});
