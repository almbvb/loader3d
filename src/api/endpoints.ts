import type { Plan } from '../core/types';
import { api } from './client';
import type {
  AdminStats,
  AdminUser,
  AdminUserSort,
  AdminUserStatus,
  AuthResponse,
  Lead,
  LeadInput,
  LeadStatus,
  Page,
  PlanPage,
  PlanRecord,
  PlanSort,
  SessionInfo,
  SubscriptionInput,
  TierId,
  User,
} from './types';

/** One function per backend endpoint (see README → «Бэкенд»). */

export const authApi = {
  login: (email: string, password: string) =>
    api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (email: string, password: string, displayName?: string, tier: 'free' | 'pro' = 'free') =>
    api<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { email, password, displayName: displayName || undefined, tier },
      auth: false,
    }),
  logout: () => api<void>('/auth/logout', { method: 'POST', auth: false }),
  sessions: () => api<SessionInfo[]>('/auth/sessions'),
  revokeSession: (id: string) => api<void>(`/auth/sessions/${id}`, { method: 'DELETE' }),
  revokeOtherSessions: () => api<void>('/auth/sessions', { method: 'DELETE' }),
};

export const userApi = {
  me: () => api<User>('/users/me'),
  update: (displayName: string) => api<User>('/users/me', { method: 'PATCH', body: { displayName } }),
  /** Partial: only the given settings change. Returns everything saved. */
  updateSettings: (settings: Record<string, unknown>) =>
    api<Record<string, unknown>>('/users/me/settings', { method: 'PATCH', body: settings }),
  startTrial: () => api<User>('/users/me/trial', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<void>('/users/me/password', { method: 'POST', body: { currentPassword, newPassword } }),
  deleteAccount: (password: string) => api<void>('/users/me', { method: 'DELETE', body: { password } }),
};

export interface PlanListQuery {
  q?: string;
  sort?: PlanSort;
  limit?: number;
  offset?: number;
}

export const planApi = {
  list: (query: PlanListQuery, signal?: AbortSignal) =>
    api<PlanPage>('/plans', { query: { ...query }, signal }),
  get: (id: string) => api<PlanRecord>(`/plans/${id}`),
  create: (name: string, data?: Plan) => api<PlanRecord>('/plans', { method: 'POST', body: { name, data } }),
  update: (id: string, body: { version: number; name?: string; data?: Plan }) =>
    api<PlanRecord>(`/plans/${id}`, { method: 'PATCH', body }),
  duplicate: (id: string, name?: string) =>
    api<PlanRecord>(`/plans/${id}/duplicate`, { method: 'POST', body: { name } }),
  remove: (id: string) => api<void>(`/plans/${id}`, { method: 'DELETE' }),
};

/** Public: works with or without a login (a logged-in user is linked to the request). */
export const leadApi = {
  create: (lead: LeadInput) => api<void>('/leads', { method: 'POST', body: lead }),
};

export interface AdminUserQuery {
  q?: string;
  tier?: TierId;
  status?: AdminUserStatus;
  sort?: AdminUserSort;
  limit?: number;
  offset?: number;
}

export const adminApi = {
  stats: () => api<AdminStats>('/admin/stats'),
  users: (query: AdminUserQuery, signal?: AbortSignal) =>
    api<Page<AdminUser>>('/admin/users', { query: { ...query }, signal }),
  createUser: (body: {
    email: string;
    password: string;
    displayName?: string;
    isAdmin: boolean;
    tier: TierId;
    expiresAt: string | null;
  }) => api<AdminUser>('/admin/users', { method: 'POST', body }),
  updateUser: (id: string, body: { displayName?: string; isActive?: boolean; isAdmin?: boolean }) =>
    api<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', body }),
  setSubscription: (id: string, body: SubscriptionInput) =>
    api<AdminUser>(`/admin/users/${id}/subscription`, { method: 'PUT', body }),
  resetPassword: (id: string, newPassword: string) =>
    api<void>(`/admin/users/${id}/password`, { method: 'POST', body: { newPassword } }),
  endSessions: (id: string) => api<void>(`/admin/users/${id}/sessions`, { method: 'DELETE' }),
  deleteUser: (id: string) => api<void>(`/admin/users/${id}`, { method: 'DELETE' }),
  leads: (query: { status?: LeadStatus; limit?: number; offset?: number }, signal?: AbortSignal) =>
    api<Page<Lead>>('/admin/leads', { query: { ...query }, signal }),
  updateLead: (id: string, status: LeadStatus) =>
    api<Lead>(`/admin/leads/${id}`, { method: 'PATCH', body: { status } }),
  deleteLead: (id: string) => api<void>(`/admin/leads/${id}`, { method: 'DELETE' }),
};
