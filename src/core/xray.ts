import type { Box, Vec3 } from './types';

/** A point on the screen and its distance in front of the camera (≤ 0: behind it). */
export interface ScreenPoint {
  x: number;
  y: number;
  depth: number;
}

export type Projector = (p: Vec3) => ScreenPoint;

export interface XrayEntry {
  id: string;
  box: Box;
}

interface Projected extends XrayEntry {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  near: number;
  far: number;
}

/** Sample points are pulled this share of the half-size towards the centre (touching faces do not count). */
const INSET = 0.12;
/** Occluders are shrunk by this much (cm) so a box resting against the target does not hide it. */
const SKIN = 0.5;

function project(entry: XrayEntry, toScreen: Projector): Projected {
  const { min, max } = entry.box;
  const out: Projected = { ...entry, minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, near: Infinity, far: -Infinity };
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        const p = toScreen({ x, y, z });
        out.near = Math.min(out.near, p.depth);
        out.far = Math.max(out.far, p.depth);
        out.minX = Math.min(out.minX, p.x);
        out.maxX = Math.max(out.maxX, p.x);
        out.minY = Math.min(out.minY, p.y);
        out.maxY = Math.max(out.maxY, p.y);
      }
    }
  }
  // A box reaching behind the camera projects inside out: let it overlap everything.
  if (out.near <= 0) Object.assign(out, { minX: -Infinity, maxX: Infinity, minY: -Infinity, maxY: Infinity });
  return out;
}

/** The centre, the face centres and the corners of a box, pulled in a little. */
export function samplePoints(b: Box): Vec3[] {
  const c = { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
  const h = {
    x: ((b.max.x - b.min.x) / 2) * (1 - INSET),
    y: ((b.max.y - b.min.y) / 2) * (1 - INSET),
    z: ((b.max.z - b.min.z) / 2) * (1 - INSET),
  };
  const points: Vec3[] = [c];
  for (const axis of ['x', 'y', 'z'] as const) {
    for (const s of [-1, 1]) points.push({ ...c, [axis]: c[axis] + s * h[axis] });
  }
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) points.push({ x: c.x + sx * h.x, y: c.y + sy * h.y, z: c.z + sz * h.z });
    }
  }
  return points;
}

/** True when the open segment from `a` to `b` passes through the inside of `box`. */
export function segmentHitsBox(a: Vec3, b: Vec3, box: Box, skin = SKIN): boolean {
  let t0 = 0;
  let t1 = 1;
  for (const axis of ['x', 'y', 'z'] as const) {
    const lo = box.min[axis] + skin;
    const hi = box.max[axis] - skin;
    if (lo >= hi) return false;
    const d = b[axis] - a[axis];
    if (Math.abs(d) < 1e-9) {
      if (a[axis] <= lo || a[axis] >= hi) return false;
      continue;
    }
    let ta = (lo - a[axis]) / d;
    let tb = (hi - a[axis]) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 >= t1) return false;
  }
  return t1 > 1e-6 && t0 < 1 - 1e-6;
}

/**
 * X-ray: which boxes hide part of a target from a camera at `eye` — a sight line from the eye to a
 * point of the target passes through them. Screen rectangles and depths (`toScreen`) rule out most
 * pairs before any sight line is traced. `canOcclude` limits the boxes that may count.
 */
export function findOccluders(
  eye: Vec3,
  entries: readonly XrayEntry[],
  toScreen: Projector,
  isTarget: (id: string) => boolean,
  canOcclude: (id: string) => boolean = () => true,
): Set<string> {
  const projected = entries.map((e) => project(e, toScreen));
  const targets = projected.filter((e) => isTarget(e.id) && e.far > 0).sort((a, b) => a.near - b.near);
  const points: Array<Vec3[] | undefined> = [];
  const hides = (o: Projected, i: number): boolean => {
    const t = targets[i];
    if (t.id === o.id || t.far <= o.near) return false;
    if (o.maxX <= t.minX || o.minX >= t.maxX || o.maxY <= t.minY || o.minY >= t.maxY) return false;
    points[i] ??= samplePoints(t.box);
    return points[i]!.some((p) => segmentHitsBox(eye, p, o.box));
  };
  const found = new Set<string>();
  for (const o of projected) {
    if (o.far <= 0 || !canOcclude(o.id)) continue;
    // Targets starting behind the near side of `o` first (nearest first: a box mostly hides what is
    // right behind it), then the ones starting in front of it that reach behind it.
    let start = 0;
    let hi = targets.length;
    while (start < hi) {
      const mid = (start + hi) >> 1;
      if (targets[mid].near < o.near) start = mid + 1;
      else hi = mid;
    }
    let hidden = false;
    for (let i = start; i < targets.length && !hidden; i++) hidden = hides(o, i);
    for (let i = start - 1; i >= 0 && !hidden; i--) hidden = hides(o, i);
    if (hidden) found.add(o.id);
  }
  return found;
}
