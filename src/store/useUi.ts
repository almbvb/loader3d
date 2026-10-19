import { create } from 'zustand';
import type { PdfOptions } from '../pdf/exportPdf';

/** Report settings other than the file name: kept while the app is open. */
export type PdfPreferences = Omit<PdfOptions, 'fileName'>;

/** Transient editor UI state that is not part of the plan. */
interface UiState {
  helpOpen: boolean;
  /** Desktop: the floating cargo panel is hidden to see the whole scene. */
  panelHidden: boolean;
  /** Phones and tablets: the cargo panel as a drawer. */
  drawerOpen: boolean;
  vehicleCollapsed: boolean;
  addFormCollapsed: boolean;
  autoloadOpen: boolean;
  pdfOpen: boolean;
  pdfOptions: PdfPreferences;
  setHelpOpen(open: boolean): void;
  setPanelHidden(hidden: boolean): void;
  setDrawerOpen(open: boolean): void;
  setVehicleCollapsed(collapsed: boolean): void;
  setAddFormCollapsed(collapsed: boolean): void;
  setAutoloadOpen(open: boolean): void;
  setPdfOpen(open: boolean): void;
  setPdfOptions(patch: Partial<PdfPreferences>): void;
}

const narrow = () => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

export const useUi = create<UiState>()((set) => ({
  helpOpen: false,
  panelHidden: false,
  drawerOpen: false,
  vehicleCollapsed: narrow(),
  addFormCollapsed: false,
  autoloadOpen: false,
  pdfOpen: false,
  pdfOptions: { orientation: 'landscape', mode: 'overview', direction: 'rear', projection: 'orthographic' },
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  setPanelHidden: (panelHidden) => set({ panelHidden }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setVehicleCollapsed: (vehicleCollapsed) => set({ vehicleCollapsed }),
  setAddFormCollapsed: (addFormCollapsed) => set({ addFormCollapsed }),
  setAutoloadOpen: (autoloadOpen) => set({ autoloadOpen }),
  setPdfOpen: (pdfOpen) => set({ pdfOpen }),
  setPdfOptions: (patch) => set((s) => ({ pdfOptions: { ...s.pdfOptions, ...patch } })),
}));
