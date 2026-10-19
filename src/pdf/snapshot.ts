import * as THREE from 'three';
import type { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import type { Box, CargoItem } from '../core/types';
import { itemBox } from '../core/item';
import type { VehicleLayout } from '../core/layout';
import { formatLength } from '../core/units';
import { CargoView } from '../scene/CargoView';
import { VehicleView } from '../scene/VehicleView';
import { boxEdges, fatMaterial, fatSegments } from '../scene/lines';

export type Projection = 'orthographic' | 'perspective';

export interface Shot {
  items: readonly CargoItem[];
  /** Region to frame. */
  bounds: Box;
  /** From the framed region towards the camera. */
  direction: THREE.Vector3;
  /** Screen-up direction in the world. */
  up: THREE.Vector3;
  projection: Projection;
  /** Vertical field of view of a perspective camera, degrees. */
  fov?: number;
  /** Image width in CSS px (scene lines are drawn in CSS px); the bitmap has twice as many pixels. */
  width: number;
  /** Width the image is printed at, pt: numbers and rulers are sized for print. */
  printWidth: number;
  /** Width / height of the rendered area; by default whatever fits the framed region. */
  aspect?: number;
  /** Items that get their number drawn on them. */
  labels: ReadonlySet<string>;
  /** Drawing-style rulers (orthographic views only): length and width from above, height from the side. */
  rulers?: 'top' | 'side';
  format: 'png' | 'jpeg';
}

export interface Snapshot {
  dataUrl: string;
  /** CSS px */
  width: number;
  height: number;
}

const BACKGROUND = '#ffffff';
const RULER = '#94a3b8';
const RULER_TEXT = '#64748b';
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';
/** Device pixels per CSS px: an integer, so the WebGL frame is copied pixel for pixel. */
const SCALE = 2;
const PADDING = 1.03;

/** Faces of a box by their outward normal, used to put a number on the side facing the camera. */
const FACES = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
];

type ToPixel = (p: THREE.Vector3) => { x: number; y: number };

/**
 * Renders still images of the plan for the PDF report with the scene's own vehicle and cargo
 * views, in a separate WebGL context that does not touch the editor's camera or canvas.
 */
export class SnapshotRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly vehicle = new VehicleView();
  private readonly cargo = new CargoView();
  private readonly edgeMaterial = fatMaterial('#1e293b', 1.1, { opacity: 0.5 });
  private edges: LineSegments2 | null = null;
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly layout: VehicleLayout,
    private readonly highlightOverflow: boolean,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(SCALE);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.scene.background = new THREE.Color(BACKGROUND);

    // Same light rig as the editor, without shadows: report views read like drawings.
    const hemi = new THREE.HemisphereLight('#ffffff', '#aab3bf', 1.55);
    const sun = new THREE.DirectionalLight('#ffffff', 2.3);
    sun.position.set(-0.35, 1, 0.5);
    const fill = new THREE.DirectionalLight('#e3ebff', 0.55);
    fill.position.set(2000, 1200, -2400);
    this.scene.add(hemi, sun, fill);

    // Units only matter for the dimension lines, which reports do not show.
    this.vehicle.build(layout, { units: 'm', showDimensions: false });
    // The dock (everything behind the rear doors) is not part of the plan.
    const bounds = new THREE.Box3();
    for (const child of this.vehicle.root.children) {
      if (bounds.setFromObject(child).max.x <= 0.5) child.visible = false;
    }
    // Print-friendly: the vehicle as a light grey silhouette (this view's own materials) so the cargo stands out.
    const ghost = new THREE.Color('#dde2e8');
    const seen = new Set<THREE.Material>();
    this.vehicle.root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        if (seen.has(m) || !(m instanceof THREE.MeshStandardMaterial) || m.transparent) continue;
        seen.add(m);
        m.color.lerp(ghost, 0.62);
      }
    });
    this.scene.add(this.vehicle.root, this.cargo.root);
  }

  render(shot: Shot): Snapshot {
    this.cargo.sync(shot.items, this.layout, { highlightOverflow: this.highlightOverflow, showLabels: false });
    this.setEdges(shot.items);

    // CSS px per printed pt: everything drawn over the frame is sized in pt.
    const pt = shot.width / shot.printWidth;
    const margin =
      shot.rulers === 'top'
        ? { l: 30, r: 6, t: 4, b: 18 }
        : shot.rulers === 'side'
          ? { l: 30, r: 6, t: 4, b: 4 }
          : { l: 0, r: 0, t: 0, b: 0 };
    const [l, r, t, b] = [margin.l, margin.r, margin.t, margin.b].map((v) => Math.round(v * pt));
    const view = frame(shot);
    const w = shot.width - l - r;
    const h = Math.round(w / view.aspect);
    this.renderer.setSize(w, h, false);
    this.renderer.render(this.scene, view.camera);

    const totalH = h + t + b;
    const canvas = document.createElement('canvas');
    canvas.width = shot.width * SCALE;
    canvas.height = totalH * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, shot.width, totalH);
    ctx.drawImage(this.renderer.domElement, l, t, w, h);

    const toPixel: ToPixel = (p) => {
      const ndc = p.clone().project(view.camera);
      return { x: l + ((ndc.x + 1) / 2) * w, y: t + ((1 - ndc.y) / 2) * h };
    };
    if (shot.rulers === 'top') this.drawTopRulers(ctx, toPixel, pt);
    if (shot.rulers === 'side') this.drawSideRuler(ctx, toPixel, pt);
    this.drawLabels(ctx, shot, view.camera, toPixel, pt);

    const dataUrl = shot.format === 'png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.88);
    return { dataUrl, width: shot.width, height: totalH };
  }

  dispose(): void {
    this.setEdges([]);
    this.edgeMaterial.dispose();
    this.vehicle.dispose();
    this.cargo.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  /** Crisp outlines on top of the scene's 1-px edges, so equal neighbours stay apart in print. */
  private setEdges(items: readonly CargoItem[]): void {
    if (this.edges) {
      this.edges.geometry.dispose();
      this.scene.remove(this.edges);
      this.edges = null;
    }
    if (!items.length) return;
    const positions = items.flatMap((item) => {
      const b = itemBox(item);
      return boxEdges(b.min, b.max);
    });
    this.edges = fatSegments(positions, this.edgeMaterial);
    this.scene.add(this.edges);
  }

  /** Item numbers in white circles on the face looking at the camera, where that face is visible. */
  private drawLabels(ctx: CanvasRenderingContext2D, shot: Shot, camera: THREE.Camera, toPixel: ToPixel, pt: number): void {
    const radius = 4.6 * pt;
    const placed: Array<{ x: number; y: number }> = [];
    const toCamera = shot.direction.clone().normalize();
    const normal = FACES.reduce((best, n) => (n.dot(toCamera) > best.dot(toCamera) ? n : best));
    const meshes = this.cargo.pickables();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const item of shot.items) {
      if (!shot.labels.has(item.id)) continue;
      const corners = faceCorners(itemBox(item), normal);
      const pixels = corners.map(toPixel);
      const xs = pixels.map((p) => p.x);
      const ys = pixels.map((p) => p.y);
      if (Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < radius * 2 + pt) continue;

      const anchor = corners.reduce((s, c) => s.add(c), new THREE.Vector3()).multiplyScalar(0.25);
      const ndc = anchor.clone().project(camera);
      this.raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const hit = this.raycaster.intersectObjects(meshes, false)[0];
      if (!hit || hit.object.userData.itemId !== item.id) continue;

      const p = toPixel(anchor);
      if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < radius * 2)) continue;
      placed.push(p);
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
      ctx.lineWidth = 0.4 * pt;
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
      ctx.stroke();
      const text = String(item.seq);
      ctx.fillStyle = '#1b2330';
      ctx.font = `700 ${(text.length > 2 ? 4.4 : 5.6) * pt}px ${FONT}`;
      ctx.fillText(text, p.x, p.y + 0.3 * pt);
    }
  }

  /** Top view: length of every body under it (0 at its rear doors) and the width on the left. */
  private drawTopRulers(ctx: CanvasRenderingContext2D, toPixel: ToPixel, pt: number): void {
    const corner = (x: number, z: number) => toPixel(new THREE.Vector3(x, 0, z));
    const bottom = Math.max(...this.layout.bodies.map(({ box }) => corner(box.min.x, box.max.z).y));
    const left = Math.min(...this.layout.bodies.map(({ box }) => corner(box.min.x, box.max.z).x));
    for (const { box } of this.layout.bodies) {
      const a = corner(box.min.x, box.max.z).x;
      const b = corner(box.max.x, box.max.z).x;
      drawRuler(ctx, { x: a, y: bottom + 5 * pt }, { x: b, y: bottom + 5 * pt }, box.max.x - box.min.x, 'below', pt);
    }
    const { box } = this.layout.bodies.reduce((m, pb) => (pb.box.max.z - pb.box.min.z > m.box.max.z - m.box.min.z ? pb : m));
    const near = corner(box.min.x, box.max.z);
    const far = corner(box.min.x, box.min.z);
    drawRuler(ctx, { x: left - 5 * pt, y: near.y }, { x: left - 5 * pt, y: far.y }, box.max.z - box.min.z, 'left', pt);
  }

  /** Side view: height of the tallest body from its deck. */
  private drawSideRuler(ctx: CanvasRenderingContext2D, toPixel: ToPixel, pt: number): void {
    const { box } = this.layout.bodies.reduce((m, pb) => (pb.box.max.y > m.box.max.y ? pb : m));
    const left = Math.min(...this.layout.bodies.map((pb) => toPixel(new THREE.Vector3(pb.box.min.x, 0, pb.box.max.z)).x));
    const deck = toPixel(new THREE.Vector3(box.min.x, box.min.y, box.max.z));
    const roof = toPixel(new THREE.Vector3(box.min.x, box.max.y, box.max.z));
    drawRuler(ctx, { x: left - 5 * pt, y: deck.y }, { x: left - 5 * pt, y: roof.y }, box.max.y - box.min.y, 'left', pt);
  }
}

interface Framing {
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  aspect: number;
}

/** Camera that fits `shot.bounds` seen from `shot.direction`. */
function frame(shot: Shot): Framing {
  const { min, max } = shot.bounds;
  const center = new THREE.Vector3((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  const dir = shot.direction.clone().normalize();
  const forward = dir.clone().negate();
  const right = new THREE.Vector3().crossVectors(forward, shot.up).normalize();
  const up = new THREE.Vector3().crossVectors(right, forward).normalize();
  const corners: THREE.Vector3[] = [];
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) corners.push(new THREE.Vector3(x, y, z).sub(center));
    }
  }

  let halfW = Math.max(...corners.map((c) => Math.abs(c.dot(right)))) * PADDING;
  let halfH = Math.max(...corners.map((c) => Math.abs(c.dot(up)))) * PADDING;
  const aspect = shot.aspect ?? halfW / halfH;
  if (halfW / halfH < aspect) halfW = halfH * aspect;
  else halfH = halfW / aspect;
  const radius = Math.max(...corners.map((c) => c.length()));

  if (shot.projection === 'orthographic') {
    const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, radius * 4 + 1000);
    camera.position.copy(center).addScaledVector(dir, radius * 2 + 500);
    camera.up.copy(up);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    return { camera, aspect };
  }

  const fov = shot.fov ?? 30;
  const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const tanH = tanV * aspect;
  let distance = 0;
  for (const c of corners) {
    const depth = c.dot(dir);
    distance = Math.max(distance, depth + Math.abs(c.dot(right)) / tanH, depth + Math.abs(c.dot(up)) / tanV);
  }
  distance *= PADDING;
  const camera = new THREE.PerspectiveCamera(fov, aspect, Math.max(10, distance - radius * 1.5), distance + radius * 1.5);
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.up.copy(up);
  camera.lookAt(center);
  camera.updateMatrixWorld();
  return { camera, aspect };
}

function faceCorners(b: Box, n: THREE.Vector3): THREE.Vector3[] {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (n.y > 0) {
    return [v(b.min.x, b.max.y, b.min.z), v(b.max.x, b.max.y, b.min.z), v(b.max.x, b.max.y, b.max.z), v(b.min.x, b.max.y, b.max.z)];
  }
  if (n.z !== 0) {
    const z = n.z > 0 ? b.max.z : b.min.z;
    return [v(b.min.x, b.min.y, z), v(b.max.x, b.min.y, z), v(b.max.x, b.max.y, z), v(b.min.x, b.max.y, z)];
  }
  const x = n.x > 0 ? b.max.x : b.min.x;
  return [v(x, b.min.y, b.min.z), v(x, b.min.y, b.max.z), v(x, b.max.y, b.max.z), v(x, b.max.y, b.min.z)];
}

/**
 * A measuring scale from `a` (zero) to `b` (`lengthCm`): ticks every metre, labels as often as they
 * fit, the full length at the end. Labels go below a horizontal scale or left of a vertical one.
 */
function drawRuler(
  ctx: CanvasRenderingContext2D,
  a: { x: number; y: number },
  b: { x: number; y: number },
  lengthCm: number,
  labels: 'below' | 'left',
  pt: number,
): void {
  const pxLength = Math.hypot(b.x - a.x, b.y - a.y);
  if (pxLength < 1 || lengthCm <= 0) return;
  const at = (cm: number) => ({ x: a.x + ((b.x - a.x) * cm) / lengthCm, y: a.y + ((b.y - a.y) * cm) / lengthCm });
  const pxPerMetre = (pxLength / lengthCm) * 100;
  const minGap = (labels === 'below' ? 20 : 9) * pt;
  const every = [1, 2, 5, 10].find((m) => m * pxPerMetre >= minGap) ?? 10;
  // Ticks point away from the drawing: down for a horizontal scale, left for a vertical one.
  const [tx, ty] = labels === 'below' ? [0, 1] : [-1, 0];

  ctx.strokeStyle = RULER;
  ctx.lineWidth = 0.4 * pt;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  for (let m = 0; m * 100 <= lengthCm + 0.01; m++) {
    const p = at(m * 100);
    const size = (m % every === 0 ? 2.8 : 1.6) * pt;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + tx * size, p.y + ty * size);
  }
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x + tx * 2.8 * pt, b.y + ty * 2.8 * pt);
  ctx.stroke();

  ctx.fillStyle = RULER_TEXT;
  ctx.font = `500 ${5.4 * pt}px ${FONT}`;
  ctx.textAlign = labels === 'below' ? 'center' : 'right';
  ctx.textBaseline = labels === 'below' ? 'top' : 'middle';
  const label = (cm: number, text: string) => {
    const p = at(cm);
    ctx.fillText(text, p.x + tx * 4.2 * pt, p.y + ty * 4.2 * pt);
  };
  const endGap = (labels === 'below' ? 17 : 7) * pt;
  for (let m = 0; m * 100 <= lengthCm + 0.01; m += every) {
    if (m > 0 && ((lengthCm - m * 100) / 100) * pxPerMetre < endGap) break;
    label(m * 100, m === 0 ? '0' : `${m} м`);
  }
  label(lengthCm, formatLength(lengthCm, 'm'));
}
