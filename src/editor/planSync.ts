import { create } from 'zustand';
import { ApiError, errorMessage } from '../api/client';
import { planApi } from '../api/endpoints';
import type { PlanRecord } from '../api/types';
import { exportPlan, useStore } from '../store/useStore';

/**
 * Autosave of the open plan. Every change of the plan in the store schedules a PATCH with the
 * version the editor last saw; a rename goes through the same queue. One request at a time.
 * 409 (someone saved in between, e.g. another tab) stops saving until the user picks a version.
 */

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

interface PlanSyncState {
  planId: string | null;
  name: string;
  version: number;
  status: SaveStatus;
  /** updatedAt of the last successful save. */
  savedAt: string | null;
  error: string | null;
  /** Version on the server when a conflict was detected. */
  conflictVersion: number | null;
}

export const usePlanSync = create<PlanSyncState>()(() => ({
  planId: null,
  name: '',
  version: 0,
  status: 'saved',
  savedAt: null,
  error: null,
  conflictVersion: null,
}));

const SAVE_DELAY = 1200;
const RETRY_DELAY = 5000;

let unsubscribe: (() => void) | null = null;
let timer = 0;
let dataDirty = false;
let pendingName: string | null = null;
let inFlight: Promise<void> | null = null;
/** Set while the store is replaced by the server version: that is not a local edit. */
let applyingRemote = false;

const set = usePlanSync.setState;

export function startSync(record: PlanRecord): void {
  stopSync();
  dataDirty = false;
  pendingName = null;
  set({
    planId: record.id,
    name: record.name,
    version: record.version,
    status: 'saved',
    savedAt: record.updatedAt,
    error: null,
    conflictVersion: null,
  });
  unsubscribe = useStore.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.vehicles !== prev.vehicles || s.dockMode !== prev.dockMode || s.items !== prev.items || s.nextSeq !== prev.nextSeq) {
      dataDirty = true;
      markPending(SAVE_DELAY);
    }
  });
}

export function stopSync(): void {
  unsubscribe?.();
  unsubscribe = null;
  window.clearTimeout(timer);
}

export function renamePlan(name: string): void {
  pendingName = name;
  set({ name });
  markPending(0);
}

function markPending(delay: number): void {
  if (usePlanSync.getState().status === 'conflict') return;
  if (usePlanSync.getState().status !== 'saving') set({ status: 'pending' });
  schedule(delay);
}

function schedule(delay: number): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => void flush(), delay);
}

/** Saves pending changes now. Resolves when there is nothing left to send (or saving failed). */
export async function flush(): Promise<void> {
  window.clearTimeout(timer);
  if (inFlight) await inFlight;
  const { planId, version, status } = usePlanSync.getState();
  if (!planId || status === 'conflict' || (!dataDirty && pendingName === null)) return;

  const body: { version: number; name?: string; data?: ReturnType<typeof exportPlan> } = { version };
  const sentData = dataDirty;
  const sentName = pendingName;
  if (dataDirty) body.data = exportPlan(useStore.getState());
  if (pendingName !== null) body.name = pendingName;
  dataDirty = false;
  pendingName = null;
  set({ status: 'saving', error: null });

  inFlight = (async () => {
    try {
      const saved = await planApi.update(planId, body);
      if (usePlanSync.getState().planId !== planId) return;
      const more = dataDirty || pendingName !== null;
      set({ version: saved.version, savedAt: saved.updatedAt, status: more ? 'pending' : 'saved' });
      if (more) schedule(SAVE_DELAY);
    } catch (error) {
      // Nothing was saved: put the changes back so the next attempt sends them.
      dataDirty ||= sentData;
      if (pendingName === null) pendingName = sentName;
      if (usePlanSync.getState().planId !== planId) return;
      if (error instanceof ApiError && error.code === 'version_conflict') {
        set({ status: 'conflict', conflictVersion: Number(error.detail.currentVersion) });
      } else if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
        // Deleted plan, invalid data, session over (api() has already tried to refresh it):
        // repeating will not help.
        set({ status: 'error', error: error.status === 404 ? 'Схема удалена' : error.message });
      } else {
        set({ status: 'error', error: errorMessage(error) });
        schedule(RETRY_DELAY);
      }
    } finally {
      inFlight = null;
    }
  })();
  await inFlight;
}

/** Conflict: overwrite the server version with what is on screen (contents and name). */
export async function keepLocalVersion(): Promise<void> {
  const { conflictVersion, name } = usePlanSync.getState();
  if (conflictVersion === null) return;
  dataDirty = true;
  pendingName = name;
  set({ version: conflictVersion, conflictVersion: null, status: 'pending' });
  await flush();
}

/** Conflict: drop local changes and load the version from the server. */
export async function loadServerVersion(): Promise<void> {
  const { planId } = usePlanSync.getState();
  if (!planId) return;
  const record = await planApi.get(planId);
  applyingRemote = true;
  try {
    useStore.getState().openPlan(record.data);
  } finally {
    applyingRemote = false;
  }
  dataDirty = false;
  pendingName = null;
  set({
    name: record.name,
    version: record.version,
    savedAt: record.updatedAt,
    status: 'saved',
    error: null,
    conflictVersion: null,
  });
}

export function hasUnsavedChanges(): boolean {
  return usePlanSync.getState().status !== 'saved';
}
