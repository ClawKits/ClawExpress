import { useSyncExternalStore, useEffect } from 'react';

// ─── Module-level singleton state ─────────────────────────────────────────────
// Stored OUTSIDE the hook so all consumers share the exact same state
// without additional IPC calls or re-subscriptions.

let _state = {
  status: 'idle',       // idle | checking | available | not-available | downloading | downloaded | error
  updateInfo: null,     // { version, releaseNotes, ... }
  downloadProgress: 0,  // 0 - 100
  isDownloading: false,
  isDownloaded: false,
  error: null,
  appVersion: null,
};

let _listeners = new Set();
let _listenerAttached = false;
let _bootDone = false;

function getSnapshot() {
  return _state;
}

function setState(patch) {
  _state = { ..._state, ...patch };
  _listeners.forEach(fn => fn());
}

function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// ─── Boot (runs once when first consumer mounts) ───────────────────────────
function boot() {
  if (_bootDone) return;
  _bootDone = true;

  const api = window.electronAPI;
  if (!api) return; // Web context / Storybook guard

  // 1. Get current version immediately
  api.getAppVersion().then(v => setState({ appVersion: v })).catch(() => {});

  // 2. Restore state snapshot from main process (handles hot-reload case)
  api.getUpdateStatus().then(snapshot => {
    if (!snapshot) return;
    setState({
      status: snapshot.status,
      updateInfo: snapshot.updateInfo,
      downloadProgress: snapshot.downloadProgress || 0,
      isDownloading: snapshot.status === 'downloading',
      isDownloaded: snapshot.status === 'downloaded',
      error: snapshot.error,
    });
  }).catch(() => {});

  // 3. Subscribe to live updater events from main process — attach ONCE
  if (!_listenerAttached) {
    _listenerAttached = true;
    api.onUpdaterEvent(({ event, payload }) => {
      switch (event) {
        case 'checking':
          setState({ status: 'checking', error: null });
          break;
        case 'available':
          setState({ status: 'available', updateInfo: payload?.updateInfo, isDownloading: false });
          // Safety-net: if autoDownload didn't trigger within 1s, force it from renderer
          setTimeout(() => {
            const isMac = navigator.userAgent.includes('Mac');
            if (_state.status === 'available' && !_state.isDownloading && !isMac) {
              api.downloadUpdate().catch(() => {});
            }
          }, 1000);
          break;
        case 'not-available':
          setState({ status: 'not-available', updateInfo: payload?.updateInfo });
          break;
        case 'downloading':
          setState({
            status: 'downloading',
            isDownloading: true,
            downloadProgress: payload?.downloadProgress || 0,
          });
          break;
        case 'downloaded':
          setState({
            status: 'downloaded',
            isDownloaded: true,
            isDownloading: false,
            downloadProgress: 100,
            updateInfo: payload?.updateInfo,
          });
          break;
        case 'error':
          setState({ status: 'error', error: payload?.error, isDownloading: false });
          break;
        default:
          break;
      }
    });
  }

  // 4. Auto-boot: wait 3s then silently check for updates in the background
  setTimeout(() => {
    if (_state.status === 'idle') {
      api.checkForUpdates().catch(() => {});
    }
  }, 3000);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function triggerInstall() {
  window.electronAPI?.installUpdate();
}

export function triggerDownload() {
  window.electronAPI?.downloadUpdate();
}

export function triggerCheck() {
  window.electronAPI?.checkForUpdates();
}

// ─── Singleton Hook ───────────────────────────────────────────────────────────
// Safe to call from multiple components — each call shares the same state.

export function useAppUpdater() {
  useEffect(() => {
    boot();
  }, []);

  return useSyncExternalStore(subscribe, getSnapshot);
}
