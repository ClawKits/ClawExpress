const { autoUpdater } = require('electron-updater');
const { BrowserWindow } = require('electron');

// ─── Core Updater Service ────────────────────────────────────────────────────
// Encapsulates electron-updater for silent background updates.
// Broadcasts all events to ALL BrowserWindows so focus-independent notification works.

let _log = null;

// State snapshot — single source of truth for get-update-status IPC
let _currentState = {
  status: 'idle',       // idle | checking | available | not-available | downloading | downloaded | error
  updateInfo: null,
  downloadProgress: 0,
  error: null,
};

function broadcast(event, payload) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach(win => {
    try {
      if (!win.isDestroyed()) {
        win.webContents.send('updater-event', { event, payload });
      }
    } catch (_) {}
  });
}

function updateState(patch) {
  _currentState = { ..._currentState, ...patch };
  broadcast(_currentState.status, _currentState);
}

function initUpdater(log) {
  _log = log;

  // ── Configure GitHub provider ──────────────────────────────────────────────
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'ClawKits',
    repo: 'ClawExpress',
  });

  // Chrome-style: download silently in background immediately when update is found
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  // ── Event Listeners ───────────────────────────────────────────────────────

  autoUpdater.on('checking-for-update', () => {
    _log?.info('[Updater] Checking for updates...');
    updateState({ status: 'checking', error: null });
  });

  autoUpdater.on('update-available', (info) => {
    _log?.info('[Updater] Update available:', info.version);
    updateState({ status: 'available', updateInfo: info });
  });

  autoUpdater.on('update-not-available', (info) => {
    _log?.info('[Updater] App is up to date:', info.version);
    updateState({ status: 'not-available', updateInfo: info });
  });

  autoUpdater.on('download-progress', (progress) => {
    _log?.debug(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
    updateState({
      status: 'downloading',
      downloadProgress: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    _log?.info('[Updater] Update downloaded and ready to install:', info.version);
    updateState({ status: 'downloaded', updateInfo: info, downloadProgress: 100 });
  });

  autoUpdater.on('error', (err) => {
    _log?.error('[Updater] Error:', err.message);
    updateState({ status: 'error', error: err.message });
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

function checkForUpdates() {
  try {
    return autoUpdater.checkForUpdates();
  } catch (err) {
    _log?.error('[Updater] checkForUpdates failed:', err.message);
  }
}

function downloadUpdate() {
  try {
    return autoUpdater.downloadUpdate();
  } catch (err) {
    _log?.error('[Updater] downloadUpdate failed:', err.message);
  }
}

function quitAndInstall() {
  // setImmediate ensures the IPC reply is sent back before quitting
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });
}

function getStatus() {
  return _currentState;
}

module.exports = {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  quitAndInstall,
  getStatus,
};
