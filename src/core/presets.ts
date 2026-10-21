import type { CargoBody, Dims } from './types';

export type BodyTemplate = Omit<CargoBody, 'id'>;

export interface VehiclePreset {
  id: string;
  name: string;
  bodies: BodyTemplate[];
}

export const VEHICLE_PRESETS: VehiclePreset[] = [
  {
    id: 'tent',
    name: 'Еврофура 13,6 м (тент)',
    bodies: [{ kind: 'semi', name: 'Полуприцеп', dims: { l: 1360, w: 245, h: 270 }, maxLoad: 20000 }],
  },
  {
    id: 'mega',
    name: 'Мега-трейлер 13,6 м',
    bodies: [{ kind: 'semi', name: 'Полуприцеп', dims: { l: 1360, w: 248, h: 300 }, maxLoad: 20000 }],
  },
  {
    id: 'reefer',
    name: 'Рефрижератор 13,4 м',
    bodies: [{ kind: 'semi', name: 'Рефрижератор', dims: { l: 1340, w: 246, h: 260 }, maxLoad: 20000 }],
  },
  {
    id: 'jumbo',
    name: 'Сцепка 7,7 + 8,2 м',
    bodies: [
      { kind: 'truck', name: 'Грузовик', dims: { l: 770, w: 245, h: 300 }, maxLoad: 10000 },
      { kind: 'trailer', name: 'Прицеп', dims: { l: 820, w: 245, h: 300 }, maxLoad: 10000 },
    ],
  },
  {
    id: 'c40',
    name: "Контейнер 40' HC",
    bodies: [{ kind: 'semi', name: "Контейнер 40'", dims: { l: 1203, w: 235, h: 269 }, maxLoad: 26500 }],
  },
  {
    id: 'c20',
    name: "Контейнер 20'",
    bodies: [{ kind: 'semi', name: "Контейнер 20'", dims: { l: 590, w: 235, h: 239 }, maxLoad: 21700 }],
  },
  {
    id: 'truck10',
    name: 'Грузовик 10 т',
    bodies: [{ kind: 'truck', name: 'Кузов', dims: { l: 800, w: 245, h: 260 }, maxLoad: 10000 }],
  },
  {
    id: 'van',
    name: 'Фургон 3 т',
    bodies: [{ kind: 'truck', name: 'Фургон', dims: { l: 420, w: 205, h: 200 }, maxLoad: 3000 }],
  },
];

export const DEFAULT_TRAILER: BodyTemplate = {
  kind: 'trailer',
  name: 'Прицеп',
  dims: { l: 820, w: 245, h: 270 },
  maxLoad: 10000,
};

export const MAX_BODIES = 3;
/** Vehicles in one plan. */
export const MAX_VEHICLES = 10;

export const BODY_LIMITS: Record<keyof Dims, [number, number]> = {
  l: [100, 2500],
  w: [100, 400],
  h: [100, 450],
};

/** Payload capacity of a body, kg. */
export const BODY_MAX_LOAD_LIMIT = 60000;
/** Weight of one cargo item, kg. */
export const ITEM_WEIGHT_LIMIT = 30000;

export interface CargoPreset {
  name: string;
  dims: Dims;
  /** Typical gross weight, kg. */
  weight: number;
}

export const CARGO_PRESETS: CargoPreset[] = [
  { name: 'Европаллета', dims: { l: 120, w: 80, h: 150 }, weight: 400 },
  { name: 'Финпаллета', dims: { l: 120, w: 100, h: 150 }, weight: 500 },
  { name: 'Полупаллета', dims: { l: 80, w: 60, h: 100 }, weight: 200 },
  { name: 'IBC-куб', dims: { l: 120, w: 100, h: 116 }, weight: 1000 },
  { name: 'Коробка', dims: { l: 60, w: 40, h: 40 }, weight: 20 },
];

export const CARGO_COLORS = [
  '#f0a35e',
  '#5b8def',
  '#4fbf8b',
  '#e7738a',
  '#9b87f5',
  '#e2bd3f',
  '#45b8cf',
  '#c98a5b',
  '#86b33f',
  '#f07f5c',
];
