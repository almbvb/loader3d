import type { Dims } from './types';

export type Units = 'mm' | 'cm' | 'm';

export const UNIT_LABEL: Record<Units, string> = { mm: 'мм', cm: 'см', m: 'м' };

/** Values are stored in centimetres; these convert them for display. */
const FACTOR: Record<Units, number> = { mm: 10, cm: 1, m: 0.01 };
const DIGITS: Record<Units, number> = { mm: 0, cm: 1, m: 3 };

export function toUnits(cm: number, units: Units): number {
  return cm * FACTOR[units];
}

export function fromUnits(value: number, units: Units): number {
  return value / FACTOR[units];
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(digits: number, grouping: boolean): Intl.NumberFormat {
  const key = `${digits}:${grouping}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, useGrouping: grouping });
    formatters.set(key, f);
  }
  return f;
}

/** Number for an input field: no grouping, decimal comma. */
export function formatPlain(cm: number, units: Units): string {
  return formatter(DIGITS[units], false).format(toUnits(cm, units));
}

export function formatLength(cm: number, units: Units, withUnit = true): string {
  const text = formatter(DIGITS[units], true).format(toUnits(cm, units));
  return withUnit ? `${text} ${UNIT_LABEL[units]}` : text;
}

/** «80 × 150 × 120 см» — width × height × length, the order used in the cargo form. */
export function formatDims(d: Dims, units: Units): string {
  const f = (cm: number) => formatLength(cm, units, false);
  return `${f(d.w)} × ${f(d.h)} × ${f(d.l)} ${UNIT_LABEL[units]}`;
}

export function formatVolume(cm3: number): string {
  return `${formatter(1, true).format(cm3 / 1e6)} м³`;
}

export function formatMeters(m: number): string {
  return `${formatter(1, true).format(m)} м`;
}

/** «450 кг» below a tonne, «12,4 т» from a tonne up. */
export function formatWeight(kg: number): string {
  if (Math.abs(kg) < 1000) return `${formatter(0, true).format(kg)} кг`;
  return `${formatter(kg < 10000 ? 2 : 1, true).format(kg / 1000)} т`;
}

export function formatPercent(fraction: number): string {
  return `${formatter(0, false).format(fraction * 100)}%`;
}

/** Accepts both "12.5" and "12,5"; ignores spaces. */
export function parseNumber(text: string): number | null {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
