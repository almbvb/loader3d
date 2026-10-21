/**
 * Domain model. All linear values are centimetres, weights are kilograms.
 *
 * World axes: X — along the vehicle (towards the cab), Y — up, Z — across the vehicle.
 * The deck of every cargo body and the dock platform are at Y = 0.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** l — along X (length), w — along Z (width), h — along Y (height). */
export interface Dims {
  l: number;
  w: number;
  h: number;
}

/** Axis-aligned box. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Axis-aligned rectangle on the floor (XZ plane). */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** Rotation about the vertical axis in degrees. */
export type Yaw = 0 | 90;

/** Which own dimension points up: `h` — standing as entered, `l` — on its end, `w` — on its side. */
export type UpAxis = 'h' | 'l' | 'w';

/**
 * Orientation of a cargo item: one of the six axis-aligned ones (quarter turns about any axis).
 * `up` picks the dimension that points up, `yaw` turns the item about the vertical; see
 * `core/orientation.ts`. Free angles would need oriented boxes in `geometry.ts`/`physics.ts`.
 */
export interface Orientation {
  yaw: Yaw;
  /** Missing: `h` (upright). Plans made before tilting never have it. */
  up?: UpAxis;
}

export interface CargoItem {
  id: string;
  /** Human-friendly running number shown on the box and in the list. */
  seq: number;
  name: string;
  /** Own dimensions, as entered by the user (independent of orientation). */
  dims: Dims;
  orientation: Orientation;
  /** World position of the min corner of the item's bounding box. */
  pos: Vec3;
  color: string;
  /** Gross weight, kg. Missing in plans made before weights existed: treated as unknown (0). */
  weight?: number;
}

export type BodyKind = 'semi' | 'truck' | 'trailer';

/** A cargo space: a semi-trailer, a rigid truck body or a drawbar trailer. */
export interface CargoBody {
  id: string;
  name: string;
  kind: BodyKind;
  /** Internal dimensions. */
  dims: Dims;
  /** Payload capacity, kg. Missing: no limit is checked. */
  maxLoad?: number;
}

/** A truck or a road train: up to MAX_BODIES cargo bodies, index 0 right behind the cab. */
export interface Vehicle {
  id: string;
  name: string;
  bodies: CargoBody[];
}

/** One staging platform along the rear doors of all vehicles, or a separate one behind each. */
export type DockMode = 'shared' | 'own';

export interface Plan {
  /** Parked side by side at the dock (along Z), the first one on Z = 0. */
  vehicles: Vehicle[];
  dockMode: DockMode;
  items: CargoItem[];
  nextSeq: number;
}
