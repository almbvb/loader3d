import { MOUSE, MathUtils, PerspectiveCamera, Quaternion, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Box } from '../core/types';

export type ViewPreset = 'iso' | 'top' | 'side' | 'rear';

/** Direction from the target towards the camera for each preset. */
const VIEW_DIRECTIONS: Record<ViewPreset, Vector3> = {
  iso: new Vector3(-0.95, 0.8, 1.15).normalize(),
  top: new Vector3(0, 1, 0.0005).normalize(),
  side: new Vector3(0, 0.16, 1).normalize(),
  rear: new Vector3(-1, 0.3, 0).normalize(),
};

const TWEEN_MS = 550;

interface Tween {
  start: number;
  fromTarget: Vector3;
  toTarget: Vector3;
  fromDir: Vector3;
  rotation: Quaternion;
  fromLength: number;
  toLength: number;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const IDENTITY = new Quaternion();
const WORLD_UP = new Vector3(0, 1, 0);
/** Keyboard flight speed: this share of the distance to the target per second (at least 3 m/s). */
const FLY_SPEED = 0.9;
const FLY_MIN_SPEED = 300;
const flyForward = new Vector3();
const flySide = new Vector3();

/**
 * Orbit camera: rotate with LMB / one finger on empty space, pan with RMB / two fingers,
 * zoom with the wheel / pinch. Adds animated view presets and framing.
 */
export class CameraRig {
  readonly controls: OrbitControls;
  private tween: Tween | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    domElement: HTMLElement,
    private readonly onChange: () => void,
  ) {
    const c = new OrbitControls(camera, domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.rotateSpeed = 0.75;
    c.zoomSpeed = 1.1;
    c.screenSpacePanning = true;
    c.zoomToCursor = true;
    c.minDistance = 80;
    c.maxDistance = 14000;
    c.maxPolarAngle = Math.PI * 0.495;
    c.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
    c.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    c.addEventListener('change', onChange);
    c.addEventListener('start', () => {
      this.tween = null;
    });
    this.controls = c;
  }

  setLocked(locked: boolean): void {
    this.controls.enableRotate = !locked;
    this.controls.enablePan = !locked;
  }

  /**
   * WASD: slides the camera with its target over the ground — `forward` along the view direction,
   * `right` across it (−1…1) — for `dt` ms. Faster when far away, ×3 with `fast`. False when locked.
   */
  fly(forward: number, right: number, dt: number, fast: boolean): boolean {
    if (!this.controls.enablePan) return false;
    this.tween = null;
    this.camera.getWorldDirection(flyForward);
    flyForward.y = 0;
    // Looking straight down: "forward" is the top of the screen.
    if (flyForward.lengthSq() < 1e-6) flyForward.copy(WORLD_UP).applyQuaternion(this.camera.quaternion).setY(0);
    flyForward.normalize();
    flySide.crossVectors(flyForward, WORLD_UP).normalize();
    const distance = this.camera.position.distanceTo(this.controls.target);
    const step = (Math.max(FLY_MIN_SPEED, distance * FLY_SPEED) * (fast ? 3 : 1) * dt) / 1000;
    const delta = flyForward.multiplyScalar(forward * step).addScaledVector(flySide, right * step);
    this.controls.target.add(delta);
    this.camera.position.add(delta);
    this.onChange();
    return true;
  }

  setView(preset: ViewPreset, bounds: Box, animate = true): void {
    this.frame(bounds, VIEW_DIRECTIONS[preset], animate, 1.06);
  }

  /** Frames `bounds` keeping the current viewing direction. */
  focus(bounds: Box, padding = 1.25): void {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.frame(bounds, dir, true, padding);
  }

  /** Advances the view transition and damping; returns true while a transition is running. */
  update(now: number): boolean {
    const tw = this.tween;
    if (tw) {
      const t = Math.min(1, (now - tw.start) / TWEEN_MS);
      const k = easeInOutCubic(t);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      const dir = tw.fromDir.clone().applyQuaternion(new Quaternion().slerpQuaternions(IDENTITY, tw.rotation, k));
      this.camera.position.copy(this.controls.target).addScaledVector(dir, MathUtils.lerp(tw.fromLength, tw.toLength, k));
      if (t >= 1) this.tween = null;
    }
    this.controls.update();
    return this.tween !== null;
  }

  dispose(): void {
    this.controls.dispose();
  }

  private frame(bounds: Box, dir: Vector3, animate: boolean, padding: number): void {
    const center = new Vector3(
      (bounds.min.x + bounds.max.x) / 2,
      (bounds.min.y + bounds.max.y) / 2,
      (bounds.min.z + bounds.max.z) / 2,
    );
    const length = this.fitDistance(bounds, center, dir) * padding;
    if (!animate) {
      this.tween = null;
      this.controls.target.copy(center);
      this.camera.position.copy(center).addScaledVector(dir, length);
      this.controls.update();
      this.onChange();
      return;
    }
    const offset = this.camera.position.clone().sub(this.controls.target);
    const fromDir = offset.clone().normalize();
    this.tween = {
      start: performance.now(),
      fromTarget: this.controls.target.clone(),
      toTarget: center,
      fromDir,
      rotation: new Quaternion().setFromUnitVectors(fromDir, dir.clone().normalize()),
      fromLength: offset.length(),
      toLength: length,
    };
    this.onChange();
  }

  /** Smallest distance along `dir` at which all corners of `bounds` fit into the viewport. */
  private fitDistance(bounds: Box, center: Vector3, dir: Vector3): number {
    const forward = dir.clone().negate();
    const worldUp = Math.abs(dir.y) > 0.98 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(forward, worldUp).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const tanV = Math.tan(MathUtils.degToRad(this.camera.fov) / 2);
    const tanH = tanV * this.camera.aspect;
    let distance = 0;
    const corner = new Vector3();
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          corner.set(x, y, z).sub(center);
          const depth = corner.dot(dir);
          distance = Math.max(
            distance,
            depth + Math.abs(corner.dot(right)) / tanH,
            depth + Math.abs(corner.dot(up)) / tanV,
          );
        }
      }
    }
    return Math.max(distance, 150);
  }
}
