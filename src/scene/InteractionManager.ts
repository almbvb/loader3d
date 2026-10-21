import type { RotationAxis } from '../core/orientation';
import type { SceneEngine, PickResult } from './SceneEngine';
import { SCENE_UI_ATTRIBUTE } from './VehicleView';
import { MoveTool } from './tools/MoveTool';
import { ResizeTool } from './tools/ResizeTool';
import type { PointerInfo, Tool, ToolKind } from './tools/Tool';

/** Pointer travel (px) before a press on an item turns into a drag. */
const DRAG_THRESHOLD: Record<string, number> = { mouse: 3, pen: 5, touch: 8 };
const DOUBLE_TAP_MS = 350;

interface Pending {
  pointerId: number;
  pointerType: string;
  x: number;
  y: number;
  hit: PickResult;
  altKey: boolean;
}

function threshold(pointerType: string): number {
  return DRAG_THRESHOLD[pointerType] ?? 4;
}

function toInfo(e: PointerEvent): PointerInfo {
  return {
    clientX: e.clientX,
    clientY: e.clientY,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    pointerType: e.pointerType,
  };
}

/** Rotation keys when tilting is allowed (R is always the vertical). */
const TILT_KEYS: Record<string, RotationAxis> = { KeyX: 'x', KeyY: 'y', KeyZ: 'z' };

/** Buttons drawn over the scene (vehicle name tags) handle their own clicks. */
function isSceneUi(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(`[${SCENE_UI_ATTRIBUTE}]`) !== null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'range'].includes(target.type);
}

/**
 * Context-sensitive pointer routing — no mode switches:
 *  - press on empty space → the event goes on to OrbitControls (rotate / pan / zoom);
 *  - press on a cargo item → OrbitControls never sees it, the item is selected and dragged;
 *  - press on a resize handle of the selected item → push/pull of that face.
 *
 * Listeners sit on the host element in the capture phase, so they run before OrbitControls'
 * listeners on the canvas and can stop the event from reaching it.
 */
export class InteractionManager {
  private pending: Pending | null = null;
  private tool: Tool | null = null;
  /** Pointers handed over to OrbitControls (a second finger joins an orbit/pinch gesture). */
  private readonly passthrough = new Set<number>();
  private emptyPress: { pointerId: number; x: number; y: number } | null = null;
  private queuedMove: PointerInfo | null = null;
  private moveFrame = 0;
  private hoverFrame = 0;
  private hoverPoint: { x: number; y: number } | null = null;
  private lastTap = { id: '', time: 0 };

  constructor(
    private readonly engine: SceneEngine,
    private readonly host: HTMLElement,
  ) {
    host.addEventListener('pointerdown', this.onPointerDown, { capture: true });
    host.addEventListener('pointermove', this.onHover);
    host.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('pointermove', this.onPointerMove, { capture: true });
    window.addEventListener('pointerup', this.onPointerUp, { capture: true });
    window.addEventListener('pointercancel', this.onPointerCancel, { capture: true });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('blur', this.onWindowBlur);
  }

  get activeTool(): ToolKind | null {
    return this.tool?.kind ?? null;
  }

  dispose(): void {
    this.cancelTool();
    cancelAnimationFrame(this.moveFrame);
    cancelAnimationFrame(this.hoverFrame);
    this.host.removeEventListener('pointerdown', this.onPointerDown, { capture: true });
    this.host.removeEventListener('pointermove', this.onHover);
    this.host.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('pointermove', this.onPointerMove, { capture: true });
    window.removeEventListener('pointerup', this.onPointerUp, { capture: true });
    window.removeEventListener('pointercancel', this.onPointerCancel, { capture: true });
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  private readonly onPointerDown = (e: PointerEvent) => {
    // Clicking the scene finishes editing in the side panel (commits the field on blur).
    const active = document.activeElement;
    if (active instanceof HTMLElement && isTypingTarget(active)) active.blur();
    if (isSceneUi(e.target)) return;

    if (this.pending) {
      // Extra fingers while dragging an item are ignored, not turned into an orbit.
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (this.passthrough.size > 0 || e.button !== 0) {
      this.passthrough.add(e.pointerId);
      this.emptyPress = null;
      return;
    }

    const hit = this.engine.pick(e.clientX, e.clientY);
    if (!hit) {
      this.passthrough.add(e.pointerId);
      this.emptyPress = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }

    e.stopPropagation();
    e.preventDefault();
    try {
      this.host.setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety */
    }
    if (hit.kind === 'item') this.engine.store.getState().select(hit.id);
    this.pending = {
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      x: e.clientX,
      y: e.clientY,
      hit,
      altKey: e.altKey,
    };
    this.engine.setHover(null, null);
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    const p = this.pending;
    if (!p || e.pointerId !== p.pointerId) return;
    e.preventDefault();
    if (!this.tool) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < threshold(p.pointerType)) return;
      this.tool = this.createTool(p);
      this.tool.begin(toInfo(e));
      this.engine.setCursor(this.tool.cursor);
      this.engine.onToolChanged();
    }
    this.queuedMove = toInfo(e);
    if (!this.moveFrame) this.moveFrame = requestAnimationFrame(this.flushMove);
  };

  private readonly flushMove = () => {
    this.moveFrame = 0;
    const info = this.queuedMove;
    this.queuedMove = null;
    if (this.tool && info) this.tool.move(info);
  };

  private readonly onPointerUp = (e: PointerEvent) => {
    this.passthrough.delete(e.pointerId);

    const empty = this.emptyPress;
    if (empty && empty.pointerId === e.pointerId) {
      this.emptyPress = null;
      if (Math.hypot(e.clientX - empty.x, e.clientY - empty.y) < threshold(e.pointerType)) {
        this.engine.store.getState().select(null);
      }
    }

    const p = this.pending;
    if (!p || p.pointerId !== e.pointerId) return;
    if (this.tool) {
      cancelAnimationFrame(this.moveFrame);
      this.flushMove();
      this.tool.end(true);
    } else if (p.hit.kind === 'item') {
      this.handleTap(p.hit.id);
    }
    this.finishGesture(e);
  };

  private readonly onPointerCancel = (e: PointerEvent) => {
    this.passthrough.delete(e.pointerId);
    if (this.emptyPress?.pointerId === e.pointerId) this.emptyPress = null;
    if (this.pending?.pointerId === e.pointerId) this.cancelTool();
  };

  private readonly onWindowBlur = () => {
    this.passthrough.clear();
    this.emptyPress = null;
    this.cancelTool();
  };

  private readonly onHover = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || this.pending || this.passthrough.size > 0) return;
    if (isSceneUi(e.target)) {
      this.onLeave();
      return;
    }
    this.hoverPoint = { x: e.clientX, y: e.clientY };
    if (!this.hoverFrame) this.hoverFrame = requestAnimationFrame(this.updateHover);
  };

  private readonly updateHover = () => {
    this.hoverFrame = 0;
    const point = this.hoverPoint;
    if (!point || this.pending) return;
    const hit = this.engine.pick(point.x, point.y);
    if (!hit) {
      this.engine.setHover(null, null);
      this.engine.setCursor('');
    } else if (hit.kind === 'handle') {
      this.engine.setHover(null, hit.face);
      this.engine.setCursor(hit.face === 'y+' ? 'ns-resize' : 'ew-resize');
    } else {
      this.engine.setHover(hit.id, null);
      this.engine.setCursor('grab');
    }
  };

  private readonly onLeave = () => {
    this.hoverPoint = null;
    if (!this.pending) {
      this.engine.setHover(null, null);
      this.engine.setCursor('');
    }
  };

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e.target)) return;
    const state = this.engine.store.getState();
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      if (this.tool || this.pending) this.cancelTool();
      else state.select(null);
      return;
    }
    if (this.pending) return;
    // e.code keeps shortcuts working on non-latin keyboard layouts.
    if (mod && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) state.redo();
      else state.undo();
      return;
    }
    if (mod && e.code === 'KeyY') {
      e.preventDefault();
      state.redo();
      return;
    }

    const id = state.selectedId;
    if (!id) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      state.removeItem(id);
    } else if (e.code === 'KeyR' && !mod) {
      e.preventDefault();
      state.rotateItem(id, 'y');
    } else if (TILT_KEYS[e.code] && !mod && !e.altKey && state.settings.allowTilt) {
      e.preventDefault();
      state.rotateItem(id, TILT_KEYS[e.code]);
    } else if (e.code === 'KeyD' && mod) {
      e.preventDefault();
      state.duplicateItem(id);
    } else if (e.code === 'KeyF' && !mod) {
      this.engine.focusItem(id);
    } else if (e.key.startsWith('Arrow')) {
      const step = this.engine.cameraAlignedStep(e.key, e.shiftKey ? 10 : 1);
      if (!step) return;
      e.preventDefault();
      state.nudgeItem(id, step.x, step.z);
    }
  };

  private createTool(p: Pending): Tool {
    const hit = p.hit;
    if (hit.kind === 'handle') return new ResizeTool(this.engine, hit.id, hit.face);
    // Alt picks up just this item; otherwise the stack resting on it comes along.
    return new MoveTool(this.engine, hit.id, hit.point, !p.altKey);
  }

  private handleTap(id: string): void {
    const now = performance.now();
    if (this.lastTap.id === id && now - this.lastTap.time < DOUBLE_TAP_MS) {
      this.engine.focusItem(id);
      this.lastTap = { id: '', time: 0 };
    } else {
      this.lastTap = { id, time: now };
    }
  }

  private cancelTool(): void {
    cancelAnimationFrame(this.moveFrame);
    this.moveFrame = 0;
    this.queuedMove = null;
    if (this.tool) this.tool.end(false);
    this.finishGesture();
  }

  private finishGesture(e?: PointerEvent): void {
    const p = this.pending;
    if (p) {
      try {
        if (this.host.hasPointerCapture(p.pointerId)) this.host.releasePointerCapture(p.pointerId);
      } catch {
        /* already released */
      }
    }
    const hadTool = this.tool !== null;
    this.pending = null;
    this.tool = null;
    this.engine.setCursor('');
    if (hadTool) this.engine.onToolChanged();
    if (e && e.pointerType === 'mouse') {
      this.hoverPoint = { x: e.clientX, y: e.clientY };
      this.updateHover();
    }
  }
}
