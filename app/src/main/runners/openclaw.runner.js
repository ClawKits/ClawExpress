/**
 * runners/openclaw.runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All OpenClaw-specific lifecycle logic:
 *   • Config patching (Docker ↔ NPM switch)
 *   • Zombie gateway cleanup
 *   • Script/volume/env injection for docker & npm methods
 *   • Pairing-code watcher (Zalo personal channel)
 *   • Post-start model-apply CLI call
 * ─────────────────────────────────────────────────────────────────────────────
 */

const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const { fireSpawn, startReadyPoller } = require('./shared');
const { syncCodexAuthProfile } = require('../openclawCodexAuth');

/**
 * Safely write openclaw.json AND update backup files simultaneously.
 * 
 * OpenClaw has an internal "config integrity" mechanism that detects when
 * the config file shrinks compared to openclaw.json.last-good, and auto-
 * restores from the backup — clobbering our legitimate changes.
 * 
 * By writing the same content to both files atomically, the size-drop
 * comparison always passes (new == last-good), so OpenClaw never triggers
 * the auto-restore.
 * 
 * @param {string} configPath - Full path to openclaw.json
 * @param {string} jsonContent - The JSON string to write
 */
function safeWriteOpenClawConfig(configPath, jsonContent) {
  fs.writeFileSync(configPath, jsonContent, 'utf8');
  // Update the backup files so OpenClaw's size-drop detection never triggers
  const dir = path.dirname(configPath);
  try { fs.writeFileSync(path.join(dir, 'openclaw.json.last-good'), jsonContent, 'utf8'); } catch (_) {}
  try { fs.writeFileSync(path.join(dir, 'openclaw.json.bak'), jsonContent, 'utf8'); } catch (_) {}
}

// ── Config helpers ────────────────────────────────────────────────────────────

function removeDockerPaths(obj, dockerBase) {
  if (!obj || typeof obj !== 'object') return false;
  let modified = false;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && val.includes(dockerBase)) {
      delete obj[key];
      modified = true;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      if (removeDockerPaths(val, dockerBase)) modified = true;
    }
  }
  return modified;
}

function containsStalePath(val) {
  if (typeof val === 'string') return val.includes('/home/node/') || val.includes('\\home\\node\\') || val.includes('/app/skills/') || val.includes('node_modules');
  if (Array.isArray(val)) return val.some(containsStalePath);
  if (val && typeof val === 'object') return Object.values(val).some(containsStalePath);
  return false;
}

function fixSessionFilePaths(openclawDir, isDocker = false) {
  try {
    const agentsDir = path.join(openclawDir, 'agents');
    if (!fs.existsSync(agentsDir)) return;
    for (const agentName of fs.readdirSync(agentsDir)) {
      const sessionsJson = path.join(agentsDir, agentName, 'sessions', 'sessions.json');
      if (!fs.existsSync(sessionsJson)) continue;
      try {
        const sessions = JSON.parse(fs.readFileSync(sessionsJson, 'utf8'));
        const sessionsDir = path.join(agentsDir, agentName, 'sessions');
        let modified = false;
        for (const session of Object.values(sessions)) {
          if (session.sessionFile) {
            const hasDockerPath = session.sessionFile.includes('\\home\\node\\') || session.sessionFile.includes('/home/node/');
            const hasWindowsPath = session.sessionFile.includes(':\\');
            const hasHostPath = hasWindowsPath || (session.sessionFile.startsWith('/') && !hasDockerPath);

            if (isDocker && hasHostPath) {
              session.sessionFile = `/home/node/.openclaw/agents/${agentName}/sessions/${path.basename(session.sessionFile)}`;
              modified = true;
            } else if (!isDocker && hasDockerPath) {
              session.sessionFile = path.join(sessionsDir, path.basename(session.sessionFile));
              modified = true;
            }
          }
          if (session.skillsSnapshot && containsStalePath(session.skillsSnapshot)) {
            delete session.skillsSnapshot;
            modified = true;
          }
          if (session.systemPromptReport && containsStalePath(session.systemPromptReport)) {
            delete session.systemPromptReport;
            modified = true;
          }
        }
        if (modified) fs.writeFileSync(sessionsJson, JSON.stringify(sessions, null, 2), 'utf8');
      } catch (_) {}
    }
  } catch (_) {}
}

const FAKE_PLUGINS = ['whatsapp', 'zalo', 'zalouser', 'telegram', 'discord', 'litellm', 'deepseek', 'openai', 'anthropic', 'google', 'groq', 'mistral', 'xai', 'moonshot', 'together_ai', 'openrouter', 'nvidia'];

function removeFakePlugins(cfg) {
  let modified = false;
  if (cfg.plugins?.entries) {
    for (const fake of FAKE_PLUGINS) {
      if (cfg.plugins.entries[fake]) { delete cfg.plugins.entries[fake]; modified = true; }
    }
  }
  return modified;
}

function coerceModel(cfg) {
  // DO NOTHING. Mutating model to a string breaks OpenClaw 2026 schema validation
  // which expects `model: { primary: "..." }`
  return false;
}

function removePublishMappings(scriptArr, shouldRemove) {
  for (let i = 0; i < scriptArr.length; i++) {
    const arg = scriptArr[i];
    if ((arg === '-p' || arg === '--publish') && typeof scriptArr[i + 1] === 'string' && shouldRemove(scriptArr[i + 1])) {
      scriptArr.splice(i, 2);
      i -= 1;
      continue;
    }

    if (typeof arg === 'string' && (arg.startsWith('-p=') || arg.startsWith('--publish='))) {
      const mapping = arg.slice(arg.indexOf('=') + 1);
      if (shouldRemove(mapping)) {
        scriptArr.splice(i, 1);
        i -= 1;
      }
    }
  }
}

/**
 * Prepare openclaw.json for NPM (host) mode.
 * Clears Docker-specific paths, resets gateway.bind, patches allowedOrigins.
 */
function prepareConfigForNpm(port) {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
    let modified = false;

    if (!cfg.gateway) cfg.gateway = {};

    // Always remove bind — Docker needs 'lan', NPM must use default loopback.
    // Using delete ensures OpenClaw picks up its own default (127.0.0.1).
    if ('bind' in cfg.gateway) { delete cfg.gateway.bind; modified = true; }

    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {};
    if (!cfg.gateway.auth) cfg.gateway.auth = { mode: 'token' };

    // Replace allowedOrigins entirely with only the target port.
    // Stale ports from previous runs cause WS upgrade rejections when OpenClaw
    // auto-increments the port (e.g. 18789 → 18791) due to a zombie holding 18789.
    const required = [
      "*",
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
      `http://localhost:5173`,
      `http://127.0.0.1:5173`,
      `app://.`,
      `file://`
    ];
    const existing = cfg.gateway.controlUi.allowedOrigins || [];
    // Rebuild: keep non-port-specific entries, replace any :PORT entries with target.
    const rebuilt = [
      ...existing.filter(o => !o.match(/:\d+$/)),
      ...required,
    ];
    const deduped = [...new Set(rebuilt)];
    if (JSON.stringify(deduped) !== JSON.stringify(existing)) {
      cfg.gateway.controlUi.allowedOrigins = deduped;
      modified = true;
    }

    fixSessionFilePaths(path.join(os.homedir(), '.openclaw'));
    syncCodexAuthProfile(path.join(os.homedir(), '.openclaw'), cfg.env);
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;
    if (removeFakePlugins(cfg)) modified = true;
    // Removed coerceModel call to prevent schema breaking

    if (modified) safeWriteOpenClawConfig(cfgPath, JSON.stringify(cfg, null, 2));
  } catch (_) {}
}


/**
 * Prepare openclaw.json for Docker mode.
 * Sets gateway.bind = 'lan' so the Docker port mapping reaches the host.
 */
function prepareConfigForDocker(openclawDir, gatewayPort = 18789) {
  try {
    const cfgPath = path.join(openclawDir, 'openclaw.json');
    let cfg = {};
    if (fs.existsSync(cfgPath)) cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));

    fixSessionFilePaths(openclawDir, true);
    syncCodexAuthProfile(openclawDir, cfg.env);
    let modified = false;

    if (!cfg.gateway) cfg.gateway = {};
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;

    // Normalize model IDs: strip stacked provider prefixes (e.g. 'openai-codex/openai/gpt-5.4')
    // and rebuild to the correct single-prefix form OpenClaw expects.
    const OPENCLAW_MODEL_PREFIXES = ['openai-codex/', 'openai/', 'litellm/', 'anthropic/', 'gemini/',
      'groq/', 'deepseek/', 'openrouter/', 'xai/', 'together_ai/', 'moonshot/', 'mistral/', 'nvidia_nim/'];
    const stripAllPrefixes = (str) => {
      let s = str; let changed = true;
      while (changed) {
        changed = false;
        const p = OPENCLAW_MODEL_PREFIXES.find(px => s.toLowerCase().startsWith(px));
        if (p) { s = s.slice(p.length); changed = true; }
      }
      return s;
    };
    const normalizeModelForOpenClaw = (modelStr) => {
      if (typeof modelStr !== 'string') return modelStr;
      // Re-apply the correct top-level prefix based on the original prefix.
      if (modelStr.toLowerCase().startsWith('openai-codex/')) {
        return `openai-codex/${stripAllPrefixes(modelStr)}`;
      }
      // All other prefixes: strip down to single-prefix form.
      const p = OPENCLAW_MODEL_PREFIXES.find(px => modelStr.toLowerCase().startsWith(px));
      if (!p) return modelStr;
      const bare = stripAllPrefixes(modelStr);
      return `${p}${bare}`;
    };
    if (cfg.agents) {
      const applyToDefaults = (defaults) => {
        if (!defaults) return false;
        let m = false;
        if (typeof defaults.model === 'string') {
          const fixed = normalizeModelForOpenClaw(defaults.model);
          if (fixed !== defaults.model) { defaults.model = fixed; m = true; }
        } else if (defaults.model && typeof defaults.model === 'object') {
          if (typeof defaults.model.primary === 'string') {
            const fixed = normalizeModelForOpenClaw(defaults.model.primary);
            if (fixed !== defaults.model.primary) { defaults.model.primary = fixed; m = true; }
          }
        }
        if (defaults.models && typeof defaults.models === 'object') {
          const fixedModels = {};
          for (const [k, v] of Object.entries(defaults.models)) {
            const fk = normalizeModelForOpenClaw(k);
            fixedModels[fk] = v;
            if (fk !== k) m = true;
          }
          if (m) defaults.models = fixedModels;
        }
        return m;
      };
      if (applyToDefaults(cfg.agents.defaults)) modified = true;
    }

    if (cfg.gateway.bind !== 'lan') { cfg.gateway.bind = 'lan'; modified = true; }
    if (!cfg.gateway.auth) cfg.gateway.auth = { mode: 'token' };

    // Publish only the configured gateway port. The internal browser/server
    // port is used as a readiness signal, not as a public host port.
    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {};
    const browserPort = gatewayPort + 2;
    const required = [
      "*",
      `http://localhost:${gatewayPort}`, `http://127.0.0.1:${gatewayPort}`,
      `http://localhost:5173`, `http://127.0.0.1:5173`,
      `app://.`, `file://`
    ];
    const existing = cfg.gateway.controlUi.allowedOrigins || [];
    const staleBrowserOrigins = new Set([
      `http://localhost:${browserPort}`,
      `http://127.0.0.1:${browserPort}`,
    ]);
    const merged = [...new Set([...existing.filter(o => !staleBrowserOrigins.has(o)), ...required])];
    if (JSON.stringify(merged) !== JSON.stringify(existing)) { cfg.gateway.controlUi.allowedOrigins = merged; modified = true; }

    // Explicitly disable bonjour plugin in docker mode to prevent "CIAO PROBING CANCELLED" crashes
    if (!cfg.plugins) cfg.plugins = { entries: {} };
    if (!cfg.plugins.entries) cfg.plugins.entries = {};
    if (!cfg.plugins.entries.bonjour || cfg.plugins.entries.bonjour.enabled !== false) {
      cfg.plugins.entries.bonjour = { ...cfg.plugins.entries.bonjour, enabled: false };
      modified = true;
    }

    if (modified) safeWriteOpenClawConfig(cfgPath, JSON.stringify(cfg, null, 2));
  } catch (_) {}
}

// ── Zombie cleanup ────────────────────────────────────────────────────────────

async function killZombiesAsync(isWin, targetPort) {
  if (isWin) {
    await fireSpawn('cmd.exe', ['/c', 'openclaw.cmd', 'gateway', 'stop'], { timeout: 4000 });
    await fireSpawn('powershell', ['-Command',
      `Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | ` +
      `Select-Object -ExpandProperty OwningProcess -Unique | ` +
      `ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`
    ], { timeout: 3000 });
    await fireSpawn('powershell', ['-Command',
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%openclaw%gateway%'" | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ], { timeout: 3000 });
  } else {
    await fireSpawn('openclaw', ['gateway', 'stop'], { timeout: 4000 });
    await fireSpawn('sh', ['-c', `lsof -ti :${targetPort} | xargs kill -9 2>/dev/null || true`], { timeout: 3000 });
    await fireSpawn('pkill', ['-f', 'openclaw.*gateway'], { timeout: 3000 });
  }
}

// ── readToken ─────────────────────────────────────────────────────────────────

function readOpenClawToken() {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(cfgPath)) {
      const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      return cfg?.gateway?.auth?.token || null;
    }
  } catch (_) {}
  return null;
}

// ── Script preparation ────────────────────────────────────────────────────────

/**
 * Mutate scriptArr for Docker mode: inject mount, env vars, port mapping.
 * Returns the (possibly replaced) scriptArr.
 */
function prepareDockerScript(scriptArr, config, containerName) {
  const openclawDir = path.join(os.homedir(), '.openclaw');
  if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });

  prepareConfigForDocker(openclawDir, config.port || 18789);
  const targetImage = 'ghcr.io/openclaw/openclaw:latest';

  if (scriptArr.length === 0 || scriptArr[0] !== 'docker') {
    scriptArr = ['docker', 'run', '-i', targetImage];
  } else {
    const imageIndex = scriptArr.findIndex(el => el.startsWith('ghcr.io/openclaw/openclaw'));
    if (imageIndex !== -1) scriptArr[imageIndex] = targetImage;
    else scriptArr.push(targetImage);
  }

  // Ensure --name
  const runIdx = scriptArr.indexOf('run');
  if (runIdx !== -1 && !scriptArr.includes('--name')) {
    scriptArr.splice(runIdx + 1, 0, '--name', containerName);
  }

  // Replace / inject .openclaw mount
  const badMountIdx = scriptArr.findIndex(a => typeof a === 'string' && a.includes(':/home/node/.openclaw'));
  if (badMountIdx !== -1) {
    const prev = scriptArr[badMountIdx - 1] === '-v' ? badMountIdx - 1 : badMountIdx;
    scriptArr.splice(prev, badMountIdx - prev + 1);
  }
  const finalRunIdx = scriptArr.lastIndexOf('run');
  scriptArr.splice(finalRunIdx + 1, 0, 
    '-v', `${openclawDir}:/home/node/.openclaw`,
    '--tmpfs', '/home/node/.openclaw/canvas:uid=1000,gid=1000,exec',
    '-v', 'openclaw-plugins-cache:/home/node/.openclaw/plugin-runtime-deps'
  );

  // Env vars & port
  const nameIndex = scriptArr.indexOf('--name');
  const injectIdx = nameIndex !== -1 ? nameIndex + 2 : finalRunIdx + 1;
  const gatewayPort = config.port || 18789;
  const browserPort = gatewayPort + 2;   // OpenClaw browser/server is gateway+2 (e.g. 18789→18791)

  if (!scriptArr.includes('OPENCLAW_GATEWAY_BIND=lan')) scriptArr.splice(injectIdx, 0, '-e', 'OPENCLAW_GATEWAY_BIND=lan');
  if (!scriptArr.includes('HOST=0.0.0.0'))              scriptArr.splice(injectIdx, 0, '-e', 'HOST=0.0.0.0');

  // Force allowedOrigins via env var — this bypasses OpenClaw's internal
  // backup/restore mechanism that keeps clobbering the config file origins.
  const originsJson = JSON.stringify([
    `http://localhost:${gatewayPort}`, `http://127.0.0.1:${gatewayPort}`,
    `http://localhost:5173`, `http://127.0.0.1:5173`,
    `app://.`, `file://`
  ]);
  scriptArr.splice(injectIdx, 0,
    '-e', `OPENCLAW_GATEWAY_CONTROLUI_ALLOWEDORIGINS=${originsJson}`,
    '-e', 'OPENCLAW_GATEWAY_CONTROLUI_DANGEROUSLYALLOWHOSTHEADERORIGINFALLBACK=true'
  );

  const portMap = `${gatewayPort}:18789`;
  const isBrowserPortMapping = (mapping) => {
    const parts = String(mapping).split(':');
    const containerPort = parts[parts.length - 1]?.split('/')[0];
    const hostPort = parts.length >= 2 ? parts[parts.length - 2] : null;
    return containerPort === String(18789 + 2) || hostPort === String(browserPort);
  };

  removePublishMappings(scriptArr, isBrowserPortMapping);
  if (!scriptArr.includes(portMap)) scriptArr.splice(injectIdx, 0, '-p', portMap);

  return scriptArr;
}

// ── Pairing-code watcher ──────────────────────────────────────────────────────

const PAIRING_CHANNELS = ['zalouser'];

function startPairingWatcher(platformId, child) {
  const { BrowserWindow } = require('electron');
  const notifiedCodes = new Set();

  const id = setInterval(() => {
    const openclawDir = path.join(os.homedir(), '.openclaw');
    for (const ch of PAIRING_CHANNELS) {
      const pairingFile = path.join(openclawDir, 'credentials', `${ch}-pairing.json`);
      try {
        if (!fs.existsSync(pairingFile)) continue;
        const data = JSON.parse(fs.readFileSync(pairingFile, 'utf8'));
        const entries = Array.isArray(data) ? data : (data.pending || Object.values(data));
        for (const entry of entries) {
          const code = entry.code || entry.pairingCode;
          if (!code || notifiedCodes.has(code)) continue;
          notifiedCodes.add(code);
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.isDestroyed()) {
            win.webContents.send('pairing-request', {
              channel: ch, code,
              senderId:   entry.senderId   || entry.userId || '?',
              senderName: entry.senderName || entry.name   || 'Unknown',
              expiresAt:  entry.expiresAt  || null,
            });
          }
        }
      } catch (_) {}
    }
  }, 5000);

  child.on('exit', () => clearInterval(id));
}

// ── Model-apply post-start ────────────────────────────────────────────────────

function scheduleModelApply(config, containerName, sendLog) {
  if (config.method !== 'docker' || !config.cwd) return;
  const chosenModelPath = path.join(config.cwd, '.chosen-model');
  if (!fs.existsSync(chosenModelPath)) return;

  const chosenModel = fs.readFileSync(chosenModelPath, 'utf8').trim();
  if (!chosenModel || chosenModel === 'openrouter/auto') return;

  sendLog(`[SYSTEM] Will apply model "${chosenModel}" in 20s after gateway warms up...`);
  setTimeout(() => {
    sendLog(`[SYSTEM] Applying model: ${chosenModel}`);
    const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
    const result = require('child_process').spawnSync(
      runnerCmd, ['exec', containerName, 'openclaw', 'models', 'set', chosenModel],
      { encoding: 'utf8', timeout: 15000 }
    );
    if (result.status === 0) {
      sendLog(`[SUCCESS] Model set to: ${chosenModel}`);
    } else {
      sendLog(`[WARN] Model set failed: ${result.stderr || ''}`);
    }
  }, 20000);
}

// ── Post-start config validation ──────────────────────────────────────────────

/**
 * Run `openclaw doctor --fix` inside the Docker container after startup.
 *
 * This uses OpenClaw's own built-in validation to auto-fix any schema issues
 * (unrecognized keys, missing required fields, stale references, etc.)
 * BEFORE the gateway starts processing user requests.
 *
 * Scheduled at 10s post-start (before model-apply at 20s) so the config
 * is sanitized before any agent runs.
 */
function scheduleDoctorFix(config, containerName, sendLog) {
  if (config.method !== 'docker') return;

  setTimeout(() => {
    sendLog(`[SYSTEM] Running OpenClaw doctor --fix to validate config...`);
    const runnerCmd = global.CONTAINER_RUNTIME || 'docker';
    const result = require('child_process').spawnSync(
      runnerCmd, ['exec', containerName, 'openclaw', 'doctor', '--fix'],
      { encoding: 'utf8', timeout: 30000 }
    );
    if (result.status === 0) {
      sendLog(`[SUCCESS] OpenClaw doctor: config validated OK`);
    } else {
      sendLog(`[WARN] OpenClaw doctor: ${(result.stdout || result.stderr || '').slice(0, 500)}`);
    }
  }, 10000);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect gateway readiness from a stdout line.
 * Returns { dashboardUrl } when ready, null otherwise.
 * Called by processManager for every stdout chunk — runner owns the logic.
 */
function detectReadiness(text, config) {
  // The [browser/server] line or [gateway] ready line is the definitive readiness signal.
  const mBrowser = text.match(/\[browser\/server\].*listening on https?:\/\/[\d.]+:(\d+)/i);
  const mGateway = text.match(/\[gateway\] ready \(/i);
  
  if (!mBrowser && !mGateway) return null;

  const gatewayPort = config.port || 18789;
  const token = readOpenClawToken();
  const dashboardUrl = token
    ? `http://127.0.0.1:${gatewayPort}/?token=${token}`
    : `http://127.0.0.1:${gatewayPort}/`;
  return { dashboardUrl };
}

/**
 * Fallback poller config if detectReadiness never fires (silent attach mode).
 * Returns null to skip HTTP polling — we rely on the [browser/server] stdout line.
 * processManager will use a simple delayed emit on gateway port as last resort.
 */
function getFallbackPollerConfig(config) {
  return {
    port:         (config.port || 18789),
    requireToken: true,
    readToken:    readOpenClawToken,
  };
}

module.exports = {
  prepareConfigForNpm,
  prepareConfigForDocker,
  killZombiesAsync,
  readOpenClawToken,
  prepareDockerScript,
  startPairingWatcher,
  scheduleModelApply,
  scheduleDoctorFix,
  startReadyPoller,
  detectReadiness,
  getFallbackPollerConfig,
  safeWriteOpenClawConfig,
};
