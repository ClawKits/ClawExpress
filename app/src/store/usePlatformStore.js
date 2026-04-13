import { create } from 'zustand';

const REGISTRY_URL = 'https://clawexpress-registry.pages.dev';

const DEFAULT_PLATFORMS = [];

export const usePlatformStore = create((set, get) => ({
  platforms: DEFAULT_PLATFORMS,
  marketplace: [],
  marketplaceStatus: 'idle',
  initialized: false,

  // ─── Init: load from disk on app start ──────────────────────────────────
  init: async () => {
    if (get().initialized) return;
    try {
      const saved = await window.electron?.ipcRenderer.invoke('platforms-load');
      if (saved && Array.isArray(saved) && saved.length > 0) {
        // First pass: reset transient statuses
        const restored = saved.map(p => ({
          ...p,
          status: ['RUNNING', 'STARTING', 'STOPPING'].includes(p.status) ? 'STOPPED' : p.status,
          uptime: null,
          dashboardUrl: null,
        }));
        set({ platforms: restored, initialized: true });

        // Second pass: run health checks in parallel to detect actually-running platforms
        const checks = restored
          .filter(p => p.port)
          .map(async (p) => {
            try {
              const result = await window.electron?.ipcRenderer.invoke('platform-health-check', {
                platformId: p.id,
                port: p.port,
                cwd: p.cwd,
              });
              if (result?.running) {
                set(state => ({
                  platforms: state.platforms.map(sp =>
                    sp.id === p.id ? {
                      ...sp,
                      status: 'RUNNING',
                      uptime: Date.now(),
                      dashboardUrl: result.dashboardUrl || sp.dashboardUrl,
                    } : sp
                  )
                }));
              }
            } catch (_) {}
          });
        await Promise.all(checks);
      } else {
        set({ initialized: true });
      }
    } catch {
      set({ initialized: true });
    }
  },

  // ─── Persist current platforms to disk ──────────────────────────────────
  persist: async () => {
    const { platforms } = get();
    await window.electron?.ipcRenderer.invoke('platforms-save', platforms);
  },

  // ─── Start a platform process via IPC ────────────────────────────────────
  startPlatform: async (id) => {
    const platform = get().platforms.find(p => p.id === id);
    if (!platform) return;

    set(state => ({
      platforms: state.platforms.map(p =>
        p.id === id ? { ...p, status: 'STARTING' } : p
      )
    }));

    const result = await window.electron?.ipcRenderer.invoke('platform-start', {
      platformId: id,
      config: {
        method: platform.method,
        container: platform.container,
        startScript: platform.startScript,
        cwd: platform.cwd,
        env: platform.env || {},
      }
    });

    if (result?.success) {
      set(state => ({
        platforms: state.platforms.map(p =>
          p.id === id ? { ...p, status: 'RUNNING', uptime: Date.now() } : p
        )
      }));
      get().persist();
    } else {
      set(state => ({
        platforms: state.platforms.map(p =>
          p.id === id ? { ...p, status: 'ERROR' } : p
        )
      }));
    }
  },

  // ─── Stop a platform process via IPC ─────────────────────────────────────
  stopPlatform: async (id) => {
    set(state => ({
      platforms: state.platforms.map(p =>
        p.id === id ? { ...p, status: 'STOPPING' } : p
      )
    }));

    const platform = get().platforms.find(p => p.id === id);
    await window.electron?.ipcRenderer.invoke('platform-stop', {
      platformId: id,
      method: platform?.method,
      container: platform?.container
    });

    set(state => ({
      platforms: state.platforms.map(p =>
        p.id === id ? { ...p, status: 'STOPPED', uptime: null, dashboardUrl: null } : p
      )
    }));
    get().persist();
  },

  // ─── Set dashboard URL after gateway is ready ─────────────────────────────
  setDashboardUrl: (id, url) => {
    set(state => ({
      platforms: state.platforms.map(p =>
        p.id === id ? { ...p, dashboardUrl: url } : p
      )
    }));
  },

  // ─── Toggle (for UI buttons that don't care about direction) ─────────────
  toggleStatus: (id) => {
    const platform = get().platforms.find(p => p.id === id);
    if (!platform) return;
    if (platform.status === 'RUNNING') {
      get().stopPlatform(id);
    } else {
      get().startPlatform(id);
    }
  },

  // ─── Update platform config (from Config Panel) ───────────────────────────
  updatePlatform: (id, updates) => {
    set(state => ({
      platforms: state.platforms.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
    get().persist();
  },

  // ─── Conflict resolution helper (used by Marketplace UI) ───────────────────
  // Returns { blocked: true, conflictingId, reason } if the given marketplace
  // platform cannot be installed due to a conflict with a currently-installed
  // platform. Returns null if safe to install.
  //
  // Conflict detection is BIDIRECTIONAL:
  //   A → B: new platform's own conflicts[] lists an installed platform's id
  //   B → A: an installed platform's conflicts[] lists the new platform's id
  getConflictFor: (marketplacePlatform) => {
    const installed = get().platforms;
    for (const p of installed) {
      const pRegistryId = p.registryId || p.id;
      // Direction A: new platform declares it conflicts with installed platform p
      if ((marketplacePlatform.conflicts || []).includes(pRegistryId)) {
        return {
          blocked: true,
          conflictingId: pRegistryId,
          reason: marketplacePlatform.conflictReason ||
            `${marketplacePlatform.name} cannot run alongside ${p.name || pRegistryId} (already installed).`
        };
      }
      // Direction B: installed platform p declares it conflicts with new platform
      if ((p.conflicts || []).includes(marketplacePlatform.id)) {
        return {
          blocked: true,
          conflictingId: p.id,
          reason: p.conflictReason ||
            `${p.name || p.id} (already installed) conflicts with ${marketplacePlatform.name}.`
        };
      }
    }
    return null;
  },

  // ─── Add new platform (from Install Wizard) ───────────────────────────────
  // Guard 1 – Duplicate: same ID cannot be installed twice.
  // Guard 2 – Conflict: bidirectional conflicts[] check against registry data.
  // The Marketplace UI enforces both at the button level too, but this is
  // the authoritative data-layer safety net.
  addPlatform: (platform) => {
    const registryIdMatch = platform.registryId || platform.id;
    const alreadyInstalled = get().platforms.some(p => (p.registryId || p.id) === registryIdMatch);
    if (alreadyInstalled) {
      console.warn(`[ClawExpress] Blocked duplicate install for: ${registryIdMatch}`);
      return;
    }
    const conflict = get().getConflictFor(platform);
    if (conflict) {
      console.warn(`[ClawExpress] Blocked conflicting install for: ${platform.id} — conflicts with ${conflict.conflictingId}`);
      return;
    }
    set(state => ({ platforms: [...state.platforms, { ...platform, status: 'STOPPED' }] }));
    get().persist();
  },

  // ─── Remove platform ──────────────────────────────────────────────────────
  removePlatform: async (id) => {
    set(state => ({ platforms: state.platforms.filter(p => p.id !== id) }));
    // Immediately persist to disk so a hot-reload can't restore the deleted entry
    await get().persist();
  },

  // ─── React to real process exit events from main ─────────────────────────
  handleStatusChange: ({ platformId, status }) => {
    set(state => ({
      platforms: state.platforms.map(p =>
        p.id === platformId ? { ...p, status } : p
      )
    }));
  },

  // ─── Marketplace ──────────────────────────────────────────────────────────
  fetchMarketplace: async () => {
    set({ marketplaceStatus: 'loading' });
    try {
      const res = await fetch(REGISTRY_URL);
      const data = await res.json();
      set({ marketplace: data.platforms, marketplaceStatus: 'success' });
    } catch {
      set({ marketplaceStatus: 'error' });
    }
  }
}));
