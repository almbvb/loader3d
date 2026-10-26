import type { AuthResponse } from './types';

/**
 * fetch wrapper for the backend (/api, same origin: Caddy in production, the Vite proxy in dev).
 *
 * The access token lives only in memory. The refresh token is an httpOnly cookie the browser sends
 * to /api/auth/* by itself. A 401 triggers one refresh (shared by all concurrent requests, skipped
 * when another request already refreshed while this one was in flight) and a retry; if the refresh
 * fails too, the session is over and `onSessionLost` fires.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** Validation errors by field (camelCase name from the request body), already in Russian. */
    readonly fieldErrors: Record<string, string> = {},
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshing: Promise<AuthResponse | null> | null = null;
let sessionLost: () => void = () => {};
let refreshed: (auth: AuthResponse) => void = () => {};

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function onSessionLost(handler: () => void): void {
  sessionLost = handler;
}

/** After every successful refresh. All tabs share the cookie, so it may be another account by now. */
export function onRefreshed(handler: (auth: AuthResponse) => void): void {
  refreshed = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  /** Send the access token and refresh it on 401 (false for login, register...). */
  auth?: boolean;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const sentToken = accessToken;
  const response = await send(path, options);
  if (response.status !== 401 || options.auth === false) return parse<T>(response);
  // Sent with a token that another request has replaced meanwhile: repeating it with the new one is
  // enough, a second refresh would only rotate the cookie again.
  if (accessToken === null || accessToken === sentToken) {
    if (!(await refreshSession())) {
      sessionLost();
      throw await toApiError(response);
    }
  }
  return parse<T>(await send(path, options));
}

/**
 * Exchanges the refresh cookie for a new access token; null means the session is over.
 * Network errors are thrown (being offline must not log the user out). Concurrent callers
 * share one request.
 */
export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const response = await send('/auth/refresh', { method: 'POST', auth: false });
      if (response.status === 401) {
        accessToken = null;
        return null;
      }
      if (!response.ok) throw await toApiError(response);
      const auth = (await response.json()) as AuthResponse;
      accessToken = auth.accessToken;
      refreshed(auth);
      return auth;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function send(path: string, { method = 'GET', body, query, auth = true, signal }: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && accessToken) headers.authorization = `Bearer ${accessToken}`;
  let url = `/api${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') params.set(key, String(value));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  return fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

interface ValidationIssue {
  type: string;
  loc: Array<string | number>;
  msg: string;
}

async function toApiError(response: Response): Promise<ApiError> {
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* not JSON: proxy error page, network hiccup */
  }
  const detail = (payload as { detail?: unknown } | null)?.detail;

  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of detail as ValidationIssue[]) {
      const field = issue.loc.length > 1 ? String(issue.loc[1]) : '';
      fieldErrors[field] ??= validationMessage(field, issue);
    }
    return new ApiError(response.status, 'validation_error', 'Проверьте введённые данные', fieldErrors);
  }
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const { code, message, ...rest } = detail as { code: string; message: string };
    return new ApiError(response.status, code, message, {}, rest);
  }
  if (response.status >= 500 || response.status === 0) {
    return new ApiError(response.status, 'server_error', 'Сервер недоступен, попробуйте ещё раз');
  }
  return new ApiError(response.status, 'unknown', `Ошибка ${response.status}`);
}

function validationMessage(field: string, issue: ValidationIssue): string {
  if (field === 'email') return 'Введите корректный email';
  if (field === 'password' || field === 'newPassword') {
    return issue.type === 'string_too_short' ? 'Не короче 8 символов' : 'Не длиннее 128 символов';
  }
  if (field === 'name' || field === 'displayName') {
    return issue.type === 'string_too_long' ? 'Слишком длинное название' : 'Заполните поле';
  }
  if (field === 'data') return 'Файл не похож на план загрузки';
  return 'Проверьте значение';
}

/** Human-readable text for any error thrown by `api()` or fetch. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError) return 'Нет связи с сервером';
  return 'Что-то пошло не так';
}
