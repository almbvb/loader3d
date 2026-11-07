export interface PointerInfo {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  altKey: boolean;
  pointerType: string;
}

/**
 * An interactive gesture on the scene, started by pressing on something pickable.
 * New gestures (free rotation ring, multi-select box, measuring tape...) implement this
 * and are routed by `InteractionManager.onPointerDown`.
 */
export interface Tool {
  readonly kind: ToolKind;
  readonly cursor: string;
  begin(p: PointerInfo): void;
  move(p: PointerInfo): void;
  /** `commit === false` reverts the preview (Esc, pointer cancel, lost focus). */
  end(commit: boolean): void;
  /** Dragged cargo: whether it could go up or down where it is now, and switching (PgUp/PgDn). */
  levelOptions?(): { up: boolean; down: boolean } | null;
  stepLevel?(dir: 1 | -1): void;
}

export type ToolKind = 'move' | 'resize';
