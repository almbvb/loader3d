import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import type { Vehicle } from '../core/types';
import { itemBox } from '../core/item';
import { pinnedIds } from '../core/physics';
import type { VehicleLayout } from '../core/layout';
import { classify, computeStats, type Placement, type PlanStats } from '../core/stats';
import type { Units } from '../core/units';
import { activeVehicle, getLayout, useStore } from '../store/useStore';
import { useAuth } from '../store/useAuth';
import { useUi } from '../store/useUi';
import { useUpgrade } from '@/components/UpgradeDialog';

export function useLayout(): VehicleLayout {
  const vehicles = useStore((s) => s.vehicles);
  const dockMode = useStore((s) => s.dockMode);
  return getLayout(vehicles, dockMode);
}

export function useActiveVehicle(): Vehicle {
  return useStore(activeVehicle);
}

export function usePlacements(): Map<string, Placement> {
  const items = useStore((s) => s.items);
  const layout = useLayout();
  return useMemo(() => new Map(items.map((i) => [i.id, classify(itemBox(i), layout)])), [items, layout]);
}

/** Fixed cargo and what it stands on (they cannot be moved, turned or resized). */
export function usePinned(): Set<string> {
  const items = useStore((s) => s.items);
  return useMemo(() => pinnedIds(items), [items]);
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
const ARROW_WIDGETS = '[role=tablist],[role=radiogroup],[role=combobox],[role=slider],[aria-haspopup]';

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

/** Whether the account's tier includes a feature (true while the account is not known yet). */
export function useFeature(feature: 'autoload' | 'pdfSteps'): boolean {
  return useAuth((s) => s.user?.subscription?.limits[feature] ?? true);
}

/** Opens the automatic loading dialog, or the offer of «Профи» on tiers without it. */
export function useOpenAutoload(): () => void {
  const allowed = useFeature('autoload');
  const setAutoloadOpen = useUi((s) => s.setAutoloadOpen);
  const show = useUpgrade((s) => s.show);
  return () => (allowed ? setAutoloadOpen(true) : show('Автозагрузка с развесовкой доступна на тарифе «Профи».'));
}
