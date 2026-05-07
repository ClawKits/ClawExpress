const { contextBridge, ipcRenderer } = require('electron');

const VALID_CHANNELS = [
  // Window
  'window-min', 'window-max', 'window-close',
  // Process
  'platform-start', 'platform-stop', 'platform-status', 'platform-scan', 'platform-install', 'platform-send-input', 'platform-uninstall', 'platform-health-check', 'install-global-dependency', 'platform-preflight-check',
  // Persistence
  'platforms-load', 'platforms-save', 'db-path',
  // Debug Logging
  'get-logs', 'open-log-file',
  // Utils
  'open-url', 'write-platform-config', 'read-platform-config', 'verify-api-key', 'register-model-alias', 'fetch-models', 'read-gateway-models', 'test-model-chat',
  'read-raw-config', 'write-raw-config', 'get-config-history', 'restore-config-history',
  // OAuth
  'oauth-start', 'oauth-exchange',
  // Connections
  'connections-load', 'connections-save',
  // Updater
  'get-openclaw-versions', 'openclaw-install-version',
  'check-for-updates', 'download-update', 'install-update', 'get-update-status', 'get-app-version',
  // Channel login (QR-based: WhatsApp, Zalo Personal)
  'channel-login', 'channel-logout', 'channel-login-cancel', 'channel-check-linked', 'channel-pairing-accept', 'channel-login-success',
  // Embedded terminal (PTY via node-pty)
  'pty-start', 'pty-input', 'pty-resize', 'pty-kill',
  // Docker quick actions + container listing
  'quick-action-exec', 'docker-list-containers',
  // Auth Modal
  'open-auth-window',
  // Skills
  'skills-fetch-local', 'skills-toggle', 'skills-fetch-hub', 'skills-install',
  // Native session token (disk-based persistence)
  'auth-get-token', 'auth-set-token', 'auth-clear-token',
  // Settings persistence
  'settings-load', 'settings-save', 'open-user-data',
];

const VALID_EVENTS = [
  'platform-log', 'platform-status-change', 'platform-stop-progress', 'app-log', 'platform-ready', 'oauth-token-received', 'dependency-log',
  'config-file-changed', // Added for raw config live reload
  // Updater events (broadcast from main process)
  'updater-event',
  // Channel login events
  'channel-login-event',
  // Pairing request from gateway (zalouser DM gating)
  'pairing-request',
  // Embedded terminal (PTY output + exit)
  'pty-data', 'pty-exit',
];

contextBridge.exposeInMainWorld('electron', {
  ipcRenderer: {
    invoke: (channel, ...args) => {
      if (VALID_CHANNELS.includes(channel)) return ipcRenderer.invoke(channel, ...args);
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    },
    on: (channel, func) => {
      if (VALID_EVENTS.includes(channel)) {
        const wrapped = (event, ...args) => func(...args);
        ipcRenderer.on(channel, wrapped);
        return () => ipcRenderer.removeListener(channel, wrapped);
      }
    },
    removeListener: (channel, func) => {
      // Just a dummy to prevent the Uncaught TypeError. We actually rely on 
      // the returned unsubscriber in modern components.
      if (func === undefined) ipcRenderer.removeAllListeners(channel);
    }
  }
});

// Expose clean updater API under window.electronAPI
contextBridge.exposeInMainWorld('electronAPI', {
  checkForUpdates:  () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate:   () => ipcRenderer.invoke('download-update'),
  installUpdate:    () => ipcRenderer.invoke('install-update'),
  getUpdateStatus:  () => ipcRenderer.invoke('get-update-status'),
  getAppVersion:    () => ipcRenderer.invoke('get-app-version'),
  onUpdaterEvent: (callback) => {
    const wrapped = (_event, data) => callback(data);
    ipcRenderer.on('updater-event', wrapped);
    return () => ipcRenderer.removeListener('updater-event', wrapped);
  },
});
