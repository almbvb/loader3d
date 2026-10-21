import type { Dims, Orientation, UpAxis, Yaw } from './types';

export type DimKey = keyof Dims;
/** A world axis to turn about: X along the vehicle, Y up, Z across. */
export type RotationAxis = 'x' | 'y' | 'z';

/** Which own dimension lies along each world axis. */
export interface AxisMap {
  x: DimKey;
  y: DimKey;
  z: DimKey;
}

/** The two own dimensions on the floor for each `up`: along X and along Z at yaw 0. */
const FLOOR: Record<UpAxis, [DimKey, DimKey]> = { h: ['l', 'w'], l: ['w', 'h'], w: ['l', 'h'] };

export function upAxis(o: Orientation): UpAxis {
  return o.up ?? 'h';
}

export function isUpright(o: Orientation): boolean {
  return upAxis(o) === 'h';
}

/**
 * Extension point for rotation. Everything else in the app works with the world-axis size returned
 * by {@link effectiveDims}, so the six axis-aligned orientations only live here. Free (non 90°)
 * rotation would additionally need oriented boxes in `geometry.ts`/`physics.ts`.
 */
export function axisMap(o: Orientation): AxisMap {
  const up = upAxis(o);
  const [a, b] = FLOOR[up];
  return o.yaw === 90 ? { x: b, y: up, z: a } : { x: a, y: up, z: b };
}

/** Inverse of {@link axisMap}. Upright orientations carry no `up`, so old plans stay byte-identical. */
export function orientationOf(map: AxisMap): Orientation {
  const up = map.y as UpAxis;
  const yaw: Yaw = map.x === FLOOR[up][0] ? 0 : 90;
  return up === 'h' ? { yaw } : { yaw, up };
}

export function effectiveDims(dims: Dims, o: Orientation): Dims {
  const m = axisMap(o);
  return { l: dims[m.x], w: dims[m.z], h: dims[m.y] };
}

/** Inverse of {@link effectiveDims}: converts a world-axis size back to the item's own dimensions. */
export function intrinsicDims(world: Dims, o: Orientation): Dims {
  const m = axisMap(o);
  const own = { l: 0, w: 0, h: 0 };
  own[m.x] = world.l;
  own[m.y] = world.h;
  own[m.z] = world.w;
  return own;
}

/** Own dimensions lying on the floor: [along X, along Z] at yaw 0 (yaw 90 swaps them). */
export function floorDims(dims: Dims, o: Orientation): [number, number] {
  const [a, b] = FLOOR[upAxis(o)];
  return [dims[a], dims[b]];
}

/** A quarter turn about a world axis: the dimensions along the two other axes swap places. */
export function rotate90(o: Orientation, axis: RotationAxis): Orientation {
  const m = axisMap(o);
  if (axis === 'y') return orientationOf({ x: m.z, y: m.y, z: m.x });
  if (axis === 'x') return orientationOf({ x: m.x, y: m.z, z: m.y });
  return orientationOf({ x: m.y, y: m.x, z: m.z });
}

/** Short Russian names of the own dimensions, as in the cargo form. */
export const DIM_LETTER: Record<DimKey, string> = { l: 'Д', w: 'Ш', h: 'В' };

/** «Повёрнут на 90°», «На боку»... for the inspector. */
export function describeOrientation(o: Orientation): string {
  const up = upAxis(o);
  if (up === 'l') return 'Поставлен на торец';
  if (up === 'w') return 'Положен на бок';
  return o.yaw === 90 ? 'Повёрнут на 90°' : 'Исходная ориентация';
}
