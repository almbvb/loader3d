import type { Column, Content, CustomTableLayout, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { CargoBody, CargoItem } from '../core/types';
import type { LoadDirection } from '../core/loadingOrder';
import { formatSeqList, type BodySummary, type CargoRow, type LoadSummary } from '../core/report';
import { COG_LAT_TOLERANCE, COG_LONG_TOLERANCE } from '../core/stats';
import { formatDims, formatLength, formatMeters, formatPercent, formatVolume, formatWeight, type Units } from '../core/units';
import { plural } from '../lib/format';
import { COLORS } from '../scene/theme';
import type { Snapshot } from './snapshot';

export type PdfOrientation = 'landscape' | 'portrait';

export interface ReportStep {
  bodyName: string;
  image: Snapshot;
  items: CargoItem[];
}

export interface ReportData {
  title: string;
  date: Date;
  units: Units;
  orientation: PdfOrientation;
  bodies: CargoBody[];
  summary: LoadSummary;
  rows: CargoRow[];
  views: { top: Snapshot; side: Snapshot };
  steps?: { direction: LoadDirection; list: ReportStep[] };
}

const TEXT = '#1f2937';
const MUTED = '#667185';
const LINE = '#e1e6ee';
const HEAD_FILL = '#f3f5f8';
const ZEBRA = '#fafbfc';
const SUCCESS = '#12935a';
const WARNING = '#d97706';
const DANGER = COLORS.danger;

const MARGIN_X = 36;
const MARGIN_TOP = 92;
const MARGIN_BOTTOM = 46;
const A4 = { width: 595.28, height: 841.89 };

const ITEMS = ['груз', 'груза', 'грузов'] as const;

export const DIRECTION_TEXT: Record<LoadDirection, string> = {
  rear: 'сзади',
  right: 'сбоку справа',
  left: 'сбоку слева',
  top: 'сверху',
};

/** The lucide "Boxes" icon of the app logo. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<rect width="32" height="32" rx="7" fill="${COLORS.accent}"/>
<g transform="translate(4 4)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
<path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z"/>
<path d="m7 16.5-4.74-2.85"/><path d="m7 16.5 5-3"/><path d="M7 16.5v5.17"/>
<path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z"/>
<path d="m17 16.5-5-3"/><path d="m17 16.5 4.74-2.85"/><path d="M17 16.5v5.17"/>
<path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z"/>
<path d="M12 8 7.26 5.15"/><path d="m12 8 4.74-2.85"/><path d="M12 13.5V8"/>
</g></svg>`;

/** «Полуприцеп 13,6 × 2,45 × 2,7 м · 20 т · 90 м³» for every body, joined with «+». */
export function vehicleSummary(bodies: readonly CargoBody[]): string {
  return bodies
    .map((b) => {
      const m = (cm: number) => formatLength(cm, 'm', false);
      const parts = [`${b.name} ${m(b.dims.l)} × ${m(b.dims.w)} × ${m(b.dims.h)} м`];
      if (b.maxLoad !== undefined) parts.push(formatWeight(b.maxLoad));
      parts.push(formatVolume(b.dims.l * b.dims.w * b.dims.h));
      return parts.join(' · ');
    })
    .join(' + ');
}

const STEP_GAP = 14;

/** Printed widths, pt: of the page content and of a step card (3 per row in landscape, 2 in portrait). */
export function printWidths(orientation: PdfOrientation): { content: number; step: number; columns: number } {
  const page = orientation === 'landscape' ? A4.height : A4.width;
  const content = page - MARGIN_X * 2;
  const columns = orientation === 'landscape' ? 3 : 2;
  return { content, step: (content - STEP_GAP * (columns - 1)) / columns, columns };
}

/** pdfmake document of the load plan report. */
export function reportDocument(data: ReportData): TDocumentDefinitions {
  const page = data.orientation === 'landscape' ? { width: A4.height, height: A4.width } : A4;
  const contentWidth = page.width - MARGIN_X * 2;
  const contentHeight = page.height - MARGIN_TOP - MARGIN_BOTTOM;
  const date = new Intl.DateTimeFormat('ru-RU').format(data.date);
  const vehicle = vehicleSummary(data.bodies);

  const content: Content[] = [
    overview(data, contentWidth, contentHeight),
    // Landscape views fill the first page; in portrait the list fits under them.
    heading('Список мест', data.orientation === 'landscape'),
    cargoTable(data),
    ...totals(data),
    // Small tables stay on one page together with their heading.
    {
      stack: [heading('Развесовка'), weightTable(data.summary.bodies), { text: cogNote(), fontSize: 8, color: MUTED, margin: [0, 6, 0, 0] }],
      unbreakable: true,
    },
  ];
  if (data.steps) content.push(...steps(data.steps, data.bodies.length > 1, data.orientation, data.units));

  return {
    pageSize: 'A4',
    pageOrientation: data.orientation,
    pageMargins: [MARGIN_X, MARGIN_TOP, MARGIN_X, MARGIN_BOTTOM],
    info: { title: data.title, creator: 'Loader3D', producer: 'Loader3D', creationDate: data.date },
    language: 'ru-RU',
    defaultStyle: { font: 'Roboto', fontSize: 9, color: TEXT, lineHeight: 1.15 },
    header: (_page, _pages, size) => ({
      margin: [MARGIN_X, 26, MARGIN_X, 0],
      stack: [
        {
          columns: [
            { svg: LOGO_SVG, width: 18, height: 18 },
            { text: 'Loader3D', fontSize: 15, margin: [7, 0, 0, 0], width: 'auto' },
            { text: date, fontSize: 8, color: MUTED, alignment: 'right', margin: [0, 5, 0, 0] },
          ],
          columnGap: 0,
        },
        {
          columns: [
            { text: data.title, fontSize: 11, width: '*' },
            { text: vehicle, fontSize: 8, color: MUTED, alignment: 'right', width: 'auto', margin: [12, 2, 0, 0] },
          ],
          margin: [0, 9, 0, 0],
        },
        { canvas: [{ type: 'line', x1: 0, y1: 7, x2: size.width - MARGIN_X * 2, y2: 7, lineWidth: 0.75, lineColor: LINE }] },
      ],
    }),
    footer: (current, total) => ({
      margin: [MARGIN_X, 16, MARGIN_X, 0],
      columns: [
        { text: 'Loader3D · план загрузки', fontSize: 8, color: MUTED },
        { text: `Страница ${current} из ${total}`, fontSize: 8, color: MUTED, alignment: 'right' },
      ],
    }),
    content,
  };
}

/** First page: the vehicle from above and from the side, scaled together to fit the page. */
function overview(data: ReportData, contentWidth: number, contentHeight: number): Content {
  const { top, side } = data.views;
  const notes = loadNotes(data.summary);
  const reserved = 30 + 2 * 24 + notes.length * 14;
  const natural = contentWidth * (top.height / top.width + side.height / side.width);
  const scale = Math.min(1, (contentHeight - reserved) / natural);
  const view = (shot: Snapshot, caption: string): Content => ({
    stack: [
      { image: shot.dataUrl, width: contentWidth * scale, alignment: 'center' },
      { text: caption, color: MUTED, fontSize: 9, alignment: 'center', margin: [0, 3, 0, 12] },
    ],
    unbreakable: true,
  });
  return {
    stack: [
      { text: 'Общий вид груза', color: MUTED, fontSize: 10, alignment: 'center', margin: [0, 2, 0, 10] },
      view(top, 'Сверху'),
      view(side, 'Сбоку'),
      ...notes.map((n): Content => ({ text: n.text, color: n.color, fontSize: 9, alignment: 'center', margin: [0, 0, 0, 4] })),
    ],
  };
}

function loadNotes(summary: LoadSummary): Array<{ text: string; color: string }> {
  const notes: Array<{ text: string; color: string }> = [];
  if (summary.overflow > 0) {
    notes.push({ text: `За габаритами кузова: ${plural(summary.overflow, ITEMS)} — исправьте раскладку перед загрузкой.`, color: DANGER });
  }
  if (summary.dock > 0) {
    const weight = summary.dockWeight > 0 ? ` (${formatWeight(summary.dockWeight)})` : '';
    notes.push({ text: `На доке осталось ${plural(summary.dock, ITEMS)}${weight} — в план загрузки они не входят.`, color: WARNING });
  }
  return notes;
}

/** Section title with a short rule under it, as wide as the text. */
function heading(text: string, newPage = false, margin: [number, number, number, number] = [0, 14, 0, 12]): Content {
  return {
    table: { widths: ['auto'], body: [[{ text, fontSize: 12 }]] },
    layout: {
      hLineWidth: (i) => (i === 1 ? 0.75 : 0),
      vLineWidth: () => 0,
      hLineColor: () => '#c5ccd6',
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 0,
      paddingBottom: () => 2,
    },
    margin,
    pageBreak: newPage ? 'before' : undefined,
  };
}

const gridLayout: CustomTableLayout = {
  hLineWidth: () => 0.5,
  vLineWidth: () => 0.5,
  hLineColor: () => LINE,
  vLineColor: () => LINE,
  fillColor: (row) => (row === 0 ? HEAD_FILL : row % 2 === 0 ? ZEBRA : null),
  paddingLeft: () => 6,
  paddingRight: () => 6,
  paddingTop: () => 6,
  paddingBottom: () => 6,
};

const head = (text: string, alignment: 'left' | 'center' = 'center'): TableCell => ({ text, color: '#4b5563', alignment });
const cell = (text: string, extra: Record<string, unknown> = {}): TableCell => ({ text, alignment: 'center', ...extra });

function swatch(color: string): TableCell {
  return { canvas: [{ type: 'rect', x: 0, y: 1, w: 10, h: 10, r: 2, color }], alignment: 'center', margin: [5, 0, 0, 0] };
}

function cargoTable(data: ReportData): Content {
  const bodyName = new Map(data.bodies.map((b) => [b.id, b.name]));
  const place = (row: CargoRow): TableCell => {
    if (row.status === 'dock') return cell('Док, не загружен', { color: WARNING });
    const name = bodyName.get(row.bodyId ?? '') ?? '';
    return row.status === 'overflow' ? cell(`${name}, за габаритами`, { color: DANGER }) : cell(name);
  };
  const body: TableCell[][] = [
    [head('№'), head('Цвет'), head('Название', 'left'), head('Размеры (Ш × В × Д)'), head('Масса брутто'), head('Кол-во'), head('Размещение')],
    ...data.rows.map((row): TableCell[] => [
      cell(formatSeqList(row.seqs)),
      swatch(row.color),
      { text: row.name },
      cell(formatDims(row.dims, data.units)),
      cell(row.weight !== undefined ? formatWeight(row.weight) : '—'),
      cell(String(row.count)),
      place(row),
    ]),
  ];
  if (data.rows.length === 0) {
    body.push([{ text: 'Грузов нет', colSpan: 7, alignment: 'center', color: MUTED }, {}, {}, {}, {}, {}, {}]);
  }
  return {
    table: { headerRows: 1, widths: [44, 30, '*', 'auto', 'auto', 'auto', 'auto'], body, dontBreakRows: true },
    layout: gridLayout,
  };
}

const area = (cm2: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(cm2 / 1e4)} м²`;
const metres = (cm: number) => formatLength(cm, 'm');

/** «Итог»: used / available / left per parameter, one table per body. */
function totals(data: ReportData): Content[] {
  const many = data.summary.bodies.length > 1;
  return data.summary.bodies.map(
    (b, i): Content => ({
      stack: [heading(many ? `Итог · ${b.name}` : 'Итог', false, [0, i === 0 ? 18 : 6, 0, 12]), summaryTable(b)],
      unbreakable: true,
    }),
  );
}

function summaryTable(b: BodySummary): Content {
  const left = (used: number, max: number, format: (v: number) => string): TableCell =>
    used > max + 1e-6 ? cell(`−${format(used - max)}`, { color: DANGER }) : cell(format(max - used));
  const rows: TableCell[][] = [
    [
      { text: 'Общая масса' },
      cell(formatWeight(b.weight)),
      cell(b.maxLoad !== undefined ? formatWeight(b.maxLoad) : '—'),
      b.maxLoad !== undefined ? left(b.weight, b.maxLoad, formatWeight) : cell('—'),
    ],
    [{ text: 'Количество мест' }, cell(`${b.count} шт`), cell('—'), cell('—')],
    [{ text: 'Общий объём' }, cell(formatVolume(b.used)), cell(formatVolume(b.capacity)), left(b.used, b.capacity, formatVolume)],
    [{ text: 'Площадь пола' }, cell(area(b.floorUsed)), cell(area(b.floorCapacity)), left(b.floorUsed, b.floorCapacity, area)],
    [{ text: 'Длина (от передней стенки)' }, cell(metres(b.length)), cell(metres(b.dims.l)), left(b.length, b.dims.l, metres)],
    [{ text: 'Ширина' }, cell(metres(b.width)), cell(metres(b.dims.w)), left(b.width, b.dims.w, metres)],
    [{ text: 'Высота' }, cell(metres(b.height)), cell(metres(b.dims.h)), left(b.height, b.dims.h, metres)],
  ];
  return {
    table: { headerRows: 1, widths: ['*', 110, 110, 110], body: [[head('Параметр'), head('Итого'), head('Макс.'), head('Остаток')], ...rows] },
    layout: { ...gridLayout, paddingTop: () => 5, paddingBottom: () => 5 },
  };
}

/** Weight per body and the centre of gravity against the limits of `core/stats.ts`. */
function weightTable(bodies: BodySummary[]): Content {
  const rows = bodies.map((b): TableCell[] => {
    const status: TableCell =
      b.cogFromFront === null
        ? cell('Вес не указан', { color: MUTED })
        : b.overweight
          ? cell('Перегруз', { color: DANGER })
          : b.balanced
            ? cell('В норме', { color: SUCCESS })
            : cell('ЦТ вне нормы', { color: WARNING });
    const offset = Math.round(b.cogOffset ?? 0);
    return [
      { text: b.name },
      cell(formatWeight(b.weight)),
      cell(b.maxLoad !== undefined ? formatWeight(b.maxLoad) : '—'),
      b.cogFromFront === null ? cell('—') : cell(`${formatMeters(b.cogFromFront * b.dims.l / 100)} · ${formatPercent(b.cogFromFront)}`),
      b.cogOffset === null ? cell('—') : cell(offset === 0 ? 'по оси' : `${Math.abs(offset)} см ${offset > 0 ? 'вправо' : 'влево'}`),
      status,
    ];
  });
  return {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [head('Кузов', 'left'), head('Масса груза'), head('Грузоподъёмность'), head('Центр тяжести от передней стенки'), head('Смещение от оси'), head('Оценка')],
        ...rows,
      ],
    },
    layout: { ...gridLayout, paddingTop: () => 5, paddingBottom: () => 5 },
  };
}

function cogNote(): string {
  const from = formatPercent(0.5 - COG_LONG_TOLERANCE);
  const to = formatPercent(0.5 + COG_LONG_TOLERANCE);
  return `Норма: центр тяжести груза — в пределах ${from}–${to} длины кузова от передней стенки и не дальше ${formatPercent(COG_LAT_TOLERANCE)} ширины от продольной оси.`;
}

/** Loading instructions: step cards in a grid, earlier cargo grey, the step's items in colour. */
function steps(data: NonNullable<ReportData['steps']>, showBody: boolean, orientation: PdfOrientation, units: Units): Content[] {
  const out: Content[] = [
    heading('Порядок загрузки', true),
    {
      text:
        `Загрузка ${DIRECTION_TEXT[data.direction]}. Сначала ставятся грузы, дальние от проёма, и нижние ярусы; ` +
        'уже загруженное показано серым, грузы шага — цветом и номером.',
      color: MUTED,
      margin: [0, 0, 0, 12],
    },
  ];
  if (data.list.length === 0) {
    out.push({ text: 'В кузове нет грузов — загружать нечего.', color: MUTED });
    return out;
  }
  const { step: width, columns } = printWidths(orientation);
  const card = (step: ReportStep, index: number): Column => ({
    width,
    stack: [
      { image: step.image.dataUrl, width },
      {
        text: [{ text: `Шаг ${index + 1}`, bold: true }, showBody ? { text: ` · ${step.bodyName}`, color: MUTED } : ''],
        margin: [0, 5, 0, 3],
      },
      ...step.items.map(
        (item): Content => ({
          columns: [
            { canvas: [{ type: 'rect', x: 0, y: 2.5, w: 7, h: 7, r: 1.5, color: item.color }], width: 11 },
            {
              text: [
                { text: `№${item.seq} ${item.name}` },
                { text: ` · ${formatDims(item.dims, units)}${item.weight !== undefined ? ` · ${formatWeight(item.weight)}` : ''}`, color: MUTED },
              ],
              fontSize: 8,
            },
          ],
          margin: [0, 0, 0, 1.5],
        }),
      ),
    ],
  });
  for (let i = 0; i < data.list.length; i += columns) {
    const row: Column[] = data.list.slice(i, i + columns).map((step, k) => card(step, i + k));
    while (row.length < columns) row.push({ width, text: '' });
    // Gap above rows, not below: a trailing margin can spill onto an empty page.
    out.push({ columns: row, columnGap: STEP_GAP, margin: [0, i === 0 ? 0 : 14, 0, 0], unbreakable: true });
  }
  return out;
}
