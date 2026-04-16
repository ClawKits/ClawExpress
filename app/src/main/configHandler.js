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

function registerConfigHandlers() {
  // ── read-platform-config ──────────────────────────────────────────────────
  ipcMain.handle('read-platform-config', (event, { cwd }) => {
    // Single source of truth: ~/.openclaw/openclaw.json
    const configPath = path.join(require('os').homedir(), '.openclaw', 'openclaw.json');
    try {
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const modelPrimary = cfg.agents?.defaults?.model;
        return {
          success: true,
          env: cfg.env || {},
          model: typeof modelPrimary === 'string' ? modelPrimary : (modelPrimary?.primary || null),
          channels: cfg.channels || {}
        };
      }
      return { success: false, reason: 'Config file not found' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  // ── write-platform-config ─────────────────────────────────────────────────
  ipcMain.handle('write-platform-config', (event, { cwd, env, envToRemove, model, model_display, customProxyTarget, channelConfig }) => {
    // Single source of truth: ~/.openclaw/openclaw.json
    const os = require('os');
    const openclawDir = path.join(os.homedir(), '.openclaw');
    if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });
    const configPath = path.join(openclawDir, 'openclaw.json');
    try {
      let existing = {};
      if (fs.existsSync(configPath)) {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }

      existing.env = { ...(existing.env || {}), ...env };

      if (envToRemove && Array.isArray(envToRemove)) {
        envToRemove.forEach(k => delete existing.env[k]);
      }

      existing.channels = existing.channels || {};

      for (const { tokenKey, channel } of CHANNEL_TOKENS) {
        if (env[tokenKey]) {
          existing.channels[channel] = {
            ...(existing.channels[channel] || {}),
            enabled: true,
            dmPolicy: 'open',
            allowFrom: ['*'],
          };
        } else if (envToRemove && envToRemove.includes(tokenKey)) {
          if (existing.channels[channel]) existing.channels[channel].enabled = false;
        }
      }

      // Explicit channel config (e.g. WhatsApp/Zalo policies) from UI
      if (channelConfig) {
        Object.keys(channelConfig).forEach(ch => {
          existing.channels[ch] = {
            ...(existing.channels[ch] || {}),
            ...channelConfig[ch]
          };
          // Also ensure the channel is enabled when policy is set
          if (!existing.channels[ch].enabled) {
            existing.channels[ch].enabled = true;
          }
        });
      }

      // ── (Removed dangerous automatic plugins.entries injection here) ──────────────

      // ── Ensure gateway.mode is set to avoid silent drops ──────────────
      if (!existing.gateway) existing.gateway = {};
      if (!existing.gateway.mode) existing.gateway.mode = 'local';

      if (customProxyTarget) {
        const baseUrl = env['OPENAI_BASE_URL'];
        const apiKey  = env['OPENAI_API_KEY'];
        existing.models = existing.models || {};
        existing.models.providers = existing.models.providers || {};
        existing.models.providers.litellm = {
          baseUrl: baseUrl || '',
          apiKey:  apiKey ? '${OPENAI_API_KEY}' : '',
          api: 'openai-completions',
          models: [{ id: customProxyTarget, name: 'Custom Model', input: ['text'], contextWindow: 128000, maxTokens: 8192 }],
        };
        existing.agents = existing.agents || {};
        existing.agents.defaults = existing.agents.defaults || {};
        existing.agents.defaults.model = `litellm/${customProxyTarget}`;
      } else if (model) {
        // Only remove litellm proxy if it was explicitly created by ClawExpress
        // (identified by the 'Custom Model' marker). Preserve other providers that
        // OpenClaw's gateway runtime may have added — removing them triggers the
        // gateway's config size-drop (clobber) protection and blocks startup.
        if (existing.models?.providers?.litellm) {
          const litellmModels = existing.models.providers.litellm.models;
          const isClawExpressProxy = Array.isArray(litellmModels) &&
            litellmModels.some(m => m.name === 'Custom Model');
          if (isClawExpressProxy) {
            delete existing.models.providers.litellm;
          }
        }
        existing.agents = existing.agents || {};
        existing.agents.defaults = existing.agents.defaults || {};
        
        let finalModelString = model;
        // Dynamically auto-prepend Litellm Provider Prefix mapped from env if missing
        if (env['NVIDIA_API_KEY'] && !finalModelString.startsWith('nvidia_nim/')) {
          finalModelString = `nvidia_nim/${model}`;
        } else if (env['GROQ_API_KEY'] && !finalModelString.startsWith('groq/')) {
          finalModelString = `groq/${model}`;
        } else if (env['XAI_API_KEY'] && !finalModelString.startsWith('xai/')) {
          finalModelString = `xai/${model}`;
        } else if (env['OPENROUTER_API_KEY'] && !finalModelString.startsWith('openrouter/')) {
          finalModelString = `openrouter/${model}`;
        } else if (env['ANTHROPIC_API_KEY'] && !finalModelString.startsWith('anthropic/')) {
          finalModelString = `anthropic/${model}`;
        } else if (env['GEMINI_API_KEY'] && !finalModelString.startsWith('gemini/')) {
          finalModelString = `gemini/${model}`;
        } else if (env['DEEPSEEK_API_KEY']) {
          const modelId = model.replace('deepseek/', '');
          existing.models = existing.models || {};
          existing.models.providers = existing.models.providers || {};
          existing.models.providers.litellm = {
            baseUrl: 'https://api.deepseek.com',
            apiKey: '${DEEPSEEK_API_KEY}',
            api: 'openai-completions',
            models: [{ id: modelId, name: 'DeepSeek Model', input: ['text'], contextWindow: 128000, maxTokens: 8192 }]
          };
          finalModelString = `litellm/${modelId}`;
        } else if (env['TOGETHER_API_KEY'] && !finalModelString.startsWith('together_ai/')) {
          finalModelString = `together_ai/${model}`;
        } else if (env['MOONSHOT_API_KEY'] && !finalModelString.startsWith('moonshot/')) {
          finalModelString = `moonshot/${model}`;
        } else if (env['MISTRAL_API_KEY'] && !finalModelString.startsWith('mistral/')) {
          finalModelString = `mistral/${model}`;
        } else if (env['CLAWEXPRESS_PROVIDER'] === 'codex' && !finalModelString.includes('/')) {
          finalModelString = `openai-codex/${model}`;
        } else if (env['OPENAI_API_KEY'] && !finalModelString.startsWith('openai/') && !finalModelString.startsWith('openai-codex/') && !customProxyTarget) {
          finalModelString = `openai/${model}`;
        }
        existing.agents.defaults.model = finalModelString;
      }

      if (cwd && existing.agents?.defaults?.model) {
        fs.writeFileSync(path.join(cwd, '.chosen-model'), existing.agents.defaults.model, 'utf8');
      }

      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf8');
      log.info('[Config] Written to', configPath, '| model:', model || '(unchanged)', customProxyTarget ? `(Native Proxy: ${customProxyTarget})` : '');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-platform-config failed:', err.message);
      return { success: false, reason: err.message };
    }
  });

  // ── Raw Config & History Handlers ──────────────────────────────────────────
  ipcMain.handle('read-raw-config', () => {
    const configPath = path.join(require('os').homedir(), '.openclaw', 'openclaw.json');
    try {
      if (fs.existsSync(configPath)) {
        return { success: true, text: fs.readFileSync(configPath, 'utf8') };
      }
      return { success: false, reason: 'Config file not found' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  ipcMain.handle('write-raw-config', (event, { rawJson }) => {
    const os = require('os');
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const historyDir = path.join(openclawDir, 'history');
    const configPath = path.join(openclawDir, 'openclaw.json');
    
    try {
      // 1. Validate JSON
      JSON.parse(rawJson);
      
      // 2. Make a backup of current if exists
      if (fs.existsSync(configPath)) {
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(historyDir, `openclaw.json.rev-${ts}`);
        fs.copyFileSync(configPath, backupPath);
        
        // 3. Keep only last 15 backups to save space
        const backups = fs.readdirSync(historyDir)
          .filter(f => f.startsWith('openclaw.json.rev-'))
          .sort()
          .reverse();
        if (backups.length > 15) {
          backups.slice(15).forEach(f => {
            try { fs.unlinkSync(path.join(historyDir, f)); } catch (_) {}
          });
        }
      }
      
      // 4. Write new raw config
      fs.writeFileSync(configPath, rawJson, 'utf8');
      log.info('[Config] Raw JSON config written & backed up successfully');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-raw-config failed:', err.message);
      return { success: false, reason: 'Invalid JSON: ' + err.message };
    }
  });

  ipcMain.handle('get-config-history', () => {
    const historyDir = path.join(require('os').homedir(), '.openclaw', 'history');
    try {
      if (!fs.existsSync(historyDir)) return { success: true, history: [] };
      const files = fs.readdirSync(historyDir)
        .filter(f => f.startsWith('openclaw.json.rev-'))
        .sort()
        .reverse()
        .map(f => {
          const m = f.match(/rev-(.*)$/);
          const dateStr = m ? m[1].replace(/-/g, ':') : f; // Basic recovery
          return { filename: f, dateStr: dateStr };
        });
      return { success: true, history: files };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  });

  ipcMain.handle('restore-config-history', (event, { filename }) => {
    const historyDir = path.join(require('os').homedir(), '.openclaw', 'history');
    const target = path.join(historyDir, filename);
    try {
      if (!fs.existsSync(target)) throw new Error('Backup file not found');
      const text = fs.readFileSync(target, 'utf8');
      return { success: true, text };
    } catch (err) {
      return { success: false, reason: err.message };
    }
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
  // Runs `openclaw models list --json` to get the list of models available
  // to the CLI, then filters by gatewayModelPrefix.
  ipcMain.removeHandler('read-gateway-models');
  ipcMain.handle('read-gateway-models', async (event, { gatewayModelPrefix }) => {
    const { execFile } = require('child_process');
    return new Promise((resolve) => {
      execFile('openclaw', ['models', 'list', '--json'], { timeout: 10000 }, (err, stdout) => {
        if (err) {
          log.error('[GatewayModels] openclaw models list failed:', err.message);
          return resolve({ success: false, models: [], message: err.message });
        }
        try {
          const js = JSON.parse(stdout);
          let models = (js.models || [])
            .filter(m => m.available !== false)
            .map(m => m.key)
            .filter(Boolean);
          if (gatewayModelPrefix) {
            models = models.filter(m => m.startsWith(gatewayModelPrefix));
          }
          log.info(`[GatewayModels] openclaw models list returned ${models.length} models`);
          resolve({ success: true, models });
        } catch (parseErr) {
          log.error('[GatewayModels] JSON parse failed:', parseErr.message);
          resolve({ success: false, models: [], message: parseErr.message });
        }
      });
    });
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

  log.info('[configHandler] IPC handlers registered.');
}

module.exports = { registerConfigHandlers };
