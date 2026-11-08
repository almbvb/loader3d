import { userApi } from '../api/endpoints';
import type { User } from '../api/types';
import { useAuth } from './useAuth';
import { DEFAULT_SETTINGS, sanitizeSettings, useStore, type Settings } from './useStore';

/**
 * What the editor takes from the account:
 *  - display settings belong to the account, not to the browser: applied on login, saved back
 *    (debounced, only what changed) on every change, so a new plan or another device has them too;
 *  - the tier limits (vehicles and items per plan) the store checks before adding cargo or vehicles.
 * Imported once from main.tsx.
 */

const SAVE_DELAY = 600;
const RETRY_DELAY = 5000;
/** Where the app kept settings before accounts had them: moved into the account on first login. */
const LEGACY_SETTINGS_KEY = 'loader3d:settings';

let applying = false;
let pending: Partial<Settings> = {};
let timer = 0;

function apply(settings: Settings): void {
  applying = true;
  try {
    useStore.getState().replaceSettings(settings);
  } finally {
    applying = false;
  }
}

function readLegacySettings(): Partial<Settings> | null {
  try {
    const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
    const settings = raw ? (JSON.parse(raw) as { state?: { settings?: unknown } }).state?.settings : null;
    return settings && typeof settings === 'object' ? (settings as Partial<Settings>) : null;
  } catch {
    return null;
  }
}

function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void save(), delay);
}

async function save(): Promise<void> {
  const { user } = useAuth.getState();
  if (!user || Object.keys(pending).length === 0) return;
  const body = pending;
  pending = {};
  try {
    const saved = await userApi.updateSettings(body);
    const current = useAuth.getState().user;
    if (current?.id === user.id) useAuth.getState().setUser({ ...current, settings: saved });
  } catch {
    // Offline or the server restarts: keep the changes and try again.
    pending = { ...body, ...pending };
    schedule(RETRY_DELAY);
  }
}

function applyLimits(user: User | null): void {
  const sub = user?.subscription;
  useStore.getState().setLimits(sub ? { vehicles: sub.limits.vehicles, items: sub.limits.items, tierName: sub.name } : null);
}

function onAccountChanged(user: User | null): void {
  window.clearTimeout(timer);
  pending = {};
  if (!user) {
    apply(DEFAULT_SETTINGS);
    return;
  }
  if (user.settings) {
    apply(sanitizeSettings(user.settings));
    return;
  }
  const legacy = readLegacySettings();
  apply(sanitizeSettings(legacy));
  if (legacy) {
    pending = { ...sanitizeSettings(legacy) };
    schedule(0);
  }
}

useAuth.subscribe((s, prev) => {
  if (s.user?.id !== prev.user?.id) onAccountChanged(s.user);
  if (s.user?.subscription !== prev.user?.subscription) applyLimits(s.user);
});

useStore.subscribe((s, prev) => {
  if (applying || s.settings === prev.settings || !useAuth.getState().user) return;
  for (const key of Object.keys(s.settings) as Array<keyof Settings>) {
    if (s.settings[key] !== prev.settings[key]) (pending as Record<string, unknown>)[key] = s.settings[key];
  }
  schedule(SAVE_DELAY);
});
