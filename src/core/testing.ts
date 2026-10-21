import type { CargoBody, DockMode, Vehicle } from './types';
import { computeLayout, type VehicleLayout } from './layout';

/** Test helpers shared by the core tests. */

export function vehicle(bodies: CargoBody[], id = 'v1'): Vehicle {
  return { id, name: id, bodies };
}

/** Layout of a single vehicle with these bodies. */
export function layoutOf(bodies: CargoBody[], dockMode: DockMode = 'shared'): VehicleLayout {
  return computeLayout([vehicle(bodies)], dockMode);
}
