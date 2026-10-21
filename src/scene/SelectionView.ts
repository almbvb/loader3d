import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { Box, CargoItem } from '../core/types';
import { boxCenter, boxSize } from '../core/geometry';
import { itemBox } from '../core/item';
import { DIM_LETTER, axisMap } from '../core/orientation';
import { FACES, faceAxis, faceSign, type Face } from '../core/resize';
import { formatLength, type Units } from '../core/units';
import { DimensionLine } from './DimensionLine';
import { UNIT_CUBE_EDGES, fatMaterial, fatSegments } from './lines';
import { COLORS } from './theme';

export const FACE_DIRECTION: Record<Face, THREE.Vector3> = {
  'x+': new THREE.Vector3(1, 0, 0),
  'x-': new THREE.Vector3(-1, 0, 0),
  'z+': new THREE.Vector3(0, 0, 1),
  'z-': new THREE.Vector3(0, 0, -1),
  'y+': new THREE.Vector3(0, 1, 0),
};

export function faceCenter(box: Box, face: Face, target = new THREE.Vector3()): THREE.Vector3 {
  const c = boxCenter(box);
  target.set(c.x, c.y, c.z);
  const axis = faceAxis(face);
  target[axis] = faceSign(face) > 0 ? box.max[axis] : box.min[axis];
  return target;
}

export interface SelectionOptions {
  units: Units;
  showDimensions: boolean;
  handles: boolean;
}

interface Handle {
  group: THREE.Group;
  material: THREE.MeshBasicMaterial;
  hit: THREE.Mesh;
}

const UP = new THREE.Vector3(0, 1, 0);
const PLUS_Z = new THREE.Vector3(0, 0, 1);
const MINUS_X = new THREE.Vector3(-1, 0, 0);
/** Handle sizes are in screen pixels (the group is scaled by world-units-per-pixel). */
const HANDLE_OFFSET_PX = 12;

const tmp = new THREE.Vector3();
const toCamera = new THREE.Vector3();

/**
 * Highlight of the selected item: outline (also visible through other boxes), its dimensions and
 * push/pull handles on the faces turned towards the camera.
 */
export class SelectionView {
  readonly root = new THREE.Group();
  itemId: string | null = null;
  private box: Box | null = null;

  private readonly outlineMaterial = fatMaterial(COLORS.accent, 2.5);
  private readonly hiddenMaterial = fatMaterial(COLORS.accent, 1.25, { depthTest: false, opacity: 0.35 });
  private readonly dimMaterial = fatMaterial(COLORS.accentDark, 1.25);
  private readonly outline = fatSegments(UNIT_CUBE_EDGES, this.outlineMaterial);
  private readonly hiddenOutline = fatSegments(UNIT_CUBE_EDGES, this.hiddenMaterial);
  private readonly dims = [0, 1, 2].map(() => new DimensionLine(this.dimMaterial, 'dim-label dim-label--item'));
  private readonly dimsGroup = new THREE.Group();
  /** All three sizes in one label, shown when the per-edge labels do not fit on screen. */
  private readonly summary = new CSS2DObject(
    Object.assign(document.createElement('div'), { className: 'dim-label dim-label--item' }),
  );

  private readonly handlesGroup = new THREE.Group();
  private readonly handles = new Map<Face, Handle>();
  private readonly hitTargets: THREE.Mesh[] = [];
  private readonly sphereGeometry = new THREE.SphereGeometry(6, 20, 14);
  private readonly coneGeometry = new THREE.ConeGeometry(5, 11, 20);
  private readonly hitGeometry = new THREE.SphereGeometry(17, 12, 8);
  private readonly hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  private hoveredFace: Face | null = null;
  private activeFace: Face | null = null;

  constructor() {
    this.root.name = 'selection';
    this.hiddenOutline.renderOrder = 12;
    this.summary.center.set(0.5, 1.6);
    this.dimsGroup.add(...this.dims, this.summary);

    for (const face of FACES) {
      const material = new THREE.MeshBasicMaterial({
        color: COLORS.accent,
        depthTest: false,
        transparent: true,
      });
      const sphere = new THREE.Mesh(this.sphereGeometry, material);
      const cone = new THREE.Mesh(this.coneGeometry, material);
      cone.position.y = 11;
      sphere.renderOrder = cone.renderOrder = 20;
      const hit = new THREE.Mesh(this.hitGeometry, this.hitMaterial);
      hit.position.y = 6;
      hit.userData.face = face;
      const group = new THREE.Group();
      group.add(sphere, cone, hit);
      group.quaternion.setFromUnitVectors(UP, FACE_DIRECTION[face]);
      this.handlesGroup.add(group);
      this.handles.set(face, { group, material, hit });
      this.hitTargets.push(hit);
    }

    this.root.add(this.outline, this.hiddenOutline, this.dimsGroup, this.handlesGroup);
    this.root.visible = false;
  }

  update(item: CargoItem | null, options: SelectionOptions): void {
    this.itemId = item?.id ?? null;
    this.box = item ? itemBox(item) : null;
    this.root.visible = !!item;
    if (!item || !this.box) return;

    const size = boxSize(this.box);
    const c = boxCenter(this.box);
    for (const line of [this.outline, this.hiddenOutline]) {
      line.position.set(c.x, c.y, c.z);
      line.scale.set(size.l + 1.2, size.h + 1.2, size.w + 1.2);
    }

    this.dimsGroup.visible = options.showDimensions;
    if (options.showDimensions) this.updateDims(this.box, item, options.units);
    this.handlesGroup.visible = options.handles;
  }

  setHoveredFace(face: Face | null): void {
    this.hoveredFace = face;
    this.paintHandles();
  }

  setActiveFace(face: Face | null): void {
    this.activeFace = face;
    this.paintHandles();
  }

  /** Invisible hit spheres of the handles currently shown. */
  handleTargets(): THREE.Object3D[] {
    if (!this.root.visible || !this.handlesGroup.visible) return [];
    return this.hitTargets.filter((h) => h.parent?.visible);
  }

  /**
   * Keeps handles a constant size on screen, hides those on faces turned away from the camera and
   * swaps per-edge size labels for one summary label when they would not fit.
   */
  beforeRender(camera: THREE.PerspectiveCamera, viewportWidth: number, viewportHeight: number): void {
    if (!this.box || !this.root.visible) return;
    if (this.dimsGroup.visible) {
      const fitted = this.dims.map((d) => d.fitLabel(camera, viewportWidth, viewportHeight));
      this.summary.visible = fitted.some((f) => !f);
    }
    if (!this.handlesGroup.visible) return;
    const pxFactor = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportHeight;
    for (const [face, handle] of this.handles) {
      const dir = FACE_DIRECTION[face];
      faceCenter(this.box, face, tmp);
      toCamera.subVectors(camera.position, tmp);
      const facing = toCamera.dot(dir) > 0 || face === this.activeFace;
      handle.group.visible = facing;
      if (!facing) continue;
      const wpp = toCamera.length() * pxFactor;
      const emphasis = face === this.activeFace || face === this.hoveredFace ? 1.25 : 1;
      handle.group.position.copy(tmp).addScaledVector(dir, wpp * HANDLE_OFFSET_PX);
      handle.group.scale.setScalar(wpp * emphasis);
    }
  }

  dispose(): void {
    this.dims.forEach((d) => d.dispose());
    this.summary.element.remove();
    this.outline.geometry.dispose();
    this.hiddenOutline.geometry.dispose();
    [this.outlineMaterial, this.hiddenMaterial, this.dimMaterial, this.hitMaterial].forEach((m) => m.dispose());
    [this.sphereGeometry, this.coneGeometry, this.hitGeometry].forEach((g) => g.dispose());
    this.handles.forEach((h) => h.material.dispose());
  }

  private paintHandles(): void {
    for (const [face, handle] of this.handles) {
      const strong = face === this.activeFace || face === this.hoveredFace;
      handle.material.color.set(strong ? COLORS.accentDark : COLORS.accent);
    }
  }

  private updateDims(box: Box, item: CargoItem, units: Units): void {
    const { min, max } = box;
    const s = boxSize(box);
    const off = 22;
    // Name the sides after the item's own dimensions, so they match the inspector after rotation.
    const axes = axisMap(item.orientation);
    const xName = DIM_LETTER[axes.x];
    const zName = DIM_LETTER[axes.z];
    this.dims[0].update({
      a: new THREE.Vector3(min.x, min.y, max.z),
      b: new THREE.Vector3(max.x, min.y, max.z),
      dir: PLUS_Z,
      offset: off,
      text: `${xName} ${formatLength(s.l, units)}`,
    });
    this.dims[1].update({
      a: new THREE.Vector3(min.x, min.y, min.z),
      b: new THREE.Vector3(min.x, min.y, max.z),
      dir: MINUS_X,
      offset: off,
      text: `${zName} ${formatLength(s.w, units)}`,
    });
    this.dims[2].update({
      a: new THREE.Vector3(min.x, min.y, max.z),
      b: new THREE.Vector3(min.x, max.y, max.z),
      dir: PLUS_Z,
      offset: off,
      text: `${DIM_LETTER[axes.y]} ${formatLength(s.h, units)}`,
    });
    const own = item.dims;
    this.summary.position.set((min.x + max.x) / 2, max.y, (min.z + max.z) / 2);
    this.summary.element.textContent = `${formatLength(own.w, units, false)} × ${formatLength(own.h, units, false)} × ${formatLength(own.l, units)}`;
  }
}
