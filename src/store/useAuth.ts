import { create } from 'zustand';
import { ApiError, onRefreshed, onSessionLost, refreshSession, setAccessToken } from '../api/client';
import { authApi } from '../api/endpoints';
import type { AuthResponse, User } from '../api/types';

/** Who is logged in. The access token itself is kept by api/client.ts (memory only). */
interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: User | null;
  /** bootstrap() cannot reach the server and keeps retrying. */
  reconnecting: boolean;
  /** Restores the session from the refresh cookie on page load. */
  bootstrap(): Promise<void>;
  login(email: string, password: string): Promise<void>;
  register(email: string, password: string, displayName?: string): Promise<void>;
  logout(): Promise<void>;
  setUser(user: User): void;
  /** The server ended the session (revoked, expired, account deleted). */
  sessionEnded(): void;
}

/**
 * Tabs of one browser share the refresh cookie, i.e. the login: a login or logout in one tab is
 * announced to the others so they follow at once instead of on their next request.
 */
type AuthEvent = { type: 'login'; userId: string } | { type: 'logout' };
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('loader3d:auth');

const RETRY_DELAYS = [1000, 2000, 4000, 8000];
const MAX_RETRY_DELAY = 10_000;

let bootstrapping: Promise<void> | null = null;

/** The server is down or restarting: the session may well be alive, it is just not known yet. */
function unreachable(error: unknown): boolean {
  return !(error instanceof ApiError) || error.status >= 500;
}

/** The cookie now belongs to another account than this tab shows: start over as that one. */
function accountChanged(): void {
  window.location.assign('/');
}

export const useAuth = create<AuthState>()((set, get) => {
  const signedIn = (auth: AuthResponse) => {
    setAccessToken(auth.accessToken);
    set({ status: 'authenticated', user: auth.user });
  };
  const signedOut = () => {
    setAccessToken(null);
    set({ status: 'anonymous', user: null });
  };

  onSessionLost(() => get().sessionEnded());
  onRefreshed((auth) => {
    const { status, user } = get();
    if (status !== 'authenticated') return; // bootstrap() takes it from here
    if (user?.id === auth.user.id) set({ user: auth.user });
    else accountChanged();
  });

  channel?.addEventListener('message', ({ data }: MessageEvent<AuthEvent>) => {
    const { status, user } = get();
    if (data.type === 'logout') {
      if (status === 'authenticated') signedOut();
    } else if (status === 'anonymous') {
      void get().bootstrap();
    } else if (status === 'authenticated' && user?.id !== data.userId) {
      accountChanged();
    }
  });

  return {
    status: 'loading',
    user: null,
    reconnecting: false,

    bootstrap() {
      bootstrapping ??= (async () => {
        for (let attempt = 0; ; attempt++) {
          try {
            const auth = await refreshSession();
            if (auth) signedIn(auth);
            else signedOut();
            return;
          } catch (error) {
            // Showing the login page here would make the user log in again (a second session)
            // although the cookie is fine: wait for the server instead.
            if (!unreachable(error)) {
              signedOut();
              return;
            }
            set({ reconnecting: true });
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[attempt] ?? MAX_RETRY_DELAY));
          }
        }
      })().finally(() => {
        bootstrapping = null;
        set({ reconnecting: false });
      });
      return bootstrapping;
    },

    async login(email, password) {
      const auth = await authApi.login(email, password);
      signedIn(auth);
      channel?.postMessage({ type: 'login', userId: auth.user.id } satisfies AuthEvent);
    },

    async register(email, password, displayName) {
      const auth = await authApi.register(email, password, displayName);
      signedIn(auth);
      channel?.postMessage({ type: 'login', userId: auth.user.id } satisfies AuthEvent);
    },

    async logout() {
      try {
        await authApi.logout();
      } finally {
        signedOut();
        channel?.postMessage({ type: 'logout' } satisfies AuthEvent);
      }
    },

    setUser(user) {
      set({ user });
    },

    sessionEnded() {
      if (get().status !== 'authenticated') return;
      signedOut();
      // The server has cleared the cookie: the other tabs are logged out too.
      channel?.postMessage({ type: 'logout' } satisfies AuthEvent);
    },
  };
});
