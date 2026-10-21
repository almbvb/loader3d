import { describe, expect, it } from 'vitest';
import type { CargoBody, CargoItem, Dims } from './types';
import { autoload } from './autoload';
import { itemBox } from './item';
import { computeLayout, stagingRegion } from './layout';
import { layoutOf, vehicle } from './testing';
import { findCollisions, findFloating, settle } from './physics';
import { findFreeSpot } from './spawn';
import { COG_LAT_TOLERANCE, COG_LONG_TOLERANCE, classify, computeStats } from './stats';

let n = 0;
const body = (l = 1360, w = 245, h = 270, maxLoad?: number, id = 'b1'): CargoBody => ({
  id,
  name: id,
  kind: 'semi',
  dims: { l, w, h },
  maxLoad,
});

/** `count` items of one kind placed on free spots of the dock. */
function onDock(layout: ReturnType<typeof computeLayout>, existing: CargoItem[], count: number, dims: Dims, weight?: number): CargoItem[] {
  const out = [...existing];
  for (let i = 0; i < count; i++) {
    const id = `c${++n}`;
    const spot = findFreeSpot(dims, stagingRegion(layout), out.map(itemBox), 5)!;
    expect(spot).not.toBeNull();
    out.push({
      id,
      seq: n,
      name: id,
      dims,
      orientation: { yaw: 0 },
      pos: { x: spot.x, y: 0, z: spot.z },
      color: '#000',
      weight,
    });
  }
  return out;
}

function expectSound(items: CargoItem[]) {
  expect(findCollisions(items)).toEqual([]);
  expect(findFloating(items)).toEqual([]);
}

const PALLET = { l: 120, w: 80, h: 150 };

describe('autoload', () => {
  it('loads a full trailer of euro pallets without overlaps', () => {
    const layout = layoutOf([body()]);
    const items = onDock(layout, [], 33, PALLET, 400);
    const result = autoload(items, layout);
    expectSound(result.items);
    expect(result.left).toEqual([]);
    expect(result.loaded).toHaveLength(33);
    for (const item of result.items) expect(classify(itemBox(item), layout).status).toBe('inside');
    expect(result.bodies[0].weight).toBe(33 * 400);
    expect(result.bodies[0].balanced).toBe(true);
  });

  it('never exceeds the payload capacity', () => {
    const layout = layoutOf([body(1360, 245, 270, 5000)]);
    const items = onDock(layout, [], 8, PALLET, 1000);
    const result = autoload(items, layout);
    expectSound(result.items);
    expect(result.loaded).toHaveLength(5);
    expect(result.left).toHaveLength(3);
    expect(result.left.every((l) => l.reason === 'overweight')).toBe(true);
    expect(computeStats(result.items, layout).bodies[0].weight).toBeLessThanOrEqual(5000);
  });

  it('stacks only when the floor is full, lighter on heavier and fully supported', () => {
    const layout = layoutOf([body(360, 245, 270)]);
    // Floor: 3 rows × 3 pallets = 9 places and no room left; 4 light boxes must go on top.
    let items = onDock(layout, [], 9, PALLET, 500);
    items = onDock(layout, items, 4, { l: 60, w: 40, h: 40 }, 20);
    const result = autoload(items, layout);
    expectSound(result.items);
    expect(result.left).toEqual([]);
    const boxes = result.items.map((i) => ({ item: i, box: itemBox(i) }));
    const upper = boxes.filter((b) => b.box.min.y > 0);
    expect(upper.map((b) => b.item.weight)).toEqual([20, 20, 20, 20]);
    for (const u of upper) {
      const below = boxes.find(
        (b) =>
          Math.abs(b.box.max.y - u.box.min.y) < 0.01 &&
          b.box.min.x <= u.box.min.x + 0.01 &&
          b.box.max.x >= u.box.max.x - 0.01 &&
          b.box.min.z <= u.box.min.z + 0.01 &&
          b.box.max.z >= u.box.max.z - 0.01,
      );
      expect(below, 'fully supported').toBeDefined();
      expect(below!.item.weight! >= u.item.weight!).toBe(true);
    }
  });

  it('picks the pallet turn that fits more of them', () => {
    // 3.6 m: 3 rows of 3 lengthwise pallets (9) beat 4 rows of 2 crosswise ones (8).
    const short = layoutOf([body(360, 245, 270)]);
    expect(autoload(onDock(short, [], 9, PALLET, 400), short).loaded).toHaveLength(9);
    // 13.6 m: 17 rows of 2 crosswise pallets (34) beat 11 rows of 3 (33).
    const long = layoutOf([body()]);
    expect(autoload(onDock(long, [], 34, PALLET, 400), long).loaded).toHaveLength(34);
  });

  it('keeps everything on the floor when there is room', () => {
    const layout = layoutOf([body()]);
    let items = onDock(layout, [], 6, PALLET, 500);
    items = onDock(layout, items, 6, { l: 60, w: 40, h: 40 }, 20);
    const result = autoload(items, layout);
    expect(result.items.every((i) => i.pos.y === 0)).toBe(true);
  });

  it('can be told not to stack at all', () => {
    const layout = layoutOf([body(360, 245, 270)]);
    let items = onDock(layout, [], 9, PALLET, 500);
    items = onDock(layout, items, 2, { l: 60, w: 40, h: 40 }, 20);
    const result = autoload(items, layout, { allowStacking: false });
    expect(result.left.map((l) => l.reason)).toEqual(['no_space', 'no_space']);
    expect(result.items.every((i) => i.pos.y === 0)).toBe(true);
  });

  it('balances a partial heavy load along and across the body', () => {
    const layout = layoutOf([body(1360, 245, 270, 20000)]);
    let items = onDock(layout, [], 5, { l: 120, w: 100, h: 116 }, 1000);
    items = onDock(layout, items, 4, PALLET, 300);
    const result = autoload(items, layout);
    expectSound(result.items);
    const b = result.bodies[0];
    expect(b.balanced).toBe(true);
    expect(Math.abs(b.cogFromFront! - 0.5)).toBeLessThanOrEqual(COG_LONG_TOLERANCE);
    expect(Math.abs(b.cogOffset!)).toBeLessThanOrEqual(COG_LAT_TOLERANCE * 245);
  });

  it('leaves cargo already in the body where it is and loads behind it', () => {
    const layout = layoutOf([body()]);
    const front = layout.bodies[0].box;
    const fixed: CargoItem = {
      id: 'fixed',
      seq: 0,
      name: 'fixed',
      dims: PALLET,
      orientation: { yaw: 0 },
      pos: { x: front.max.x - 120, y: 0, z: front.min.z },
      color: '#000',
      weight: 400,
    };
    const items = onDock(layout, [fixed], 6, PALLET, 400);
    const result = autoload(items, layout);
    expectSound(result.items);
    expect(result.items.find((i) => i.id === 'fixed')).toBe(fixed);
    for (const item of result.items) {
      if (item.id !== 'fixed') expect(itemBox(item).max.x).toBeLessThanOrEqual(front.max.x - 120 + 0.01);
    }
  });

  it('repacks cargo already in the bodies when asked, and returns what does not fit to the dock', () => {
    const layout = layoutOf([body(300, 245, 270)]);
    const box = layout.bodies[0].box;
    const inside: CargoItem[] = [0, 1].map((i) => ({
      id: `in${i}`,
      seq: 100 + i,
      name: 'in',
      dims: PALLET,
      orientation: { yaw: 0 },
      pos: { x: box.min.x + i * 130, y: 0, z: box.min.z },
      color: '#000',
      weight: 100,
    }));
    const items = onDock(layout, inside, 8, PALLET, 600);
    const result = autoload(items, layout, { repackAll: true });
    expectSound(result.items);
    // 7 pallets fit (rows of 120 + 80 + 80 cm): the heavy ones from the dock take the floor,
    // the light ones that were inside go to the dock.
    const stats = computeStats(result.items, layout);
    expect(stats.bodies[0].count).toBe(result.loaded.length);
    expect(result.loaded).toHaveLength(7);
    for (const id of result.loaded) expect(result.items.find((i) => i.id === id)!.weight).toBe(600);
    expect(result.left.map((l) => l.id)).toEqual(expect.arrayContaining(['in0', 'in1']));
    for (const id of ['in0', 'in1']) {
      expect(classify(itemBox(result.items.find((i) => i.id === id)!), layout).status).toBe('dock');
    }
  });

  it('handles hundreds of boxes quickly and soundly', () => {
    const layout = layoutOf([body()]);
    const items = onDock(layout, [], 300, { l: 60, w: 40, h: 40 }, 20);
    const started = performance.now();
    const result = autoload(items, layout);
    expect(performance.now() - started).toBeLessThan(2000);
    expectSound(result.items);
    expect(result.left).toEqual([]);
  });

  it('works with cargo that has no weight (plans made before weights)', () => {
    const layout = layoutOf([body(400, 245, 270)]);
    const items = onDock(layout, [], 12, PALLET);
    const result = autoload(items, layout);
    expectSound(result.items);
    expect(result.loaded.length).toBeGreaterThan(0);
    expect(result.bodies[0].cogFromFront).toBeNull();
  });

  it('reports cargo that is bigger than any body', () => {
    const layout = layoutOf([body(400, 245, 270)]);
    const items = onDock(layout, [], 1, { l: 500, w: 100, h: 100 }, 10);
    const result = autoload(items, layout);
    expect(result.left).toEqual([{ id: items[0].id, reason: 'too_big' }]);
    expect(result.items[0]).toBe(items[0]);
  });

  it('fills the next body of a road train', () => {
    const layout = layoutOf([body(770, 245, 300, 10000, 'truck'), body(820, 245, 300, 10000, 'trailer')]);
    const items = onDock(layout, [], 24, PALLET, 700);
    const result = autoload(items, layout);
    expectSound(result.items);
    const [truck, trailer] = result.bodies;
    expect(truck.weight).toBeLessThanOrEqual(10000);
    expect(trailer.weight).toBeLessThanOrEqual(10000);
    expect(truck.count + trailer.count).toBe(result.loaded.length);
    expect(result.loaded.length).toBe(24 - result.left.length);
    expect(trailer.count).toBeGreaterThan(0);
  });
});

describe('autoload with several vehicles', () => {
  const two = (mode: 'shared' | 'own') =>
    computeLayout([vehicle([body(1360, 245, 270, 20000, 'a1')], 'A'), vehicle([body(1360, 245, 270, 20000, 'b1')], 'B')], mode);

  /** Pallets on the dock of a vehicle. */
  function dockOf(layout: ReturnType<typeof computeLayout>, vehicleId: string, existing: CargoItem[], count: number): CargoItem[] {
    const out = [...existing];
    for (let i = 0; i < count; i++) {
      const id = `m${++n}`;
      const spot = findFreeSpot(PALLET, stagingRegion(layout, vehicleId), out.map(itemBox), 5)!;
      out.push({ id, seq: n, name: id, dims: PALLET, orientation: { yaw: 0 }, pos: { x: spot.x, y: 0, z: spot.z }, color: '#000', weight: 300 });
    }
    return out;
  }

  it('loads only the chosen vehicle from a shared dock', () => {
    const layout = two('shared');
    const items = dockOf(layout, 'A', [], 6);
    const result = autoload(items, layout, { vehicleIds: ['B'] });
    expectSound(result.items);
    expect(result.bodies.map((b) => b.vehicleId)).toEqual(['B']);
    expect(result.loaded).toHaveLength(6);
    for (const item of result.items) expect(classify(itemBox(item), layout).body?.vehicleId).toBe('B');
  });

  it('loads every vehicle from its own dock', () => {
    const layout = two('own');
    const items = dockOf(layout, 'B', dockOf(layout, 'A', [], 4), 3);
    const result = autoload(items, layout);
    expectSound(result.items);
    const stats = computeStats(result.items, layout);
    expect(stats.vehicles.map((v) => v.inside)).toEqual([4, 3]);

    const onlyA = autoload(items, layout, { vehicleIds: ['A'] });
    expect(onlyA.loaded).toHaveLength(4);
    expect(computeStats(onlyA.items, layout).vehicles.map((v) => [v.inside, v.dock])).toEqual([
      [4, 0],
      [0, 3],
    ]);
  });

  it('leaves the cargo of other vehicles alone when repacking', () => {
    const layout = two('shared');
    const loaded = autoload(dockOf(layout, 'A', [], 8), layout).items;
    const inA = loaded.filter((i) => classify(itemBox(i), layout).body?.vehicleId === 'A');
    const result = autoload(loaded, layout, { vehicleIds: ['B'], repackAll: true });
    for (const item of inA) expect(result.items.find((i) => i.id === item.id)).toBe(item);
  });

  it('keeps tilted cargo on the side it was put on', () => {
    const layout = layoutOf([body()]);
    const items = onDock(layout, [], 4, { l: 200, w: 60, h: 40 }, 50).map((i) => ({
      ...i,
      orientation: { yaw: 0 as const, up: 'l' as const },
    }));
    const result = autoload(settle(items), layout);
    expectSound(result.items);
    expect(result.loaded).toHaveLength(4);
    for (const item of result.items) {
      expect(item.orientation.up).toBe('l');
      expect(itemBox(item).max.y - itemBox(item).min.y).toBe(200);
    }
  });
});
