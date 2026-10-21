import type { Plan } from '../core/types';

/** Wire types of the backend (backend/app/schemas). Field names are camelCase on the wire. */

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: 'bearer';
  expiresIn: number;
  user: User;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
  current: boolean;
}

export interface PlanSummary {
  id: string;
  name: string;
  version: number;
  vehicleCount: number;
  bodyCount: number;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlanRecord extends PlanSummary {
  data: Plan;
}

export interface PlanPage {
  items: PlanSummary[];
  total: number;
  limit: number;
  offset: number;
}

export type PlanSort = 'updatedAt' | '-updatedAt' | 'createdAt' | '-createdAt' | 'name' | '-name';
