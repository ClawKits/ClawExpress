import { create } from 'zustand';

export const useConnectionStore = create((set, get) => ({
  connections: [],
  initialized: false,

  loadConnections: async () => {
    if (get().initialized) return;
    try {
      const data = await window.electron.ipcRenderer.invoke('connections-load');
      if (data && Array.isArray(data)) {
        set({ connections: data, initialized: true });
      } else {
        set({ connections: [], initialized: true });
      }
    } catch (e) {
      console.error('Failed to load connections:', e);
      set({ initialized: true });
    }
  },

  addConnection: async (connection) => {
    const newConn = { ...connection, id: Math.random().toString(36).substring(2, 9) };
    const newConns = [...get().connections, newConn];
    set({ connections: newConns });
    await window.electron.ipcRenderer.invoke('connections-save', newConns);
    return newConn;
  },

  updateConnection: async (id, changes) => {
    const newConns = get().connections.map(c => c.id === id ? { ...c, ...changes } : c);
    set({ connections: newConns });
    await window.electron.ipcRenderer.invoke('connections-save', newConns);
  },

  removeConnection: async (id) => {
    const newConns = get().connections.filter(c => c.id !== id);
    set({ connections: newConns });
    await window.electron.ipcRenderer.invoke('connections-save', newConns);
  },
}));
