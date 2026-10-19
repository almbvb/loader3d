import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { itemBox } from '../core/item';
import type { VehicleLayout } from '../core/layout';
import { classify, computeStats, type Placement, type PlanStats } from '../core/stats';
import type { Units } from '../core/units';
import { getLayout, useStore } from '../store/useStore';

export function useLayout(): VehicleLayout {
  const bodies = useStore((s) => s.bodies);
  return getLayout(bodies);
}

export function usePlacements(): Map<string, Placement> {
  const items = useStore((s) => s.items);
  const layout = useLayout();
  return useMemo(() => new Map(items.map((i) => [i.id, classify(itemBox(i), layout)])), [items, layout]);
}

export function useStats(): PlanStats {
  const items = useStore((s) => s.items);
  const layout = useLayout();
  return useMemo(() => computeStats(items, layout), [items, layout]);
}

export function useUnits(): Units {
  return useStore((s) => s.settings.units);
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

const MODAL = '[role=dialog],[role=alertdialog],[role=menu],[role=listbox]';
const ARROW_WIDGETS = '[role=tablist],[role=radiogroup],[role=combobox],[aria-haspopup]';

/**
 * The scene listens for shortcuts on window (Del, R, arrows...). Keys pressed inside menus and
 * dialogs, and arrows inside tabs/selects, belong to those widgets: stop them before they reach
 * the scene. Put on the editor root; React bubbles events from portals through it too.
 */
export function guardSceneShortcuts(e: KeyboardEvent<HTMLElement>): void {
  const target = e.target as HTMLElement;
  if (target.closest(MODAL)) e.stopPropagation();
  else if (e.key.startsWith('Arrow') && target.closest(ARROW_WIDGETS)) e.stopPropagation();
}
