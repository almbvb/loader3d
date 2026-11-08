import type { Plan } from '../core/types';

/** Wire types of the backend (backend/app/schemas). Field names are camelCase on the wire. */

/** Subscription tiers (backend/app/tiers.py); names, prices and texts — src/lib/tiers.ts. */
export type TierId = 'free' | 'pro' | 'custom';

export interface TierLimits {
  /** Saved plans; null — unlimited. */
  plans: number | null;
  /** Vehicles and cargo items in one plan. */
  vehicles: number;
  items: number;
  autoload: boolean;
  pdfSteps: boolean;
}

export interface Subscription {
  /** The tier that applies now (an expired paid tier is "free"). */
  tier: TierId;
  name: string;
  expiresAt: string | null;
  trial: boolean;
  trialAvailable: boolean;
  /** A paid tier that has ended and works as "free" until renewed. */
  expiredTier: TierId | null;
  limits: TierLimits;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  isAdmin: boolean;
  /** Editor display settings as last saved; null — never changed. */
  settings: Record<string, unknown> | null;
  /** null when tiers are off (TIERS_ENABLED): nothing is limited. */
  subscription: Subscription | null;
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

/** A request from the landing page or the account page. */
export interface LeadInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
  message?: string;
  tier?: TierId;
  /** Honeypot: stays empty for people. */
  website?: string;
}

// ------------------------------------------------------------------ admin panel

/** «Индивидуальный» limits; null / missing — no limit. */
export interface CustomLimits {
  plans?: number | null;
  vehicles?: number | null;
  items?: number | null;
}

export interface AdminSubscription {
  tier: TierId;
  effectiveTier: TierId;
  expiresAt: string | null;
  trial: boolean;
  trialUsed: boolean;
  limits: CustomLimits | null;
  note: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
  planCount: number;
  sessionCount: number;
  /** null when tiers are off. */
  subscription: AdminSubscription | null;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type AdminUserSort = 'createdAt' | '-createdAt' | 'email' | '-lastActiveAt';
export type AdminUserStatus = 'active' | 'blocked' | 'admins';

export interface AdminStats {
  users: number;
  newLast7Days: number;
  activeLast7Days: number;
  blocked: number;
  admins: number;
  /** null when tiers are off. */
  byTier: Record<TierId, number> | null;
  plans: number;
  newLeads: number;
}

export interface SubscriptionInput {
  tier: TierId;
  expiresAt: string | null;
  trial: boolean;
  limits: CustomLimits | null;
  note: string | null;
}

export type LeadStatus = 'new' | 'done';

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  message: string | null;
  tier: TierId | null;
  status: LeadStatus;
  userId: string | null;
  createdAt: string;
}
