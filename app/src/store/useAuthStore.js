import { create } from 'zustand';

const API_BASE = 'https://clawexpress-api.pages.dev/api/v1';

// ── Native session helpers (disk-based, works in dev + production) ────────────
// Falls back to a no-op if the IPC bridge isn't available (e.g. pure browser env).
const nativeSession = {
  async get() {
    try {
      return await window.electron?.ipcRenderer.invoke('auth-get-token') ?? null;
    } catch (_) { return null; }
  },
  async set(token) {
    try {
      await window.electron?.ipcRenderer.invoke('auth-set-token', { token });
    } catch (_) {}
  },
  async clear() {
    try {
      await window.electron?.ipcRenderer.invoke('auth-clear-token');
    } catch (_) {}
  },
};

const useAuthStore = create((set, get) => ({
  user: null,
  sessionToken: null,
  loading: true,
  error: null,

  // Global auth modal state — avoids prop drilling
  isAuthModalOpen: false,
  openAuthModal:  () => set({ isAuthModalOpen: true }),
  closeAuthModal: () => set({ isAuthModalOpen: false }),

  // Init app — load token from disk, then verify with API
  initAuth: async () => {
    // Auth bypass: for open-source / self-hosted forks that set VITE_DISABLE_AUTH=true.
    // Vite replaces import.meta.env at build time — in official releases this branch
    // is dead code; forkers enable it via their local .env file.
    if (import.meta.env.VITE_DISABLE_AUTH === 'true') {
      set({ user: { id: 'local-dev', name: 'Developer', avatar_url: null }, loading: false });
      return;
    }

    const token = await nativeSession.get();
    if (!token) {
      set({ loading: false, user: null, sessionToken: null });
      return;
    }

    // Hydrate in-memory token so the rest of the app can use it
    set({ sessionToken: token });

    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { 'X-CE-Key': token },
      });

      if (!res.ok) {
        // Token invalid / expired — clear from disk too
        await nativeSession.clear();
        set({ user: null, sessionToken: null, loading: false });
        return;
      }

      const data = await res.json();
      set({ user: data.user, loading: false });
    } catch (err) {
      console.error('[Auth] Failed to verify session:', err);
      // Network error: keep token in memory (user may be offline), don't wipe it
      set({ loading: false, error: 'Network error checking session' });
    }
  },

  // Called with auth code — Cloudflare does the token exchange server-side
  loginWithCode: async (code, redirectUri = 'http://127.0.0.1:4012/callback') => {
    set({ loading: true, error: null });
    try {
      const appVersion = window.electron?.appVersion || '1.0.0';
      const os = window.electron?.platform || navigator.userAgent;

      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirect_uri: redirectUri, app_version: appVersion, os }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      await nativeSession.set(data.session_token);
      set({ user: data.user, sessionToken: data.session_token, loading: false, error: null });
      return { success: true, is_new_user: data.is_new_user, user: data.user };
    } catch (err) {
      console.error('[Auth] loginWithCode error:', err);
      set({ error: err.message, loading: false });
      return { success: false, error: err.message };
    }
  },

  // Called after successful Google OAuth
  loginWithGoogle: async (idToken) => {
    set({ loading: true, error: null });
    try {
      const appVersion = window.electron?.appVersion || '1.0.0';
      const os = window.electron?.platform || navigator.userAgent;

      const res = await fetch(`${API_BASE}/auth/google`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id_token: idToken, app_version: appVersion, os }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Persist token to disk so it survives restarts
      await nativeSession.set(data.session_token);

      set({
        user: data.user,
        sessionToken: data.session_token,
        loading: false,
        error: null,
      });

      return { success: true, is_new_user: data.is_new_user, user: data.user };
    } catch (err) {
      console.error('[Auth] Google login error:', err);
      set({ error: err.message, loading: false });
      return { success: false, error: err.message };
    }
  },

  logout: async () => {
    // Wipe disk first, then clear memory
    await nativeSession.clear();
    set({
      user: null,
      sessionToken: null,
      error: null,
      isAuthModalOpen: false,
    });
  },

  clearError: () => set({ error: null }),

  // ── Newsletter ─────────────────────────────────────────────────────────────
  subscribeNewsletter: async () => {
    const token = get().sessionToken;
    if (!token) return { success: false };
    try {
      const res = await fetch(`${API_BASE}/user/newsletter/subscribe`, {
        method: 'POST',
        headers: { 'X-CE-Key': token },
      });
      if (!res.ok) throw new Error('Subscribe failed');
      set(state => ({ user: state.user ? { ...state.user, newsletter_subscribed: 1 } : null }));
      return { success: true };
    } catch (err) {
      console.error('[Newsletter] subscribe error:', err);
      return { success: false };
    }
  },

  unsubscribeNewsletter: async () => {
    const token = get().sessionToken;
    if (!token) return { success: false };
    try {
      const res = await fetch(`${API_BASE}/user/newsletter/unsubscribe`, {
        method: 'POST',
        headers: { 'X-CE-Key': token },
      });
      if (!res.ok) throw new Error('Unsubscribe failed');
      set(state => ({ user: state.user ? { ...state.user, newsletter_subscribed: 0 } : null }));
      return { success: true };
    } catch (err) {
      console.error('[Newsletter] unsubscribe error:', err);
      return { success: false };
    }
  },
}));

export default useAuthStore;
