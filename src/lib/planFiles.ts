import { uid } from '../core/item';
import { nextVehicleName, parsePlan } from '../core/plan';
import { VEHICLE_PRESETS } from '../core/presets';
import type { Plan } from '../core/types';
import { LEGACY_PLAN_KEY } from '../store/useStore';

/** An empty plan with one vehicle of a preset (src/core/presets.ts). */
export function planFromPreset(presetId: string): Plan {
  const preset = VEHICLE_PRESETS.find((p) => p.id === presetId) ?? VEHICLE_PRESETS[0];
  return {
    vehicles: [
      {
        id: uid('veh'),
        name: nextVehicleName([]),
        bodies: preset.bodies.map((b) => ({ ...b, id: uid('body'), dims: { ...b.dims } })),
      },
    ],
    dockMode: 'shared',
    items: [],
    nextSeq: 1,
  };
}

/** Saves a plan as `<name>.json` — the same format "Импорт JSON" reads. */
export function downloadPlan(name: string, plan: Plan): void {
  const data: Plan = { vehicles: plan.vehicles, dockMode: plan.dockMode, items: plan.items, nextSeq: plan.nextSeq };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  saveBlob(blob, `${safeFileName(name, 'loader3d-plan')}.json`);
}

/** A plan name usable as a file name on any OS. */
export function safeFileName(name: string, fallback: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || fallback;
}

/** Hands a generated file to the browser's downloads. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click();
  // Big files are read after the click returns: revoking at once could cut the download short.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Reads a plan file; files saved before several vehicles are converted (see parsePlan). */
export async function readPlanFile(file: File): Promise<{ name: string; plan: Plan }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('Файл не похож на план загрузки');
  }
  const plan = parsePlan(parsed);
  if (!plan) throw new Error('Файл не похож на план загрузки');
  return { name: file.name.replace(/\.json$/i, '').slice(0, 200) || 'Импортированная схема', plan };
}

/** The plan the app kept in localStorage before accounts (zustand persist format), if any. */
export function readLegacyPlan(): Plan | null {
  try {
    const raw = localStorage.getItem(LEGACY_PLAN_KEY);
    if (!raw) return null;
    const plan = parsePlan((JSON.parse(raw) as { state?: unknown }).state);
    return plan && plan.items.length > 0 ? plan : null;
  } catch {
    return null;
  }
}

export function forgetLegacyPlan(): void {
  try {
    localStorage.removeItem(LEGACY_PLAN_KEY);
  } catch {
    /* storage unavailable */
  }
}
