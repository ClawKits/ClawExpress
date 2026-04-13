const { autoUpdater } = require('electron-updater');
const { BrowserWindow, net, app } = require('electron');

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
  autoUpdater.autoDownload = process.platform !== 'darwin';
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

async function checkMacUpdatesManually() {
  updateState({ status: 'checking', error: null });
  try {
    const request = net.request({
      url: 'https://api.github.com/repos/ClawKits/ClawExpress/releases',
      headers: { 'User-Agent': 'ClawExpress-Updater' }
    });
    
    request.on('response', (response) => {
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('API Error ' + response.statusCode);
          const releases = JSON.parse(data);
          if (!releases.length) throw new Error('No releases found');
          
          const release = releases[0];
          const latestVersion = release.tag_name.replace('v', '');
          const currentVersion = app.getVersion();
          
          if (latestVersion !== currentVersion) {
            updateState({ status: 'available', updateInfo: { version: latestVersion, releaseNotes: release.body } });
          } else {
            updateState({ status: 'not-available', updateInfo: { version: latestVersion } });
          }
        } catch (e) {
          updateState({ status: 'error', error: e.message });
        }
      });
    });
    request.on('error', (err) => updateState({ status: 'error', error: err.message }));
    request.end();
  } catch (err) {
    updateState({ status: 'error', error: err.message });
  }
}

function checkForUpdates() {
  try {
    if (process.platform === 'darwin') {
      return checkMacUpdatesManually();
    }
    return autoUpdater.checkForUpdates();
  } catch (err) {
    _log?.error('[Updater] checkForUpdates failed:', err.message);
  }
}

function downloadUpdate() {
  try {
    if (process.platform === 'darwin') {
      const { shell } = require('electron');
      shell.openExternal('https://github.com/ClawKits/ClawExpress/releases/latest');
      updateState({ status: 'error', error: 'macOS requires manual updates. Opened release page in browser.' });
      return;
    }
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
