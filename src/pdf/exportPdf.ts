import { Vector3 } from 'three';
import robotoMedium from 'pdfmake/fonts/Roboto/Roboto-Medium.ttf?url';
import robotoRegular from 'pdfmake/fonts/Roboto/Roboto-Regular.ttf?url';
import type { Box, CargoItem, Plan } from '../core/types';
import { unionBoxes } from '../core/geometry';
import { itemBox } from '../core/item';
import { DECK_HEIGHT, computeLayout, vehicleBounds, type PlacedBody, type VehicleLayout } from '../core/layout';
import { loadingSteps, type LoadDirection } from '../core/loadingOrder';
import { vehiclePlan } from '../core/plan';
import { cargoRows, summarizeLoad } from '../core/report';
import { classify } from '../core/stats';
import type { Units } from '../core/units';
import { safeFileName, saveBlob } from '../lib/planFiles';
import { printWidths, reportDocument, type PdfOrientation, type ReportSection, type ReportStep } from './document';
import { SnapshotRenderer, type Projection, type Shot, type Snapshot } from './snapshot';

export type PdfMode = 'overview' | 'steps';

export interface PdfOptions {
  fileName: string;
  orientation: PdfOrientation;
  /** Overview: views and tables; steps: the same plus loading instructions. */
  mode: PdfMode;
  /** Only for the steps. */
  direction: LoadDirection;
  projection: Projection;
}

export interface PdfSource {
  name: string;
  plan: Plan;
  /** Vehicles to report on, in this order: one section each. */
  vehicleIds: string[];
  units: Units;
  highlightOverflow: boolean;
}

/** Cargo loaded in earlier steps. */
const DONE_COLOR = '#cfd5dd';
const UP = new Vector3(0, 1, 0);

/** Step views look at the body from above and from the side the cargo comes in (rear: from the rear right). */
const STEP_VIEWS: Record<LoadDirection, Vector3> = {
  rear: new Vector3(-0.5, 0.85, 1),
  right: new Vector3(-0.25, 0.9, 1),
  left: new Vector3(-0.25, 0.9, -1),
  top: new Vector3(-0.3, 1.6, 0.6),
};

/** Builds the report and saves it as `<fileName>.pdf`. `onProgress(done, total)` follows the images. */
export async function exportPdf(source: PdfSource, options: PdfOptions, onProgress?: (done: number, total: number) => void): Promise<void> {
  const blob = await buildPdf(source, options, onProgress);
  saveBlob(blob, `${safeFileName(options.fileName || source.name, 'loader3d-plan')}.pdf`);
}

export async function buildPdf(
  source: PdfSource,
  options: PdfOptions,
  onProgress: (done: number, total: number) => void = () => {},
): Promise<Blob> {
  const library = loadPdfMake();
  // Each vehicle on its own, moved to Z = 0: the views and tables below are made for one vehicle.
  const parts = source.vehicleIds.map((id) => {
    const plan = vehiclePlan(source.plan, id);
    const layout = computeLayout(plan.vehicles, plan.dockMode);
    const steps = options.mode === 'steps' ? loadingSteps(plan.items, layout, options.direction) : [];
    return { plan, layout, steps };
  });
  const total = parts.reduce((sum, p) => sum + 2 + p.steps.length, 0);
  let done = 0;
  const tick = async () => {
    onProgress(++done, total);
    // Let the dialog repaint between renders.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const sections: ReportSection[] = [];
  for (const part of parts) sections.push(await section(part, source, options, tick));
  const single = sections.length === 1 && source.plan.vehicles.length > 1;
  const doc = reportDocument({
    title: single ? `${source.name} — ${sections[0].vehicleName}` : source.name,
    date: new Date(),
    units: source.units,
    orientation: options.orientation,
    sections,
  });
  return (await library).createPdf(doc).getBlob();
}

/** Views, tables and steps of one vehicle. */
async function section(
  { plan, layout, steps }: { plan: Plan; layout: VehicleLayout; steps: ReturnType<typeof loadingSteps> },
  source: PdfSource,
  options: PdfOptions,
  tick: () => Promise<void>,
): Promise<ReportSection> {
  const loaded = plan.items.filter((item) => classify(itemBox(item), layout).status !== 'dock');
  const print = printWidths(options.orientation);
  const renderer = new SnapshotRenderer(layout, source.highlightOverflow);
  let views: { top: Snapshot; side: Snapshot };
  const stepList: ReportStep[] = [];
  try {
    const ortho = options.projection === 'orthographic';
    const base: Omit<Shot, 'direction' | 'up'> = {
      items: loaded,
      bounds: overviewBounds(layout, loaded),
      projection: options.projection,
      width: 1400,
      printWidth: print.content,
      labels: new Set(loaded.map((item) => item.id)),
      format: 'png',
    };
    const top = renderer.render({ ...base, direction: new Vector3(0, 1, 0), up: new Vector3(0, 0, -1), rulers: ortho ? 'top' : undefined });
    await tick();
    // A perspective side view looks slightly from above, like the editor's «Сбоку».
    const side = renderer.render({ ...base, direction: new Vector3(0, ortho ? 0 : 0.16, 1), up: UP, rulers: ortho ? 'side' : undefined });
    await tick();
    views = { top, side };

    const byId = new Map(plan.items.map((item) => [item.id, item]));
    const placed: CargoItem[] = [];
    for (const step of steps) {
      const pb = layout.bodies.find((b) => b.body.id === step.bodyId)!;
      const current = step.itemIds.map((id) => byId.get(id)!);
      const inBody = loaded.filter((item) => classify(itemBox(item), layout).body === pb);
      const image = renderer.render({
        items: [...placed.map((item) => ({ ...item, color: DONE_COLOR })), ...current],
        bounds: unionBoxes([stepFrame(layout, pb), ...inBody.map(itemBox)])!,
        direction: STEP_VIEWS[options.direction],
        up: UP,
        projection: options.projection,
        // A long lens: the front wall stays almost as large as the doors.
        fov: 18,
        width: 560,
        printWidth: print.step,
        aspect: 2.2,
        labels: new Set(step.itemIds),
        format: 'jpeg',
      });
      placed.push(...current);
      stepList.push({ bodyName: pb.body.name, image, items: current });
      await tick();
    }
  } finally {
    renderer.dispose();
  }

  return {
    vehicleName: plan.vehicles[0].name,
    bodies: plan.vehicles[0].bodies,
    summary: summarizeLoad(plan.items, layout),
    rows: cargoRows(plan.items, layout),
    views,
    steps: options.mode === 'steps' ? { direction: options.direction, list: stepList } : undefined,
  };
}

/** A step shows its body with wheels, and the cab behind the first one. */
function stepFrame(layout: VehicleLayout, pb: PlacedBody): Box {
  const halfWidth = Math.max(pb.box.max.z, 125);
  const front = pb.index === 0 ? vehicleBounds(layout.vehicles[0]).max.x : pb.box.max.x;
  return { min: { x: pb.box.min.x, y: -DECK_HEIGHT, z: -halfWidth }, max: { x: front, y: pb.box.max.y, z: halfWidth } };
}

/** The vehicle with its wheels and cab, and any cargo sticking out of it. */
function overviewBounds(layout: VehicleLayout, items: readonly CargoItem[]): Box {
  const vb = vehicleBounds(layout.vehicles[0]);
  const halfWidth = Math.max(vb.max.z, 125) + 5; // the cab is a little wider than the bodies
  const vehicle: Box = { min: { x: vb.min.x, y: -DECK_HEIGHT, z: -halfWidth }, max: { ...vb.max, z: halfWidth } };
  return unionBoxes([vehicle, ...items.map(itemBox)])!;
}

type PdfMake = typeof import('pdfmake/build/pdfmake');

let pdfMake: Promise<PdfMake> | null = null;

/** pdfmake (~1 MB) and its Roboto fonts (Cyrillic) load only when the first PDF is made. */
function loadPdfMake(): Promise<PdfMake> {
  pdfMake ??= import('pdfmake/build/pdfmake')
    .then((mod) => {
      // The UMD build may come wrapped in one or two `default`s depending on the bundler's interop.
      let lib = mod as unknown as { createPdf?: unknown; default?: unknown };
      while (!lib.createPdf && lib.default) lib = lib.default as typeof lib;
      const instance = lib as unknown as PdfMake;
      const url = (path: string) => new URL(path, window.location.href).href;
      instance.setFonts({
        Roboto: { normal: url(robotoRegular), bold: url(robotoMedium), italics: url(robotoRegular), bolditalics: url(robotoMedium) },
      });
      // Images are data URLs; the only thing ever fetched is the fonts from our own origin.
      instance.setUrlAccessPolicy((target) => new URL(target).origin === window.location.origin);
      return instance;
    })
    .catch((error: unknown) => {
      pdfMake = null;
      throw error;
    });
  return pdfMake;
}
