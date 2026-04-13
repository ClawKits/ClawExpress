/**
 * main.js
 * ─────────────────────────────────────────────────────────────────────────────
 * ClawExpress — Electron Main Process Entry Point
 *
 * Responsibilities:
 *   1. App lifecycle (createWindow, app events)
 *   2. Core IPC handlers (window controls, platform management, health check,
 *      persistence, debug logging, URL opener)
 *   3. Delegating specialised logic to dedicated handler modules
 *
 * Handler modules:
 *   authHandler.js         – Google OAuth callback + native session token
 *   platformInstaller.js   – platform-install / platform-uninstall
 *   channelHandler.js      – QR-based channel login/logout
 *   configHandler.js       – read/write platform config, verify API key, connections
 *   oauthHandler.js        – OAuth2 PKCE flow (3rd-party connections)
 *   openclawUpdater.js     – openclaw CLI version management
 *   updater.js             – Electron auto-updater (electron-updater)
 *   processManager.js      – platform spawn / stop
 *   storage.js             – platforms.json / connections.json persistence
 *   logger.js              – unified logger (file + IPC + console)
 */

const { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const net  = require('net');
const fs   = require('fs');
const os   = require('os');

// ── Core modules ─────────────────────────────────────────────────────────────
const log = require('./logger');
const updater = require('./updater');
const { getDataPath, loadPlatforms, savePlatforms, loadConnections, saveConnections } = require('./storage');
const { runningProcesses, spawnPlatform, stopPlatform } = require('./processManager');

// ── Handler modules ───────────────────────────────────────────────────────────
const { registerAuthHandlers }              = require('./authHandler');
const { registerPlatformInstallerHandlers } = require('./platformInstaller');
const { registerChannelHandlers }           = require('./channelHandler');
const { registerConfigHandlers }            = require('./configHandler');
const { registerOAuthHandlers }             = require('./oauthHandler');
const { registerOpenclawUpdaterHandlers }   = require('./openclawUpdater');
const { registerSkillHandlers }             = require('./skillHandler');
const { registerPtyHandlers, killAllPtys }  = require('./ptyHandler');

// ── Global Error Capture ──────────────────────────────────────────────────────
process.on('uncaughtException',   (err)    => log.error('[uncaughtException]',   err.stack  || err.message));
process.on('unhandledRejection',  (reason) => log.error('[unhandledRejection]',  reason?.stack || String(reason)));

// ─────────────────────────────────────────────────────────────────────────────
// Settings — Persist preferences to userData/settings.json
// ─────────────────────────────────────────────────────────────────────────────
let _settingsPath = null;
const getSettingsPath = () => {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json');
  return _settingsPath;
};

const loadSettings = () => {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
};

const saveSettings = (data) => {
  try { fs.writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf8'); } catch (_) {}
};

// ─────────────────────────────────────────────────────────────────────────────
// Window / Tray
// ─────────────────────────────────────────────────────────────────────────────
let mainWindow;
let tray = null;

function createWindow() {
  const isWin = process.platform === 'win32';
  mainWindow = new BrowserWindow({
    width: 1200, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#030303',
    icon: nativeImage.createFromPath(path.join(__dirname, '../../public/logo.png')),
    frame: isWin ? false : true,
    titleBarStyle: isWin ? undefined : 'hidden',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.maximize();

  function ensureTray() {
    if (!tray) {
      const icon = nativeImage.createFromPath(path.join(__dirname, '../../public/logo.png'));
      tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
      tray.setToolTip('ClawExpress');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Show', click: () => { mainWindow.show(); mainWindow.restore(); mainWindow.focus(); } },
        { type: 'separator' },
        { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
      ]));
      tray.on('double-click', () => { mainWindow.show(); mainWindow.restore(); mainWindow.focus(); });
    }
  }

  // Minimize-to-tray: intercept close if setting is on
  mainWindow.on('close', (e) => {
    const prefs = loadSettings();
    if (prefs.minimizeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
  });

  // Minimize-to-tray: intercept minimize if setting is on
  mainWindow.on('minimize', (e) => {
    const prefs = loadSettings();
    if (prefs.minimizeToTray && !app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
      ensureTray();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// App Lifecycle
// ─────────────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  log.setLogPath(app.getPath('userData'));
  log.info('ClawExpress starting. userData:', app.getPath('userData'));

  createWindow();
  log.setWindow(mainWindow);
  log.info('Window created.');

  if (app.isPackaged) {
    updater.initUpdater(log);
    log.info('[Updater] Auto-updater initialized.');
  } else {
    log.info('[Updater] Skipping auto-updater in dev mode.');
  }

  // Register all IPC handler modules
  registerAuthHandlers();
  registerPlatformInstallerHandlers(runningProcesses);
  registerChannelHandlers(runningProcesses);
  registerConfigHandlers();
  registerOAuthHandlers();
  registerOpenclawUpdaterHandlers();
  registerSkillHandlers();
  registerPtyHandlers();

  // Apply saved launch-at-startup on boot
  const bootPrefs = loadSettings();
  app.setLoginItemSettings({ openAtLogin: !!bootPrefs.launchOnStartup });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      log.setWindow(mainWindow);
    }
  });
});

app.on('before-quit', () => { app.isQuitting = true; killAllPtys(); });

app.on('window-all-closed', () => {
  runningProcesses.forEach(({ process: proc }) => {
    try { proc.kill('SIGTERM'); } catch (_) {}
  });
  if (process.platform !== 'darwin') app.quit();
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Window Controls
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('window-min',   (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
ipcMain.handle('window-max',   (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) win.restore(); else win?.maximize();
});
ipcMain.handle('window-close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Platform Process Control
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('platform-start',      (event, { platformId, config }) => spawnPlatform(platformId, config, event.sender));
ipcMain.handle('platform-stop',       (event, { platformId, method, container }) => stopPlatform(platformId, event.sender, method, container));
ipcMain.handle('platform-status',     (event, { platformId }) => ({ running: runningProcesses.has(platformId) }));

ipcMain.handle('platform-send-input', (event, { platformId, input }) => {
  const entry = runningProcesses.get(platformId);
  if (entry?.process?.stdin) {
    try { entry.process.stdin.write(input + '\n'); return { success: true }; }
    catch (err) { return { success: false, reason: err.message }; }
  }
  return { success: false, reason: 'Process not running or stdin not available' };
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Persistence
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('platforms-load', () => loadPlatforms());
ipcMain.handle('db-path',        () => getDataPath());
ipcMain.handle('platforms-save', (event, data) => { savePlatforms(data); return { success: true }; });

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Platform Health Check (TCP Probe)
// ─────────────────────────────────────────────────────────────────────────────
function readDashboardUrl(port, cwd) {
  const loc = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    if (fs.existsSync(loc)) {
      const cfg   = JSON.parse(fs.readFileSync(loc, 'utf8'));
      const token = cfg?.gateway?.auth?.token;
      if (token) return `http://127.0.0.1:${port}/?token=${token}`;
    }
  } catch (_) {}
  return null;
}

ipcMain.handle('platform-health-check', (event, { port, platformId, cwd }) => {
  return new Promise((resolve) => {
    const targetPort = port || 18789;

    // In-process registry is fastest and most accurate for the current session
    if (platformId && runningProcesses.has(platformId)) {
      return resolve({ running: true, source: 'process', dashboardUrl: readDashboardUrl(targetPort, cwd) });
    }

    // TCP probe to catch externally running gateways
    const socket = net.connect({ port: targetPort, host: '127.0.0.1' });
    const timer  = setTimeout(() => { socket.destroy(); resolve({ running: false, source: 'timeout' }); }, 800);
    socket.on('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ running: true, source: 'port', dashboardUrl: readDashboardUrl(targetPort, cwd) });
    });
    socket.on('error', () => { clearTimeout(timer); resolve({ running: false, source: 'error' }); });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Platform Docker Scan
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('platform-scan', async () => {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const proc = spawn('docker', ['ps', '--format', '{{.Names}}\t{{.Status}}'], { shell: true });
    const containers = [];
    proc.stdout.on('data', (data) => {
      data.toString().trim().split('\n').filter(Boolean).forEach(line => {
        const [name, status] = line.split('\t');
        if (name) containers.push({ name, status });
      });
    });
    proc.on('close', () => resolve({ success: true, containers }));
    proc.on('error', () => resolve({ success: false, containers: [] }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Debug Logging & Utilities
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('get-logs',      (event, { n } = {}) => log.recent(n || 300));

ipcMain.handle('open-log-file', () => {
  const logPath = path.join(app.getPath('userData'), 'clawexpress.log');
  if (fs.existsSync(logPath)) { shell.openPath(logPath); return { success: true, path: logPath }; }
  return { success: false, reason: 'Log file not found yet.' };
});

ipcMain.handle('open-url', (event, { url }) => {
  if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, reason: 'Invalid URL' };
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Settings Persistence
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('settings-load', () => {
  return loadSettings();
});

ipcMain.handle('settings-save', (event, data) => {
  saveSettings(data);
  // Apply side-effects immediately
  app.setLoginItemSettings({ openAtLogin: !!data.launchOnStartup });
  return { success: true };
});

ipcMain.handle('open-user-data', () => {
  shell.openPath(app.getPath('userData'));
  return { success: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// Core IPC — Electron Auto-Updater
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('check-for-updates', () => app.isPackaged ? updater.checkForUpdates()  : { status: 'dev-mode' });
ipcMain.handle('download-update',   () => app.isPackaged ? updater.downloadUpdate()    : { status: 'dev-mode' });
ipcMain.handle('install-update',    () => { if (app.isPackaged) updater.quitAndInstall(); return { status: 'dev-mode' }; });
ipcMain.handle('get-update-status', () => updater.getStatus());
ipcMain.handle('get-app-version',   () => app.getVersion());
