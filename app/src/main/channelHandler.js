const { ipcMain } = require('electron');
const log = require('./logger');
const { getAdapter } = require('./platformRegistry');

function registerChannelHandlers() {
  
  ipcMain.handle('channel-login', async (event, { channel, platformId, platformConfig }) => {
    // Determine the adapter. Default to OpenClaw if unspecified, as older components
    // might just pass platformId = 'openclaw' or null.
    const adapter = getAdapter(platformConfig?.registryId || platformId);
    if (!adapter) {
      log.error(`[channelHandler] channel-login: Unknown adapter for ${platformId}`);
      return { success: false, reason: 'unknown-adapter' };
    }
    return adapter.channelLogin({ channel, platformId, platformConfig, event });
  });

  ipcMain.handle('channel-login-complete', async (event, { platformId, platformConfig }) => {
    if (!platformId || !platformConfig) return { success: false, reason: 'no-platform' };
    try {
      const { spawnPlatform } = require('./processManager');
      spawnPlatform(platformId, {
        method:      platformConfig.method,
        container:   platformConfig.container,
        startScript: platformConfig.startScript,
        cwd:         platformConfig.cwd,
        env:         platformConfig.env || {},
      }, event.sender);
      return { success: true };
    } catch (e) {
      return { success: false, reason: e.message };
    }
  });

  ipcMain.handle('channel-logout', async (event, { channel, platformId, platformConfig }) => {
    const adapter = getAdapter(platformConfig?.registryId || platformId);
    return adapter.channelLogout({ channel, platformId, platformConfig });
  });

  ipcMain.handle('channel-login-success', async (event, { channel, platformId, platformConfig }) => {
    const adapter = getAdapter(platformConfig?.registryId || platformId);
    return adapter.channelLoginSuccess({ channel, platformId, platformConfig });
  });

  ipcMain.handle('channel-login-cancel', (event, { channel, platformId, platformConfig }) => {
    const adapter = getAdapter(platformConfig?.registryId || platformId);
    if (adapter.channelLoginCancel) {
      return adapter.channelLoginCancel({ channel, platformId, platformConfig });
    }
    return { success: false, reason: 'unsupported' };
  });

  ipcMain.handle('channel-check-linked', async (event, { channel, platformId, platformConfig }) => {
    const adapter = getAdapter(platformConfig?.registryId || platformId);
    return adapter.channelCheckLinked({ channel, platformId, platformConfig });
  });

  log.info('[channelHandler] IPC handlers registered (Refactored via Adapters).');
}

module.exports = { registerChannelHandlers };
