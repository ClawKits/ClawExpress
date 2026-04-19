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

function fixSessionFilePaths(openclawDir) {
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
          if (session.sessionFile && (session.sessionFile.includes('\\home\\node\\') || session.sessionFile.includes('/home/node/'))) {
            session.sessionFile = path.join(sessionsDir, path.basename(session.sessionFile));
            modified = true;
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
  if (cfg.agents?.defaults?.model && typeof cfg.agents.defaults.model === 'object' && cfg.agents.defaults.model.primary) {
    cfg.agents.defaults.model = cfg.agents.defaults.model.primary;
    return true;
  }
  return false;
}

/**
 * Prepare openclaw.json for NPM (host) mode.
 * Clears Docker-specific paths, resets gateway.bind, patches allowedOrigins.
 */
function prepareConfigForNpm(port) {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
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
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
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
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;
    if (removeFakePlugins(cfg)) modified = true;
    if (coerceModel(cfg)) modified = true;

    if (modified) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (_) {}
}


/**
 * Prepare openclaw.json for Docker mode.
 * Sets gateway.bind = 'lan' so the Docker port mapping reaches the host.
 */
function prepareConfigForDocker(openclawDir, gatewayPort = 18789) {
  try {
    const cfgPath = path.join(openclawDir, 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    let modified = false;

    if (!cfg.gateway) cfg.gateway = {};
    fixSessionFilePaths(openclawDir);
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;
    if (cfg.gateway.bind !== 'lan') { cfg.gateway.bind = 'lan'; modified = true; }
    if (!cfg.gateway.auth) cfg.gateway.auth = { mode: 'token' };

    // Patch allowedOrigins for both gateway port AND browser/server port (gateway+2).
    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {};
    const browserPort = gatewayPort + 2;
    const required = [
      `http://localhost:${gatewayPort}`, `http://127.0.0.1:${gatewayPort}`,
      `http://localhost:${browserPort}`, `http://127.0.0.1:${browserPort}`,
    ];
    const existing = cfg.gateway.controlUi.allowedOrigins || [];
    const merged = [...new Set([...existing, ...required])];
    if (merged.length !== existing.length) { cfg.gateway.controlUi.allowedOrigins = merged; modified = true; }

    if (removeFakePlugins(cfg)) modified = true;
    if (coerceModel(cfg)) modified = true;

    if (modified) fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
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
  const finalRunIdx = scriptArr.indexOf('run');
  scriptArr.splice(finalRunIdx + 1, 0, '-v', `${openclawDir}:/home/node/.openclaw`);

  // Env vars & port
  const nameIndex = scriptArr.indexOf('--name');
  const injectIdx = nameIndex !== -1 ? nameIndex + 2 : finalRunIdx + 1;

  if (!scriptArr.includes('OPENCLAW_GATEWAY_BIND=lan')) scriptArr.splice(injectIdx, 0, '-e', 'OPENCLAW_GATEWAY_BIND=lan');
  if (!scriptArr.includes('HOST=0.0.0.0'))              scriptArr.splice(injectIdx, 0, '-e', 'HOST=0.0.0.0');

  const gatewayPort = config.port || 18789;
  const browserPort = gatewayPort + 2;   // OpenClaw browser/server is gateway+2 (e.g. 18789→18791)

  const portMap        = `${gatewayPort}:18789`;
  const browserPortMap = `${browserPort}:${18789 + 2}`;   // 18791:18791

  if (!scriptArr.includes(portMap))        scriptArr.splice(injectIdx, 0, '-p', portMap);
  if (!scriptArr.includes(browserPortMap)) scriptArr.splice(injectIdx, 0, '-p', browserPortMap);

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
    const result = require('child_process').spawnSync(
      'docker', ['exec', containerName, 'openclaw', 'models', 'set', chosenModel],
      { encoding: 'utf8', timeout: 15000 }
    );
    if (result.status === 0) {
      sendLog(`[SUCCESS] Model set to: ${chosenModel}`);
    } else {
      sendLog(`[WARN] Model set failed: ${result.stderr || ''}`);
    }
  }, 20000);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect gateway readiness from a stdout line.
 * Returns { dashboardUrl } when ready, null otherwise.
 * Called by processManager for every stdout chunk — runner owns the logic.
 */
function detectReadiness(text, config) {
  // [browser/server] line is the definitive readiness signal for OpenClaw.
  // Dashboard is always served on the GATEWAY port (config.port || 18789),
  // not on the browser/server's own port (e.g. 18791).
  const m = text.match(/\[browser\/server\].*listening on https?:\/\/[\d.]+:(\d+)/i);
  if (!m) return null;

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
  startReadyPoller,
  detectReadiness,
  getFallbackPollerConfig,
};
