import * as THREE from 'three';
import type { VehicleLayout } from '../core/layout';
import { loadLengths } from '../core/stats';
import type { CargoItem } from '../core/types';
import { formatLength, type Units } from '../core/units';
import { DimensionLine } from './DimensionLine';
import { fatMaterial } from './lines';
import { COLORS } from './theme';

export interface LoadLengthOptions {
  units: Units;
  show: boolean;
}

const ACROSS = new THREE.Vector3(0, 0, 1);

/**
 * Load length of every body: a dimension along the bottom edge of its side, from the front wall to
 * the rearmost cargo (the LDM of the stats bar). Follows the cargo, drag previews included.
 */
export class LoadLengthView {
  readonly root = new THREE.Group();
  private readonly material = fatMaterial(COLORS.dims, 1.25);
  private readonly dims: DimensionLine[] = [];
  /** What each dimension was last drawn for: redrawn only when it changes. */
  private readonly keys: string[] = [];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();

  constructor() {
    this.root.name = 'load-length';
  }

  update(items: readonly CargoItem[], layout: VehicleLayout, options: LoadLengthOptions): void {
    this.root.visible = options.show;
    const lengths = options.show ? loadLengths(items, layout) : new Map<string, number>();
    let count = 0;
    for (const { body, box } of layout.bodies) {
      const length = lengths.get(body.id) ?? 0;
      if (length < 0.5) continue;
      const i = count++;
      const dim = this.dims[i] ?? this.create();
      const text = formatLength(length, options.units);
      const key = `${box.max.x}|${box.max.z}|${length}|${text}`;
      if (this.keys[i] !== key) {
        this.keys[i] = key;
        this.a.set(box.max.x - length, 0, box.max.z);
        this.b.set(box.max.x, 0, box.max.z);
        dim.update({ a: this.a, b: this.b, dir: ACROSS, offset: 36, arrow: 18, text });
      }
    }
    this.dims.forEach((dim, i) => (dim.visible = i < count));
  }

  /** Hides labels that do not fit their (foreshortened) dimension line. */
  fitLabels(camera: THREE.Camera, viewportWidth: number, viewportHeight: number): void {
    if (!this.root.visible) return;
    for (const dim of this.dims) if (dim.visible) dim.fitLabel(camera, viewportWidth, viewportHeight);
  }

  dispose(): void {
    for (const dim of this.dims) dim.dispose();
    this.material.dispose();
  }

  private create(): DimensionLine {
    const dim = new DimensionLine(this.material);
    this.dims.push(dim);
    this.root.add(dim);
    return dim;
  }
}
