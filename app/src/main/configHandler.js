/**
 * configHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers IPC handlers for platform config read/write, API key verification,
 * model registration, and custom model fetching:
 *   read-platform-config   : Reads openclaw.json from a platform's cwd
 *   write-platform-config  : Writes env, model, channel updates back to disk
 *   fetch-models           : Lists models from a custom/proxy OpenAI endpoint
 *   verify-api-key         : Validates an API key against the provider's endpoint
 *   register-model-alias   : Registers a custom model alias via CLI
 *   connections-load       : Read connections.json (override for reliability)
 *   connections-save       : Write connections.json (override for reliability)
 */

const { ipcMain, app } = require('electron');
const fs   = require('fs');
const path = require('path');
const log  = require('./logger');
const { handleTestChat } = require('./chatTester');
const { getAdapter } = require('./platformRegistry');

// ── Channel token map (which env key maps to which channel) ──────────────────
const CHANNEL_TOKENS = [
  { tokenKey: 'TELEGRAM_BOT_TOKEN', channel: 'telegram' },
  { tokenKey: 'DISCORD_BOT_TOKEN',  channel: 'discord'  },
  { tokenKey: 'SLACK_BOT_TOKEN',    channel: 'slack'    },
  { tokenKey: 'ZALO_BOT_TOKEN',     channel: 'zalo'     },
  { tokenKey: 'LINE_CHANNEL_TOKEN', channel: 'line'     },
  { tokenKey: 'MSTEAMS_BOT_TOKEN',  channel: 'msteams'  },
  { tokenKey: 'TWITCH_TOKEN',       channel: 'twitch'   },
];

// ── Provider verification config ─────────────────────────────────────────────
function buildProviderConfig(key) {
  const openaiCheck = (endpoint) => ({
    url: endpoint,
    headers: { Authorization: `Bearer ${key}` },
  });
  return {
    custom:     openaiCheck('https://api.openai.com/v1/models'),
    openai:     openaiCheck('https://api.openai.com/v1/models'),
    openrouter: openaiCheck('https://openrouter.ai/api/v1/auth/key'),
    groq:       openaiCheck('https://api.groq.com/openai/v1/models'),
    mistral:    openaiCheck('https://api.mistral.ai/v1/models'),
    xai:        openaiCheck('https://api.x.ai/v1/models'),
    moonshot:   openaiCheck('https://api.moonshot.cn/v1/models'),
    deepseek:   openaiCheck('https://api.deepseek.com/models'),
    together:   openaiCheck('https://api.together.xyz/v1/models'),
    nvidia:     openaiCheck('https://integrate.api.nvidia.com/v1/models'),
    qwen:       openaiCheck('https://dashscope.aliyuncs.com/compatible-mode/v1/models'),
    cerebras:   openaiCheck('https://api.cerebras.ai/v1/models'),
    venice:     openaiCheck('https://api.venice.ai/api/v1/models'),
    anthropic: {
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    },
    google: {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
      headers: {},
    },
    huggingface: {
      url: 'https://huggingface.co/api/whoami-v2',
      headers: { Authorization: `Bearer ${key}` },
    },
  };
}

const activeWatchers = new Set();

function startWatching(platformId, cwd) {
  if (!cwd || !fs.existsSync(cwd) || activeWatchers.has(cwd)) return;
  try {
    activeWatchers.add(cwd);
    let debounceTimer = null;
    fs.watch(cwd, (eventType, filename) => {
      if (!filename || (!filename.endsWith('.json') && !filename.endsWith('.toml'))) return;
      
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const { BrowserWindow } = require('electron');
        BrowserWindow.getAllWindows().forEach(win => {
           if (!win.isDestroyed()) {
             win.webContents.send('config-file-changed', { platformId, filename, eventType });
             log.info(`[Config Watcher] Dispatched update for ${platformId} (${filename})`);
           }
        });
      }, 500);
    });
    log.info(`[Config Watcher] Started watching ${cwd} for ${platformId}`);
  } catch (error) {
    log.error(`[Config Watcher] Error watching ${cwd}:`, error.message);
    activeWatchers.delete(cwd);
  }
}

function registerConfigHandlers() {
  // ── read-platform-config ──────────────────────────────────────────────────
  ipcMain.handle('read-platform-config', (event, { cwd, platformId }) => {
    if (platformId === 'openfang') cwd = path.join(require('os').homedir(), '.openfang');
    startWatching(platformId, cwd);
    const adapter = getAdapter(platformId);
    return adapter.readConfig({ cwd, platformId });
  });

  // ── write-platform-config ─────────────────────────────────────────────────
  ipcMain.handle('write-platform-config', (event, args) => {
    const adapter = getAdapter(args.platformId);
    return adapter.writeConfig(args);
  });

  // ── Raw Config & History Handlers ──────────────────────────────────────────
  ipcMain.handle('read-raw-config', (event, args = {}) => {
    const platformId = args.platformId || 'openclaw';
    const cwd = platformId === 'openfang' ? path.join(require('os').homedir(), '.openfang') : args.cwd;
    startWatching(platformId, cwd);
    
    const adapter = getAdapter(platformId);
    return adapter.readRawConfig();
  });

  ipcMain.handle('write-raw-config', (event, args) => {
    const adapter = getAdapter(args.platformId || 'openclaw');
    return adapter.writeRawConfig(args);
  });

  ipcMain.handle('get-config-history', (event, args = {}) => {
    const adapter = getAdapter(args.platformId || 'openclaw');
    if (adapter.getRawConfigHistory) return adapter.getRawConfigHistory();
    return { success: true, history: [] }; // fallback
  });

  ipcMain.handle('restore-config-history', (event, args) => {
    const adapter = getAdapter(args.platformId || 'openclaw');
    if (adapter.restoreRawConfig) return adapter.restoreRawConfig(args);
    return { success: false, reason: 'unsupported' };
  });



  // ── test-model-chat ────────────────────────────────────────────────────────
  ipcMain.removeHandler('test-model-chat');
  ipcMain.handle('test-model-chat', async (event, payload) => {
    return await handleTestChat(event, payload);
  });

  // ── fetch-models ──────────────────────────────────────────────────────────
  const PROVIDER_MODELS_CONFIG = {
    openai:     { url: 'https://api.openai.com/v1/models',                                       auth: 'bearer',    format: 'openai'   },
    anthropic:  { url: 'https://api.anthropic.com/v1/models',                                    auth: 'anthropic', format: 'anthropic'},
    groq:       { url: 'https://api.groq.com/openai/v1/models',                                  auth: 'bearer',    format: 'openai'   },
    mistral:    { url: 'https://api.mistral.ai/v1/models',                                       auth: 'bearer',    format: 'openai'   },
    xai:        { url: 'https://api.x.ai/v1/models',                                             auth: 'bearer',    format: 'openai'   },
    moonshot:   { url: 'https://api.moonshot.cn/v1/models',                                      auth: 'bearer',    format: 'openai'   },
    deepseek:   { url: 'https://api.deepseek.com/models',                                        auth: 'bearer',    format: 'openai'   },
    together:   { url: 'https://api.together.xyz/v1/models',                                     auth: 'bearer',    format: 'together' },
    nvidia:     { url: 'https://integrate.api.nvidia.com/v1/models',                             auth: 'bearer',    format: 'openai'   },
    qwen:       { url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',               auth: 'bearer',    format: 'openai'   },
    cerebras:   { url: 'https://api.cerebras.ai/v1/models',                                      auth: 'bearer',    format: 'openai'   },
    venice:     { url: 'https://api.venice.ai/api/v1/models',                                    auth: 'bearer',    format: 'openai'   },
    openrouter: { url: 'https://openrouter.ai/api/v1/models',                                    auth: 'bearer',    format: 'openrouter'},
    google:     { url: 'https://generativelanguage.googleapis.com/v1beta/models',                auth: 'google',    format: 'google'   },
  };
  ipcMain.removeHandler('fetch-models');
  ipcMain.handle('fetch-models', async (event, { baseUrl, apiKey, providerId }) => {
    let cleanBase = '';
    let format = 'openai';
    let authMethod = 'bearer';

    if (baseUrl && baseUrl.trim()) {
      cleanBase = baseUrl.trim().replace(/\/+$/, '');
      if (!cleanBase.endsWith('/models')) cleanBase += '/models';
    } else if (providerId && PROVIDER_MODELS_CONFIG[providerId]) {
      const config = PROVIDER_MODELS_CONFIG[providerId];
      cleanBase = config.url;
      format = config.format;
      authMethod = config.auth;
    } else {
      return { success: false, models: [], message: 'No base URL or supported providerId provided' };
    }

    try {
      let fetchUrl = cleanBase;
      const headers = { 'Content-Type': 'application/json' };
      const key = apiKey ? apiKey.trim() : '';

      if (authMethod === 'bearer') {
        if (key) headers['Authorization'] = `Bearer ${key}`;
      } else if (authMethod === 'anthropic') {
        if (key) headers['x-api-key'] = key;
        headers['anthropic-version'] = '2023-06-01';
      } else if (authMethod === 'google') {
        if (key) fetchUrl += `?key=${key}`;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(fetchUrl, { headers, signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) return { success: false, models: [], message: `HTTP ${res.status} ${res.statusText}` };
      const js = await res.json();
      let models = [];

      if (format === 'anthropic') {
        models = js?.data?.map?.(m => m.id) || [];
      } else if (format === 'google') {
        models = js?.models?.map?.(m => m.name.replace(/^models\//, '')) || [];
      } else if (format === 'together') {
        let items = Array.isArray(js) ? js : (js?.data || []);
        models = items.filter(m => m.display_type === 'chat' || m.type === 'chat').map(m => m.id).filter(Boolean);
      } else if (format === 'openrouter') {
        models = js?.data?.map?.(m => m.id) || [];
      } else {
        if (js?.data && Array.isArray(js.data)) {
          models = js.data.map(m => m.id).filter(Boolean);
        } else if (Array.isArray(js)) {
          models = js.map(m => m.id || m.name).filter(Boolean);
        }
      }

      models = models.filter(m => {
        const lower = m.toLowerCase();
        if (lower.includes('embedding') || lower.includes('embed')) return false;
        if (lower.includes('whisper') || lower.includes('tts') || lower.includes('stt') || lower.includes('speech') || lower.includes('transcri')) return false;
        if (lower.includes('dall-e') || lower.includes('stable-diffusion') || lower.includes('image')) return false;
        if (lower.includes('moderation') || lower.includes('rerank')) return false;
        
        if (providerId === 'openai') {
          return lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4') || lower.startsWith('chatgpt-');
        }
        if (providerId === 'google') {
          if (lower.includes('aqa')) return false;
          return lower.includes('gemini');
        }
        if (providerId === 'anthropic') {
          return lower.startsWith('claude-');
        }
        if (providerId === 'nvidia') {
          if (lower.includes('vision') || lower.includes('embed') || lower.includes('rerank')) return false;
        }
        if (lower.includes('vision') && providerId !== 'openai' && providerId !== 'google' && providerId !== 'anthropic') return false; 
        
        return true;
      });

      log.info(`[Models] Fetched ${models.length} models from ${cleanBase}`);
      return { success: true, models };
    } catch (err) {
      log.error('[Models] fetch-models failed:', err.message);
      return { success: false, models: [], message: err.message };
    }
  });

  // ── read-gateway-models ───────────────────────────────────────────────────
  // Fetches the model list from the running OpenClaw gateway via its HTTP API.
  // Resilient strategy:
  //   1. Try HTTP /v1/models (with & without auth, on platform port then config port)
  //   2. If prefix filter gives 0 results, return ALL models (don't mask the issue)
  //   3. Fall back to CLI / docker exec only when HTTP is truly unreachable
  ipcMain.removeHandler('read-gateway-models');
  ipcMain.handle('read-gateway-models', async (event, { gatewayModelPrefix, container, port }) => {
    const os = require('os');

    // Read gateway port from: param → openclaw.json → default 18789
    let gatewayPort = port || 18789;
    let tokenStr = null;
    try {
      const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (!port && cfg?.gateway?.port) gatewayPort = cfg.gateway.port;
        tokenStr = cfg?.gateway?.auth?.token || null;
      }
    } catch (_) {}

    // Try one URL with optional auth header. Returns model array or null on failure.
    const tryUrl = async (url, withAuth) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), 5000);
      const headers = { 'Content-Type': 'application/json' };
      if (withAuth && tokenStr) headers['Authorization'] = `Bearer ${tokenStr}`;
      try {
        const res = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timerId);
        if (!res.ok) {
          log.warn(`[GatewayModels] ${url} returned HTTP ${res.status}`);
          return null;
        }
        const js = await res.json();
        const allModels = (js.data || js.models || []).map(m => m.id || m.key).filter(Boolean);
        log.info(`[GatewayModels] ${url} returned ${allModels.length} total models`);
        return allModels;
      } catch (e) {
        clearTimeout(timerId);
        log.warn(`[GatewayModels] ${url} fetch failed: ${e.message}`);
        return null;
      }
    };

    // ── Step 1: Try HTTP gateway API ──────────────────────────────────────────
    const candidates = [
      `http://127.0.0.1:${gatewayPort}/v1/models`,
      `http://localhost:${gatewayPort}/v1/models`,
    ];

    let allModels = null;
    for (const url of candidates) {
      // Try with auth first, then without (gateway might not enforce auth on /v1/models)
      allModels = await tryUrl(url, true);
      if (allModels === null && tokenStr) {
        allModels = await tryUrl(url, false);
      }
      if (allModels !== null) break;
    }

    if (allModels !== null) {
      // Apply prefix filter if requested. If filter gives 0 results, return ALL models
      // so the user can still pick one — they'll just need to scroll past others.
      let filtered = allModels;
      if (gatewayModelPrefix) {
        const prefixMatched = allModels.filter(m => m.startsWith(gatewayModelPrefix));
        filtered = prefixMatched.length > 0 ? prefixMatched : allModels;
        if (prefixMatched.length === 0 && allModels.length > 0) {
          log.info(`[GatewayModels] No models with prefix "${gatewayModelPrefix}", returning all ${allModels.length} models`);
        }
      }
      return { success: true, models: filtered };
    }

    // ── Step 2: Fall back to CLI / docker exec ────────────────────────────────
    const cliResult = await new Promise((resolve) => {
      const { exec } = require('child_process');
      let cmd = 'openclaw models list --json';
      if (container) {
        cmd = `docker exec ${container} openclaw models list --json`;
      }
      // Pass both stdout AND stderr; some CLI versions write JSON to stdout even
      // on non-zero exit, and some write errors to stderr while stdout has useful data.
      exec(cmd, { timeout: 10000, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          // Try to parse stdout anyway — some CLI tools exit non-zero but still emit JSON
          try {
            if (stdout && stdout.trim().startsWith('{')) {
              const js = JSON.parse(stdout);
              let models = (js.models || []).filter(m => m.available !== false).map(m => m.key).filter(Boolean);
              if (models.length > 0) {
                if (gatewayModelPrefix) {
                  const prefixMatched = models.filter(m => m.startsWith(gatewayModelPrefix));
                  models = prefixMatched.length > 0 ? prefixMatched : models;
                }
                log.info(`[GatewayModels] CLI (stderr-exit) returned ${models.length} models`);
                return resolve({ success: true, models });
              }
            }
          } catch (_) {}
          log.warn('[GatewayModels] CLI fallback failed:', err.message.slice(0, 120));
          return resolve(null); // signal "try next step"
        }
        try {
          const js = JSON.parse(stdout);
          let models = (js.models || []).filter(m => m.available !== false).map(m => m.key).filter(Boolean);
          if (gatewayModelPrefix) {
            const prefixMatched = models.filter(m => m.startsWith(gatewayModelPrefix));
            models = prefixMatched.length > 0 ? prefixMatched : models;
          }
          log.info(`[GatewayModels] CLI returned ${models.length} models`);
          resolve({ success: true, models });
        } catch (parseErr) {
          log.warn('[GatewayModels] CLI JSON parse failed:', parseErr.message);
          resolve(null);
        }
      });
    });

    if (cliResult) return cliResult;

    // ── Step 3: Last resort — read active model from openclaw.json ────────────
    // The /v1/models endpoint may not be implemented in all OpenClaw versions,
    // and `openclaw models list` may not be a valid command. But openclaw.json
    // always has the currently configured model written by ClawExpress on save.
    try {
      const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const modelField = cfg?.agents?.defaults?.model;
        const modelStr = typeof modelField === 'string' ? modelField
          : (typeof modelField?.primary === 'string' ? modelField.primary : null);
        if (modelStr) {
          log.info(`[GatewayModels] Fallback: read active model from openclaw.json: ${modelStr}`);
          return { success: true, models: [modelStr], fromConfig: true };
        }
      }
    } catch (_) {}

    return { success: false, models: [], message: `Gateway HTTP API did not respond on port ${gatewayPort}, and the model list command is unavailable. OpenClaw may still be starting up — try again in a moment.`, gatewayPort };

  });


  // ── verify-api-key ────────────────────────────────────────────────────────
  ipcMain.removeHandler('verify-api-key');
  ipcMain.handle('verify-api-key', async (event, { providerId, apiKey, baseUrl }) => {
    const isCustomProxy = providerId === 'custom' || providerId === 'local';
    if (!apiKey?.trim() && !isCustomProxy) return { valid: false, message: 'API key is empty' };

    const key    = apiKey?.trim() || 'sk-dummy-key';
    const CONFIG = buildProviderConfig(key);

    try {
      const target = CONFIG[providerId];
      if (target) {
        let fetchUrl = target.url;
        if (baseUrl && baseUrl.trim()) {
          let cleanBase = baseUrl.trim().replace(/\/+$/, '');
          if (!cleanBase.endsWith('/models') && !cleanBase.endsWith('/auth/key') && !cleanBase.endsWith('/whoami-v2')) {
            if (target.url.endsWith('/models')) cleanBase += '/models';
            else if (target.url.includes('/auth/key')) cleanBase += '/auth/key';
          }
          fetchUrl = cleanBase;
        }
        log.info(`[Auth] Verifying ${providerId} via ${fetchUrl}...`);
        const controller = new AbortController();
        const timeoutId  = setTimeout(() => controller.abort(), 6000);
        try {
          const res = await fetch(fetchUrl, { headers: target.headers, signal: controller.signal });
          clearTimeout(timeoutId);
          if (res.ok) {
            let fetchedModels = [];
            try {
              const js = JSON.parse(await res.text());
              if (js?.data && Array.isArray(js.data)) fetchedModels = js.data.map(m => m.id).filter(Boolean);
            } catch (_) {}
            return { valid: true, models: fetchedModels };
          }
          const txt = await res.text().catch(() => '');
          let errStr = res.statusText;
          try {
            const js = JSON.parse(txt);
            if (js.error?.message) errStr = js.error.message;
          } catch (_) {}
          return { valid: false, message: `${res.status} ${errStr}` };
        } catch (networkErr) {
          clearTimeout(timeoutId);
          log.error('[Auth] Provider network error:', networkErr.message);
          return { valid: false, message: networkErr.message };
        }
      }
      return { valid: true, message: 'Provider check bypassed (unsupported network check)' };
    } catch (err) {
      log.error(`[Auth] verify-api-key failed for ${providerId}:`, err.message);
      return { valid: false, message: `Network error: ${err.message}` };
    }
  });

  // ── register-model-alias ──────────────────────────────────────────────────
  ipcMain.handle('register-model-alias', async (event, { alias, target }) => {
    if (!alias || !target) return { success: false, reason: 'alias and target required' };
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      exec(`npx openclaw models aliases add "${alias}" "${target}"`, (err, stdout, stderr) => {
        if (err) {
          log.error('[Alias] Failed:', err.message, stderr);
          resolve({ success: false, reason: err.message });
        } else {
          log.info('[Alias] Registered:', alias, '->', target);
          resolve({ success: true, alias, target });
        }
      });
    });
  });

  // ── channel-pairing-accept ────────────────────────────────────────────────
  ipcMain.handle('channel-pairing-accept', async (event, { channel, code, cwd, method, version, platformId }) => {
    if (!code) return { success: false, reason: 'Pairing code is required' };
    if (!channel) return { success: false, reason: 'Channel is required' };
    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const isWin = process.platform === 'win32';
      
      let cmdToRun = `npx openclaw pairing approve ${channel} "${code}"`;
      if (method === 'docker') {
         const os = require('os');
         const path = require('path');
         const openclawDir = path.join(os.homedir(), '.openclaw');
         const dockerMountSrc = openclawDir;
         // Rely entirely on the :latest tag since installer/updater handle syncing it locally
         const targetImage = `ghcr.io/openclaw/openclaw:latest`;
         const containerName = `openclaw-${platformId}`;
         const pairingCmd = `node openclaw.mjs pairing approve ${channel} "${code}"`;
         const nullRedirect = isWin ? '2>nul' : '2>/dev/null';
         
         // Try to exec in running container, if it fails, run ad-hoc container
         cmdToRun = `docker exec ${containerName} ${pairingCmd} ${nullRedirect} || docker run --rm -v "${dockerMountSrc}:/home/node/.openclaw" ${targetImage} ${pairingCmd}`;
      }

      exec(cmdToRun, { cwd: cwd || process.cwd() }, (err, stdout, stderr) => {
        if (err) {
          log.error('[Pairing] Failed:', err.message, stderr);
          resolve({ success: false, reason: stderr || err.message });
        } else {
          log.info('[Pairing] Accepted:', code);
          resolve({ success: true, message: stdout });
        }
      });
    });
  });

  // ── connections-load / connections-save (override duplicates in storage.js) ─
  ipcMain.removeHandler('connections-load');
  ipcMain.handle('connections-load', async () => {
    const file = path.join(app.getPath('userData'), 'connections.json');
    if (!fs.existsSync(file)) return [];
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return []; }
  });

  ipcMain.removeHandler('connections-save');
  ipcMain.handle('connections-save', async (event, data) => {
    const file = path.join(app.getPath('userData'), 'connections.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return { success: true };
  });


  // ── OpenFang TOML config handlers ─────────────────────────────────────────
  const OPENFANG_DIR    = () => path.join(require('os').homedir(), '.openfang');
  const OPENFANG_TOML   = () => path.join(OPENFANG_DIR(), 'config.toml');
  const OPENFANG_HIST   = () => path.join(OPENFANG_DIR(), 'history');

  ipcMain.removeHandler('read-raw-openfang-config');
  ipcMain.handle('read-raw-openfang-config', () => {
    const tomlPath = OPENFANG_TOML();
    try {
      if (fs.existsSync(tomlPath)) {
        return { success: true, text: fs.readFileSync(tomlPath, 'utf8') };
      }
      return { success: false, reason: 'config.toml not found — start OpenFang once to generate it.' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  ipcMain.removeHandler('write-raw-openfang-config');
  ipcMain.handle('write-raw-openfang-config', (event, { rawToml }) => {
    const tomlPath = OPENFANG_TOML();
    const histDir  = OPENFANG_HIST();
    try {
      // Backup current file
      if (fs.existsSync(tomlPath)) {
        if (!fs.existsSync(histDir)) fs.mkdirSync(histDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        fs.copyFileSync(tomlPath, path.join(histDir, `config.toml.rev-${ts}`));
        // Keep only last 15 backups
        const backups = fs.readdirSync(histDir).filter(f => f.startsWith('config.toml.rev-')).sort().reverse();
        if (backups.length > 15) backups.slice(15).forEach(f => { try { fs.unlinkSync(path.join(histDir, f)); } catch (_) {} });
      }
      const dir = OPENFANG_DIR();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tomlPath, rawToml, 'utf8');
      log.info('[Config] Written ~/.openfang/config.toml');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-raw-openfang-config failed:', err.message);
      return { success: false, reason: err.message };
    }
  });

  ipcMain.removeHandler('get-openfang-config-history');
  ipcMain.handle('get-openfang-config-history', () => {
    const histDir = OPENFANG_HIST();
    try {
      if (!fs.existsSync(histDir)) return { success: true, history: [] };
      const files = fs.readdirSync(histDir)
        .filter(f => f.startsWith('config.toml.rev-'))
        .sort().reverse()
        .map(f => {
          const m = f.match(/rev-(.*)$/);
          return { filename: f, dateStr: m ? m[1].replace(/-/g, ':') : f };
        });
      return { success: true, history: files };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  ipcMain.removeHandler('restore-openfang-config-history');
  ipcMain.handle('restore-openfang-config-history', (event, { filename }) => {
    const target = path.join(OPENFANG_HIST(), filename);
    try {
      if (!fs.existsSync(target)) throw new Error('Backup not found');
      return { success: true, text: fs.readFileSync(target, 'utf8') };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  log.info('[configHandler] IPC handlers registered.');
}

module.exports = { registerConfigHandlers };
