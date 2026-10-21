import * as THREE from 'three';
import type { CargoItem, Dims } from '../core/types';
import type { VehicleLayout } from '../core/layout';
import { itemBox, itemSize } from '../core/item';
import { classify } from '../core/stats';
import { disposeTree } from './lines';
import { COLORS } from './theme';

export interface CargoViewOptions {
  highlightOverflow: boolean;
  showLabels: boolean;
}

interface ItemVisual {
  group: THREE.Group;
  mesh: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
  edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null;
  labelText: string;
  /** World-space red boxes for the parts outside the body. */
  overflow: THREE.Group;
  overflowing: boolean;
  geometryKey: string;
  color: string;
  /** X-ray: shown opacity and the one it is easing towards. */
  alpha: number;
  targetAlpha: number;
}

/** Time constant of the x-ray fade, ms. */
const FADE_MS = 90;
/** Items fainter than this are "see-through": picking goes through them. */
const SEE_THROUGH = 0.75;

const labelTextures = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string): THREE.CanvasTexture {
  let texture = labelTextures.get(text);
  if (texture) return texture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1b2330';
  ctx.font = `700 ${text.length > 2 ? 50 : 64}px Inter, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 68);
  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.shared = true;
  labelTextures.set(text, texture);
  return texture;
}

function edgeColor(color: string): THREE.Color {
  return new THREE.Color(color).lerp(new THREE.Color('#0b1220'), 0.5);
}

/**
 * Cargo boxes: one mesh + edges + top-face number per item, plus red overflow volumes.
 * Any item can be faded out (x-ray) — the fill turns translucent, the outline stays readable.
 */
export class CargoView {
  readonly root = new THREE.Group();
  private readonly visuals = new Map<string, ItemVisual>();
  private pickList: THREE.Mesh[] | null = null;

  private readonly unitBox = new THREE.BoxGeometry(1, 1, 1);
  private readonly unitEdges = new THREE.EdgesGeometry(this.unitBox);
  private readonly unitPlane = new THREE.PlaneGeometry(1, 1);
  private readonly overflowMaterial = new THREE.MeshBasicMaterial({
    color: COLORS.danger,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private readonly overflowEdgeMaterial = new THREE.LineBasicMaterial({ color: COLORS.danger });
  private readonly overflowEdgeColor = new THREE.Color(COLORS.danger);

  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private layout: VehicleLayout | null = null;
  private highlight = true;

  constructor() {
    this.root.name = 'cargo';
  }

  sync(items: readonly CargoItem[], layout: VehicleLayout, options: CargoViewOptions): void {
    const contextChanged = layout !== this.layout || options.highlightOverflow !== this.highlight;
    this.layout = layout;
    this.highlight = options.highlightOverflow;

    const seen = new Set<string>();
    for (const item of items) {
      seen.add(item.id);
      const v = this.visuals.get(item.id) ?? this.create(item);
      const size = itemSize(item);
      const box = itemBox(item);
      const key = `${box.min.x}|${box.min.y}|${box.min.z}|${size.l}|${size.w}|${size.h}`;
      const moved = key !== v.geometryKey;
      if (moved) {
        v.mesh.scale.set(size.l, size.h, size.w);
        v.edges.scale.copy(v.mesh.scale);
        v.group.position.set(box.min.x + size.l / 2, box.min.y + size.h / 2, box.min.z + size.w / 2);
        v.geometryKey = key;
      }
      if (item.color !== v.color) {
        v.color = item.color;
        v.mesh.material.color.set(item.color);
        this.applyEdgeColor(v);
      }
      this.syncLabel(v, item, size, options.showLabels);
      if (moved || contextChanged) this.syncOverflow(v, item);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) this.destroy(id, v);
    }
  }

  /** X-ray: opacity per item id (missing: opaque). Changes ease in over a few frames, see {@link animate}. */
  setFade(fade: ReadonlyMap<string, number> | null): void {
    for (const [id, v] of this.visuals) v.targetAlpha = fade?.get(id) ?? 1;
  }

  /** Advances the fades by `dt` ms; true while some are still changing. */
  animate(dt: number): boolean {
    const k = 1 - Math.exp(-Math.max(0, dt) / FADE_MS);
    let running = false;
    for (const v of this.visuals.values()) {
      if (v.alpha === v.targetAlpha) continue;
      const next = v.alpha + (v.targetAlpha - v.alpha) * k;
      v.alpha = Math.abs(next - v.targetAlpha) < 0.01 ? v.targetAlpha : next;
      this.applyAlpha(v);
      running ||= v.alpha !== v.targetAlpha;
    }
    return running;
  }

  /** Faded out by the x-ray: what is behind it gets picked. */
  isSeeThrough(id: string): boolean {
    const v = this.visuals.get(id);
    return !!v && v.targetAlpha < SEE_THROUGH;
  }

  /** Item meshes for raycasting. */
  pickables(): THREE.Mesh[] {
    if (!this.pickList) this.pickList = [...this.visuals.values()].map((v) => v.mesh);
    return this.pickList;
  }

  setHighlight(hoveredId: string | null, selectedId: string | null): void {
    const changed = new Set([this.hoveredId, this.selectedId, hoveredId, selectedId]);
    this.hoveredId = hoveredId;
    this.selectedId = selectedId;
    for (const id of changed) {
      const v = id ? this.visuals.get(id) : undefined;
      if (!v || !id) continue;
      const m = v.mesh.material;
      if (id === selectedId) {
        m.emissive.set(COLORS.accent);
        m.emissiveIntensity = 0.2;
      } else if (id === hoveredId) {
        m.emissive.set('#ffffff');
        m.emissiveIntensity = 0.13;
      } else {
        m.emissiveIntensity = 0;
      }
    }
  }

  dispose(): void {
    for (const [id, v] of this.visuals) this.destroy(id, v);
    this.unitBox.dispose();
    this.unitEdges.dispose();
    this.unitPlane.dispose();
    this.overflowMaterial.dispose();
    this.overflowEdgeMaterial.dispose();
  }

  private create(item: CargoItem): ItemVisual {
    const material = new THREE.MeshStandardMaterial({
      color: item.color,
      roughness: 0.72,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const mesh = new THREE.Mesh(this.unitBox, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = { itemId: item.id, sharedGeometry: true };

    const edges = new THREE.LineSegments(
      this.unitEdges,
      new THREE.LineBasicMaterial({ color: edgeColor(item.color) }),
    );
    edges.userData.sharedGeometry = true;

    const group = new THREE.Group();
    group.add(mesh, edges);
    const overflow = new THREE.Group();
    this.root.add(group, overflow);

    const visual: ItemVisual = {
      group,
      mesh,
      edges,
      label: null,
      labelText: '',
      overflow,
      overflowing: false,
      geometryKey: '',
      color: item.color,
      alpha: 1,
      targetAlpha: 1,
    };
    this.visuals.set(item.id, visual);
    this.pickList = null;
    return visual;
  }

  private destroy(id: string, v: ItemVisual): void {
    disposeTree(v.group);
    this.root.remove(v.group, v.overflow);
    this.visuals.delete(id);
    this.pickList = null;
    if (this.hoveredId === id) this.hoveredId = null;
  }

  private applyAlpha(v: ItemVisual): void {
    const a = v.alpha;
    const faded = a < 0.995;
    const fill = v.mesh.material;
    const edges = v.edges.material;
    if (fill.transparent !== faded) {
      fill.transparent = edges.transparent = faded;
      fill.depthWrite = edges.depthWrite = !faded;
      fill.needsUpdate = edges.needsUpdate = true;
      // A ghost casts no shadow on the cargo it lets you see.
      v.mesh.castShadow = !faded;
    }
    fill.opacity = a;
    edges.opacity = faded ? 0.3 + 0.7 * a : 1;
    if (v.label) v.label.material.opacity = Math.min(1, a * 1.6);
  }

  private applyEdgeColor(v: ItemVisual): void {
    v.edges.material.color.copy(v.overflowing ? this.overflowEdgeColor : edgeColor(v.color));
  }

  private syncLabel(v: ItemVisual, item: CargoItem, size: Dims, show: boolean): void {
    if (!show) {
      if (v.label) v.label.visible = false;
      return;
    }
    if (!v.label) {
      const material = new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      });
      v.label = new THREE.Mesh(this.unitPlane, material);
      v.label.rotation.x = -Math.PI / 2;
      v.label.userData.sharedGeometry = true;
      v.group.add(v.label);
      this.applyAlpha(v);
    }
    const text = String(item.seq);
    if (v.labelText !== text) {
      v.label.material.map = labelTexture(text);
      v.label.material.needsUpdate = true;
      v.labelText = text;
    }
    const s = Math.min(44, Math.max(12, Math.min(size.l, size.w) * 0.42));
    v.label.scale.set(s, s, 1);
    v.label.position.set(0, size.h / 2 + 0.2, 0);
    v.label.visible = true;
  }

  private syncOverflow(v: ItemVisual, item: CargoItem): void {
    const parts = this.highlight && this.layout ? classify(itemBox(item), this.layout).outside : [];
    while (v.overflow.children.length < parts.length) {
      const part = new THREE.Group();
      const fill = new THREE.Mesh(this.unitBox, this.overflowMaterial);
      const lines = new THREE.LineSegments(this.unitEdges, this.overflowEdgeMaterial);
      fill.renderOrder = lines.renderOrder = 5;
      part.add(fill, lines);
      part.traverse((o) => {
        o.userData.sharedGeometry = true;
        o.userData.sharedMaterial = true;
      });
      v.overflow.add(part);
    }
    const inflate = 0.4;
    v.overflow.children.forEach((part, i) => {
      const p = parts[i];
      part.visible = !!p;
      if (!p) return;
      part.position.set((p.min.x + p.max.x) / 2, (p.min.y + p.max.y) / 2, (p.min.z + p.max.z) / 2);
      part.scale.set(
        p.max.x - p.min.x + inflate * 2,
        p.max.y - p.min.y + inflate * 2,
        p.max.z - p.min.z + inflate * 2,
      );
    });
    const overflowing = parts.length > 0;
    if (overflowing !== v.overflowing) {
      v.overflowing = overflowing;
      this.applyEdgeColor(v);
    }
  }
}
