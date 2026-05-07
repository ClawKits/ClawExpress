const fs = require('fs');
const path = require('path');
const net = require('net');
const os = require('os');
const log = require('../logger');
const { spawn } = require('child_process');
const { prepareConfigForDocker, prepareConfigForNpm, stopPlatform } = require('../processManager');
const { safeWriteOpenClawConfig } = require('../runners/openclaw.runner');
const { syncCodexAuthProfile } = require('../openclawCodexAuth');

const channelLoginProcs = new Map();
const GATEWAY_LOGIN_CHANNELS = new Set(['web', 'whatsapp', 'zalouser']);

const CHANNEL_TOKENS = [
  { tokenKey: 'TELEGRAM_BOT_TOKEN', channel: 'telegram' },
  { tokenKey: 'DISCORD_BOT_TOKEN',  channel: 'discord'  },
  { tokenKey: 'SLACK_BOT_TOKEN',    channel: 'slack'    },
  { tokenKey: 'ZALO_BOT_TOKEN',     channel: 'zalo'     },
  { tokenKey: 'LINE_CHANNEL_TOKEN', channel: 'line'     },
  { tokenKey: 'MSTEAMS_BOT_TOKEN',  channel: 'msteams'  },
  { tokenKey: 'TWITCH_TOKEN',       channel: 'twitch'   },
];

const MANAGED_MODEL_PREFIXES = [
  'litellm/',
  'deepseek/',
  'openai/',
  'openai-codex/',
  'anthropic/',
  'gemini/',
  'groq/',
  'nvidia_nim/',
  'openrouter/',
  'xai/',
  'together_ai/',
  'moonshot/',
  'mistral/',
];

function stripManagedModelPrefix(model) {
  if (!model || typeof model !== 'string') return '';
  const prefix = MANAGED_MODEL_PREFIXES.find(p => model.toLowerCase().startsWith(p));
  return prefix ? model.slice(prefix.length) : model;
}

// Recursively strips all known provider prefixes until only the bare model name remains.
// e.g. 'openai-codex/openai/gpt-5.4' → 'gpt-5.4'
function stripAllManagedPrefixes(model) {
  if (!model || typeof model !== 'string') return '';
  let result = model;
  let changed = true;
  while (changed) {
    changed = false;
    const prefix = MANAGED_MODEL_PREFIXES.find(p => result.toLowerCase().startsWith(p));
    if (prefix) { result = result.slice(prefix.length); changed = true; }
  }
  return result;
}

function pruneManagedModelState(existing, activeProvider, activeModel) {
  if (!existing || !activeProvider) return;

  const keepLiteLLM = activeProvider === 'custom' || activeProvider === 'deepseek' || activeProvider === 'nvidia';
  if (!keepLiteLLM && existing.models?.providers?.litellm) {
    delete existing.models.providers.litellm;
    if (Object.keys(existing.models.providers).length === 0) delete existing.models.providers;
    if (Object.keys(existing.models).length === 0) delete existing.models;
  }

  if (existing.plugins?.entries && !keepLiteLLM) {
    delete existing.plugins.entries.deepseek;
    delete existing.plugins.entries.litellm;
  }

  const modelMap = existing.agents?.defaults?.models;
  if (modelMap && typeof modelMap === 'object' && !Array.isArray(modelMap)) {
    for (const key of Object.keys(modelMap)) {
      const isManaged = MANAGED_MODEL_PREFIXES.some(prefix => key.toLowerCase().startsWith(prefix));
      if (isManaged && key !== activeModel) delete modelMap[key];
    }
  }
}

async function isPortOpen(port, timeoutMs = 2000) {
  const tryHost = (host) => {
    return new Promise((resolve) => {
      const sock = net.connect({ port, host });
      const timer = setTimeout(() => { 
        log.info(`[isPortOpen] Timeout checking ${host}:${port} after ${timeoutMs}ms`);
        sock.destroy(); resolve(false); 
      }, timeoutMs);
      sock.on('connect', () => { 
        clearTimeout(timer); sock.destroy(); resolve(true); 
      });
      sock.on('error', (err) => { 
        if (err.code !== 'ECONNREFUSED') log.info(`[isPortOpen] Info checking ${host}:${port}: ${err.message}`);
        clearTimeout(timer); resolve(false); 
      });
    });
  };
  
  if (await tryHost('127.0.0.1')) return true;
  if (await tryHost('localhost')) return true;
  if (await tryHost('::1')) return true;
  return false;
}

function tryReadQrFile(channel, maxAgeMs = 5 * 60 * 1000) {
  const qrFileName = `openclaw-${channel}-qr-default.png`;
  const locations = [
    path.join('C:\\tmp', 'openclaw', qrFileName),
    path.join('/tmp', 'openclaw', qrFileName),
    path.join(os.tmpdir(), 'openclaw', qrFileName),
    path.join(os.homedir(), '.openclaw', qrFileName),
    path.join(os.homedir(), '.openclaw', 'tmp', qrFileName),
  ];
  for (const loc of locations) {
    try {
      if (fs.existsSync(loc)) {
        const stat = fs.statSync(loc);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < maxAgeMs && stat.size > 100) {
          const buf = fs.readFileSync(loc);
          return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, path: loc, ageMs };
        }
      }
    } catch (_) {}
  }
  return null;
}

const OpenClawAdapter = {
  id: 'openclaw',
  aliases: [],

  readConfig: ({ cwd }) => {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    try {
      if (fs.existsSync(configPath)) {
        const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
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
  },

  writeConfig: ({ env, envToRemove, model, oauthTokens, customProxyTarget, channelConfig, cwd }) => {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });
    const configPath = path.join(openclawDir, 'openclaw.json');
    try {
      let existing = {};
      if (fs.existsSync(configPath)) {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
      }

      existing.env = { ...(existing.env || {}), ...env };
      if (envToRemove && Array.isArray(envToRemove)) {
        envToRemove.forEach(k => delete existing.env[k]);
      }

      existing.channels = existing.channels || {};
      for (const { tokenKey, channel } of CHANNEL_TOKENS) {
        if (env[tokenKey]) {
          existing.channels[channel] = { ...(existing.channels[channel] || {}), enabled: true, dmPolicy: 'open', allowFrom: ['*'] };
        } else if (envToRemove && envToRemove.includes(tokenKey)) {
          if (existing.channels[channel]) existing.channels[channel].enabled = false;
        }
      }

      if (channelConfig) {
        Object.keys(channelConfig).forEach(ch => {
          existing.channels[ch] = { ...(existing.channels[ch] || {}), ...channelConfig[ch] };
          if (!existing.channels[ch].enabled) existing.channels[ch].enabled = true;
        });
      }

      if (!existing.gateway) existing.gateway = {};
      if (!existing.gateway.mode) existing.gateway.mode = 'local';

      if (env['CLAWEXPRESS_PROVIDER'] === 'codex') {
        syncCodexAuthProfile(openclawDir, env, oauthTokens);
      }

      if (customProxyTarget) {
        const baseUrl = env['OPENAI_BASE_URL'];
        const apiKey  = env['OPENAI_API_KEY'];
        pruneManagedModelState(existing, 'custom', null);
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
        // Always write model as { primary: "..." } object — OpenClaw 2026 schema requires this format
        existing.agents.defaults.model = { primary: `litellm/${customProxyTarget}` };
      } else if (model) {
        existing.agents = existing.agents || {};
        existing.agents.defaults = existing.agents.defaults || {};
        
        let finalModelString = model;
        if (env['CLAWEXPRESS_PROVIDER'] === 'nvidia' && env['NVIDIA_API_KEY']) {
          const modelId = stripManagedModelPrefix(model);
          pruneManagedModelState(existing, 'nvidia', `litellm/${modelId}`);
          existing.models = existing.models || {};
          existing.models.providers = existing.models.providers || {};
          existing.models.providers.litellm = {
            baseUrl: 'https://integrate.api.nvidia.com/v1',
            apiKey: '${NVIDIA_API_KEY}',
            api: 'openai-completions',
            models: [{ id: modelId, name: 'Nvidia NIM Model', input: ['text'], contextWindow: 128000, maxTokens: 8192 }]
          };
          finalModelString = `litellm/${modelId}`;
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
        } else if (env['CLAWEXPRESS_PROVIDER'] === 'deepseek' && env['DEEPSEEK_API_KEY']) {
          const modelId = stripManagedModelPrefix(model);
          pruneManagedModelState(existing, 'deepseek', `litellm/${modelId}`);
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
        } else if (env['CLAWEXPRESS_PROVIDER'] === 'codex') {
          // OpenClaw Codex OAuth format: 'openai-codex/<bare-model>'
          // e.g. 'openai-codex/gpt-5.4' — NOT 'openai-codex/openai/gpt-5.4'
          finalModelString = `openai-codex/${stripAllManagedPrefixes(model)}`;
        } else if (env['CLAWEXPRESS_PROVIDER'] === 'cli_gemini') {
          // Gemini CLI OAuth: route via google/ prefix, auth handled by auth-profiles.json (type: oauth)
          finalModelString = `google/${stripAllManagedPrefixes(model)}`;
          // Sync auth-profiles.json immediately on save
          syncCodexAuthProfile(path.join(os.homedir(), '.openclaw'), env);
        } else if (env['OPENAI_API_KEY'] && !finalModelString.startsWith('openai/') && !finalModelString.startsWith('openai-codex/') && !customProxyTarget) {
          finalModelString = `openai/${model}`;
        }
        pruneManagedModelState(existing, env['CLAWEXPRESS_PROVIDER'], finalModelString);
        // Always write model as { primary: "..." } object — OpenClaw 2026 schema requires this format
        existing.agents.defaults.model = { primary: finalModelString };
      }

      if (cwd && existing.agents?.defaults?.model) {
        const modelStr = typeof existing.agents.defaults.model === 'object' ? existing.agents.defaults.model.primary : existing.agents.defaults.model;
        fs.writeFileSync(path.join(cwd, '.chosen-model'), modelStr, 'utf8');
      }

      safeWriteOpenClawConfig(configPath, JSON.stringify(existing, null, 2));
      log.info('[Config] Written to', configPath, '| model:', model || '(unchanged)');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-platform-config failed:', err.message);
      return { success: false, reason: err.message };
    }
  },

  readRawConfig: () => {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    try {
      if (fs.existsSync(configPath)) {
        return { success: true, text: fs.readFileSync(configPath, 'utf8') };
      }
      return { success: false, reason: 'Config file not found' };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },

  writeRawConfig: ({ rawJson }) => {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    const historyDir = path.join(openclawDir, 'history');
    const configPath = path.join(openclawDir, 'openclaw.json');
    try {
      JSON.parse(rawJson);
      if (fs.existsSync(configPath)) {
        if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = path.join(historyDir, `openclaw.json.rev-${ts}`);
        fs.copyFileSync(configPath, backupPath);
        
        const backups = fs.readdirSync(historyDir).filter(f => f.startsWith('openclaw.json.rev-')).sort().reverse();
        if (backups.length > 15) {
          backups.slice(15).forEach(f => { try { fs.unlinkSync(path.join(historyDir, f)); } catch (_) {} });
        }
      }
      fs.writeFileSync(configPath, rawJson, 'utf8');
      log.info('[Config] Raw JSON config written & backed up successfully');
      return { success: true };
    } catch (err) {
      log.error('[Config] write-raw-config failed:', err.message);
      return { success: false, reason: 'Invalid JSON: ' + err.message };
    }
  },

  getRawConfigHistory: () => {
    const historyDir = path.join(os.homedir(), '.openclaw', 'history');
    try {
      if (!fs.existsSync(historyDir)) return { success: true, history: [] };
      const files = fs.readdirSync(historyDir)
        .filter(f => f.startsWith('openclaw.json.rev-'))
        .sort().reverse().map(f => {
          const m = f.match(/rev-(.*)$/);
          return { filename: f, dateStr: m ? m[1].replace(/-/g, ':') : f };
        });
      return { success: true, history: files };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },

  restoreRawConfig: ({ filename }) => {
    const historyDir = path.join(os.homedir(), '.openclaw', 'history');
    const target = path.join(historyDir, filename);
    try {
      if (!fs.existsSync(target)) throw new Error('Backup file not found');
      return { success: true, text: fs.readFileSync(target, 'utf8') };
    } catch (err) {
      return { success: false, reason: err.message };
    }
  },

  channelCheckLinked: async ({ channel }) => {
    const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
    if (channel === 'whatsapp') {
      const sessionDir = path.join(openclawDir, 'credentials', 'whatsapp', 'default');
      try {
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir);
          if (files.length > 0) return { linked: true, phone: null, message: `WhatsApp session active (${files.length} files)` };
        }
      } catch (_) {}
      return { linked: false };
    }
    if (channel === 'zalouser') {
      const sessionDir = path.join(openclawDir, 'credentials', 'zalouser');
      const credFile = path.join(sessionDir, 'credentials.json');
      try {
        if (fs.existsSync(credFile) && fs.statSync(credFile).size > 10) return { linked: true, phone: null, message: 'Zalo session active' };
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir);
          if (files.length > 0) return { linked: true, phone: null, message: `Zalo session active (${files.length} files)` };
        }
      } catch (_) {}
      return { linked: false };
    }
    return { linked: false, reason: 'unknown-channel' };
  },

  channelLogin: async ({ channel, platformId, platformConfig, event }) => {
    const isWin = process.platform === 'win32';
    const { execSync } = require('child_process');
    
    if (platformConfig?.method === 'docker') {
      const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
      try { execSync(`${runnerCmd} info`, { stdio: 'ignore' }); } catch (err) { return { success: false, reason: 'Container runtime is not running.' }; }
    } else {
      try { const shellOpt = isWin ? 'cmd.exe' : '/bin/bash'; execSync('openclaw --version', { shell: shellOpt, stdio: 'ignore' }); } catch (err) { return { success: false, reason: 'openclaw CLI is missing.' }; }
    }

    if (channelLoginProcs.has(channel)) {
      channelLoginProcs.get(channel).kill();
      channelLoginProcs.delete(channel);
    }

    const send = (type, payload) => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('channel-login-event', { channel, type, ...payload });
    };

    const gatewayPort = platformConfig?.port || 18789;
    const gatewayUp = await isPortOpen(gatewayPort);

    if (GATEWAY_LOGIN_CHANNELS.has(channel)) {
      if (channel === 'whatsapp' || channel === 'web') {
        send('log', { line: '[ClawExpress] Stopping gateway…' });
        if (platformId) {
          stopPlatform(platformId, null, platformConfig?.method, platformConfig?.container);
        } else {
          if (isWin) require('child_process').spawnSync('powershell', ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { timeout: 8000, windowsHide: true });
          else require('child_process').spawnSync('pkill', ['-f', 'openclaw.mjs'], { timeout: 5000 });
        }
        await new Promise(r => setTimeout(r, 2000));

        let ptyCommand, ptyArgs;
        if (platformConfig?.method === 'docker') {
           const openclawDir = path.join(os.homedir(), '.openclaw');
           prepareConfigForDocker(openclawDir);
           const envArgs = [];
           try {
             const cfg = JSON.parse(fs.readFileSync(path.join(openclawDir, 'openclaw.json'), 'utf8'));
             if (cfg.env) { for (const [k, v] of Object.entries(cfg.env)) envArgs.push('-e', `${k}=${v}`); }
           } catch (_) {}
           ptyCommand = 'docker';
           ptyArgs = ['run', ...envArgs, '-e', 'CI=1', '-it', '--rm', '-v', `${openclawDir}:/home/node/.openclaw`, `ghcr.io/openclaw/openclaw:latest`, 'node', 'openclaw.mjs', 'channels', 'login', '--channel', 'whatsapp'];
        } else {
           prepareConfigForNpm(platformConfig?.port || 18789);
           ptyCommand = isWin ? 'cmd.exe' : 'openclaw';
           ptyArgs    = isWin ? ['/c', 'openclaw', 'channels', 'login', '--channel', 'whatsapp'] : ['channels', 'login', '--channel', 'whatsapp'];
        }
        send('terminal-opened', { platformId, platformConfig, command: ptyCommand, args: ptyArgs });
        return { success: true };
      }

      if (channel === 'zalouser') {
        send('log', { line: '[ClawExpress] Initiating Zalo connection (Standalone mode)...' });
        if (await isPortOpen(gatewayPort)) {
          if (isWin) {
             try {
                const out = require('child_process').execSync(`netstat -ano | findstr :${gatewayPort}`).toString();
                const lines = out.split('\\n').filter(l => l.includes('LISTENING'));
                if (lines.length > 0) {
                    const parts = lines[0].trim().split(/\\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid) {
                        send('log', { line: `[ClawExpress] Terminating phantom process (PID: ${pid})...` });
                        require('child_process').execSync(`taskkill /F /PID ${pid}`);
                    }
                }
             } catch(e) {}
             await new Promise(r => setTimeout(r, 1000));
          }
          if (await isPortOpen(gatewayPort)) {
            send('error', { message: `Gateway process is still holding Port ${gatewayPort}.` });
            return { success: false, reason: 'gateway-must-stop' };
          }
        }

        const qrFileName = `openclaw-${channel}-qr-default.png`;
        const qrLocations = [
          path.join('C:\\tmp', 'openclaw', qrFileName), path.join('/tmp', 'openclaw', qrFileName),
          path.join(os.tmpdir(), 'openclaw', qrFileName), path.join(os.homedir(), '.openclaw', qrFileName),
          path.join(os.homedir(), '.openclaw', 'tmp', qrFileName),
        ];
        for (const loc of qrLocations) { try { if (fs.existsSync(loc)) fs.unlinkSync(loc); } catch (_) {} }

        let cliCmd, cliArgs, containerName;
        if (platformConfig?.method === 'docker') {
           const openclawDir = path.join(os.homedir(), '.openclaw');
           prepareConfigForDocker(openclawDir);
           const envArgs = [];
           try {
             const cfg = JSON.parse(fs.readFileSync(path.join(openclawDir, 'openclaw.json'), 'utf8'));
             if (cfg.env) { for (const [k, v] of Object.entries(cfg.env)) envArgs.push('-e', `${k}=${v}`); }
           } catch (_) {}
           
           fs.mkdirSync(path.join(openclawDir, 'tmp'), { recursive: true });
           containerName = `openclaw_zalo_${Date.now()}`;
           cliCmd = 'docker';
           cliArgs = ['run', '--name', containerName, ...envArgs, '-e', 'CI=1', '-it', '--rm', '-v', `${openclawDir}:/home/node/.openclaw`, `ghcr.io/openclaw/openclaw:latest`, 'node', 'openclaw.mjs', 'channels', 'login', '--channel', channel];
        } else {
           prepareConfigForNpm(platformConfig?.port || 18789);
           cliCmd = isWin ? 'cmd.exe' : 'openclaw';
           cliArgs = isWin ? ['/c', 'openclaw', 'channels', 'login', '--channel', channel] : ['channels', 'login', '--channel', channel];
        }
        
        const cliEnv = { ...process.env };
        delete cliEnv.CI; delete cliEnv.TERM; cliEnv.NO_COLOR = '1'; cliEnv.FORCE_COLOR = '0';

        send('terminal-opened', { platformId, platformConfig, command: cliCmd, args: cliArgs, env: cliEnv });
        
        let qrFileFound = false;
        let done = false;
        channelLoginProcs.set(channel, { kill: () => { done = true; } });

        const pollInterval = setInterval(() => {
          if (done) { clearInterval(pollInterval); return; }
          if (platformConfig?.method === 'docker' && containerName) {
            try {
              const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
              require('child_process').execSync(`${runnerCmd} exec ${containerName} sh -c "mkdir -p /home/node/.openclaw/tmp && find /tmp -name '${qrFileName}' -exec cp {} /home/node/.openclaw/tmp/${qrFileName} \\;"`, { stdio: 'ignore' });
            } catch (e) {}
          }
          const qr = tryReadQrFile(channel, 5 * 60 * 1000);
          if (qr && !qrFileFound) {
            qrFileFound = true;
            clearInterval(pollInterval);
            send('qr-image', { dataUrl: qr.dataUrl });
            send('log', { line: `[ClawExpress] ✅ Zalo QR file detected on disk — Please scan it with your phone!` });
          }
        }, 2000);

        setTimeout(() => {
          if (!done) {
            done = true;
            clearInterval(pollInterval);
            send('error', { message: 'Zalo QR generation timed out.' });
            send('close', { code: 1 });
          }
        }, 5 * 60 * 1000);

        return { success: true };
      }
      send('error', { message: 'Could not generate QR code.' });
      return { success: false, reason: 'no-qr' };
    }
    send('error', { message: `Channel "${channel}" is not supported for QR login.` });
    return { success: false, reason: 'unsupported-channel' };
  },

  channelLogout: async ({ channel }) => {
    if (channelLoginProcs.has(channel)) {
      const proc = channelLoginProcs.get(channel);
      if (process.platform === 'win32') {
        try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch (_) {}
      } else {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }
      channelLoginProcs.delete(channel);
    }
    const tryRmDir = async (dirPath) => {
      const delays = [0, 1000, 2000, 3000];
      let lastErr = null;
      for (const delay of delays) {
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        try { if (fs.existsSync(dirPath)) fs.rmSync(dirPath, { recursive: true, force: true }); return null; } catch (e) { lastErr = e; }
      }
      return lastErr;
    };
    try {
      const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
      const sessionDir = path.join(openclawDir, 'credentials', channel);
      const err1 = await tryRmDir(sessionDir);
      if (err1) return { success: false, output: `Failed to remove session: ${err1.message}` };

      if (channel === 'zalouser') {
        const fallbackSessionDir = path.join(openclawDir, 'credentials', 'whatsapp', 'zalouser-default');
        const err2 = await tryRmDir(fallbackSessionDir);
        if (err2) return { success: false, output: `Failed to remove fallback: ${err2.message}` };
      }

      try {
        const cfgFile = path.join(openclawDir, 'openclaw.json');
        if (fs.existsSync(cfgFile)) {
          const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
          let changed = false;
          if (cfg.channels && cfg.channels[channel] !== undefined) { delete cfg.channels[channel]; changed = true; }
          if (cfg.plugins && cfg.plugins.entries && cfg.plugins.entries[channel] !== undefined) { delete cfg.plugins.entries[channel]; changed = true; }
          if (changed) fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
        }
      } catch (cfgErr) {}

      return { success: true, output: 'Logged out successfully.' };
    } catch (err) { return { success: false, output: `Failed: ${err.message}` }; }
  },

  channelLoginSuccess: async ({ channel }) => {
    try {
      const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
      const cfgFile = path.join(openclawDir, 'openclaw.json');
      if (fs.existsSync(cfgFile)) {
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        let changed = false;
        cfg.channels = cfg.channels || {};
        if (!cfg.channels[channel]) { cfg.channels[channel] = { enabled: true, dmPolicy: 'pairing' }; changed = true; }
        cfg.plugins = cfg.plugins || {}; cfg.plugins.entries = cfg.plugins.entries || {};
        if (!cfg.plugins.entries[channel] || !cfg.plugins.entries[channel].enabled) { cfg.plugins.entries[channel] = { enabled: true }; changed = true; }
        if (changed) fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
      }
      return { success: true };
    } catch (err) { return { success: false, error: err.message }; }
  },

  channelLoginCancel: ({ channel }) => {
    if (channelLoginProcs.has(channel)) {
      const proc = channelLoginProcs.get(channel);
      if (process.platform === 'win32') { try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch (_) {} }
      else { try { proc.kill('SIGTERM'); } catch (_) {} }
      channelLoginProcs.delete(channel);
      return { success: true };
    }
    return { success: false, reason: 'No active login process' };
  },

  finalizeConfig: (config, writeDir, sendLog) => {
    sendLog('[INFO] Compiling dynamic Global Configuration...');
    try {
      const openclawDir = path.join(os.homedir(), '.openclaw');
      if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });
      const configPath = path.join(openclawDir, 'openclaw.json');

      const llm = config.llm_config || {};

      const selectedProvider = llm.provider || 'openai';
      let providerPrefix = selectedProvider;
      let cliAgentRuntimeId = null;
      if (selectedProvider === 'codex') {
        providerPrefix = 'openai-codex';
      } else if (selectedProvider === 'cli_gemini') {
        // Gemini CLI OAuth: canonical model prefix is 'google/'
        providerPrefix = 'google';
      } else if (selectedProvider === 'openrouter') {
        providerPrefix = 'openrouter';
      }

      const rawModel = llm.model || '';
      const isOpenRouter = providerPrefix === 'openrouter';

      const hasProviderPrefix = rawModel.toLowerCase().startsWith(providerPrefix + '/');
      const assembledModel = hasProviderPrefix ? rawModel : `${providerPrefix}/${rawModel}`;
      const modelFull = isOpenRouter ? 'openrouter/auto' : assembledModel;

      sendLog(`[INFO] Provider prefix: ${providerPrefix}`);
      sendLog(`[INFO] Chosen model: ${assembledModel}`);

      const dynamicEnv = config.env || {};
      if (llm.provider && llm.key) {
        const envKey = llm.provider === 'codex' ? 'OPENAI_CODEX_API_KEY' : `${llm.provider.toUpperCase()}_API_KEY`;
        dynamicEnv[envKey] = llm.key;
        if (llm.baseUrl) {
          dynamicEnv[`${llm.provider.toUpperCase()}_BASE_URL`] = llm.baseUrl;
        }
      }
      
      if (llm.connectionId && llm.provider) {
        dynamicEnv['CLAWEXPRESS_CONNECTION_ID'] = llm.connectionId;
        dynamicEnv['CLAWEXPRESS_PROVIDER'] = llm.provider;
      }
      
      if (config.telegram_token) dynamicEnv.TELEGRAM_BOT_TOKEN = config.telegram_token;

      // Merge into existing config (preserve runtime fields)
      let existing = {};
      try {
        if (fs.existsSync(configPath)) {
          existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        }
      } catch (_) {}

      existing.gateway = existing.gateway || { mode: 'local' };
      existing.gateway.auth = existing.gateway.auth || { mode: 'token' };
      
      existing.env = { ...(existing.env || {}), ...dynamicEnv };
      
      if (llm.provider === 'codex') {
        const { syncCodexAuthProfile } = require('../openclawCodexAuth');
        syncCodexAuthProfile(openclawDir, existing.env, llm.oauthTokens);
      }

      existing.agents = existing.agents || {};
      existing.agents.defaults = existing.agents.defaults || {};
      existing.agents.defaults.model = { primary: modelFull };
      existing.plugins = existing.plugins || {};
      existing.plugins.entries = {
        ...(existing.plugins.entries || {}),
        zalouser: { enabled: true },
        whatsapp: { enabled: true },
      };
      existing.channels = {
        ...(existing.channels || {}),
        telegram: { enabled: Array.isArray(config.channels) && config.channels.includes('telegram') },
        discord:  { enabled: Array.isArray(config.channels) && config.channels.includes('discord') },
      };
      pruneManagedModelState(existing, selectedProvider, existing.agents.defaults.model.primary);


      if (llm.provider === 'custom' || llm.baseUrl) {
        pruneManagedModelState(existing, 'custom', null);
        existing.models = existing.models || {};
        existing.models.providers = existing.models.providers || {};
        existing.models.providers.litellm = {
          baseUrl: llm.baseUrl,
          apiKey: '${' + `${llm.provider.toUpperCase()}_API_KEY` + '}',
          api: 'openai-completions',
          models: [{ id: rawModel.replace(/^(openai|litellm)\//i, ''), name: 'Custom', input: ['text'], contextWindow: 128000 }],
        };
        existing.agents.defaults.model.primary = `litellm/${rawModel.replace(/^(openai|litellm)\//i, '')}`;
      } else if (llm.provider === 'deepseek') {
        const modelId = modelFull.replace('deepseek/', '');
        pruneManagedModelState(existing, 'deepseek', `litellm/${modelId}`);
        existing.models = existing.models || {};
        existing.models.providers = existing.models.providers || {};
        existing.models.providers.litellm = {
          baseUrl: 'https://api.deepseek.com',
          apiKey: '${DEEPSEEK_API_KEY}',
          api: 'openai-completions',
          models: [{ id: modelId, name: 'DeepSeek Model', input: ['text'], contextWindow: 128000, maxTokens: 8192 }]
        };
        existing.agents.defaults.model.primary = `litellm/${modelId}`;
      }

      sendLog(`[INFO] Config model: ${existing.agents.defaults.model.primary}`);
      safeWriteOpenClawConfig(configPath, JSON.stringify(existing, null, 2));
      fs.writeFileSync(path.join(writeDir, '.chosen-model'), assembledModel);
      sendLog(`[SUCCESS] Configuration written to ${configPath}. Chosen model saved: ${assembledModel}`);
    } catch (err) {
      sendLog(`[WARN] Config compiler error: ${err.message}`);
      log.error('[openclaw.adapter] finalizeConfig error:', err);
    }
  }
};

function register(fn) { fn(OpenClawAdapter); }
module.exports = { register, OpenClawAdapter };
