
const { spawn }       = require('child_process');
const path            = require('path');
const fs              = require('fs');
const os              = require('os');
const http            = require('http');
const { app, BrowserWindow } = require('electron');
const log             = require('./logger');

const runningProcesses = new Map();

// ── Helper: fire-and-forget async process spawn (never blocks main thread) ──
function fireSpawn(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { windowsHide: true, stdio: 'ignore', ...opts });
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(); }, opts.timeout || 6000);
      p.on('close', () => { clearTimeout(t); resolve(); });
      p.on('error', () => { clearTimeout(t); resolve(); });
    } catch (_) { resolve(); }
  });
}

// ── Helper: recursively remove config values that contain Docker-internal paths ──
// When switching from Docker → NPM, openclaw.json may still contain absolute paths
// written by the container (e.g. /home/node/.openclaw). On the host, OpenClaw reads
// these as the base dir then path.join()s the real host path onto it, producing a
// doubled path like "C:\home\node\.openclaw\...\C:\Users\...\..." → ENOENT.
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

// ── Helper: fix corrupted sessionFile paths in agents/*/sessions/sessions.json ──
// Docker writes sessionFile with a container-internal base path (/home/node/.openclaw).
// On Windows host, Node resolves this as C:\home\node\.openclaw and then path.join()s
// the real host path onto it → doubled path → ENOENT on every session write.
// Fix: for each session entry whose sessionFile contains a Docker path, rebuild it
// using just the UUID filename and the correct host sessions directory.
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
          if (
            session.sessionFile &&
            (session.sessionFile.includes('\\home\\node\\') ||
             session.sessionFile.includes('/home/node/'))
          ) {
            // Reconstruct with correct host path: preserve only the UUID filename
            session.sessionFile = path.join(sessionsDir, path.basename(session.sessionFile));
            modified = true;
          }
        }

        if (modified) {
          fs.writeFileSync(sessionsJson, JSON.stringify(sessions, null, 2), 'utf8');
        }
      } catch (_) {}
    }
  } catch (_) {}
}

// ── Helper: prepare openclaw.json for NPM (host) mode ──
// Cleans up any Docker-specific settings that would break host execution:
//   • Fixes corrupted sessionFile paths in sessions.json (Docker path doubling)
//   • Removes stale Docker-internal paths (/home/node/) → prevents path doubling
//   • Resets gateway.bind from 'lan' back to default loopback
//   • Patches allowedOrigins for all loopback variants (IPv4/IPv6)
//   • Removes fake plugin entries left over from V1 or Docker runs
function prepareConfigForNpm(port) {
  try {
    const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    let modified = false;

    if (!cfg.gateway) cfg.gateway = {};

    // Reset bind: Docker needs 'lan'; NPM on host must use default loopback.
    if (cfg.gateway.bind === 'lan') {
      delete cfg.gateway.bind;
      modified = true;
    }

    // Patch allowedOrigins so all loopback variants are accepted.
    // Windows resolves 'localhost' → ::1; missing entries cause WS upgrade rejection.
    if (!cfg.gateway.controlUi) cfg.gateway.controlUi = {};
    const required = [
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      `http://[::1]:${port}`,
    ];
    const existing = cfg.gateway.controlUi.allowedOrigins || [];
    const merged = [...new Set([...existing, ...required])];
    if (merged.length !== existing.length) {
      cfg.gateway.controlUi.allowedOrigins = merged;
      modified = true;
    }

    // Fix corrupted sessionFile paths in agents/*/sessions/sessions.json.
    fixSessionFilePaths(path.join(os.homedir(), '.openclaw'));

    // Remove stale Docker-internal paths (e.g. /home/node/.openclaw) that cause
    // path doubling when OpenClaw runs in NPM mode on the host.
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;

    // V2: channels and providers are NOT plugins.
    // If they exist in plugins.entries due to manual config or V1 caching, openclaw will fail to load them as plugins.
    if (cfg.plugins && cfg.plugins.entries) {
      const fakePlugins = ['whatsapp', 'zalo', 'zalouser', 'telegram', 'discord', 'litellm'];
      for (const fake of fakePlugins) {
        if (cfg.plugins.entries[fake]) {
          delete cfg.plugins.entries[fake];
          modified = true;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch (_) {}
}

// ── Helper: prepare openclaw.json for Docker mode ──
// Sets gateway.bind = 'lan' so the container's port mapping reaches the host.
// NPM-specific settings (loopback-only bind) would break Docker networking.
function prepareConfigForDocker(openclawDir) {
  try {
    const cfgPath = path.join(openclawDir, 'openclaw.json');
    if (!fs.existsSync(cfgPath)) return;
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    let modified = false;

    if (!cfg.gateway) cfg.gateway = {};

    // Remove stale Docker-internal paths left by a previous container run to
    // avoid path doubling if the user ever switches back to NPM without stopping.
    if (removeDockerPaths(cfg, '/home/node/')) modified = true;

    // Force LAN bind so Docker port mapping (-p host:18789) can reach the gateway.
    if (cfg.gateway.bind !== 'lan') {
      cfg.gateway.bind = 'lan';
      modified = true;
    }

    if (modified) {
      fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    }
  } catch (_) {}
}

// ── Helper: kill zombie gateway processes without blocking Electron main thread ──
async function killZombiesAsync(isWin, targetPort) {
  if (isWin) {
    // Step 1: polite CLI stop
    await fireSpawn('cmd.exe', ['/c', 'openclaw.cmd', 'gateway', 'stop'], { timeout: 4000 });
    // Step 2: kill by port ownership (most accurate)
    await fireSpawn('powershell', [
      '-Command',
      `Get-NetTCPConnection -LocalPort ${targetPort} -State Listen -ErrorAction SilentlyContinue | ` +
      `Select-Object -ExpandProperty OwningProcess -Unique | ` +
      `ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`
    ], { timeout: 3000 });
    // Step 3: WMI fallback by commandline pattern
    await fireSpawn('powershell', [
      '-Command',
      `Get-CimInstance Win32_Process -Filter "CommandLine LIKE '%openclaw%gateway%'" | ` +
      `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
    ], { timeout: 3000 });
  } else {
    await fireSpawn('openclaw', ['gateway', 'stop'], { timeout: 4000 });
    await fireSpawn('sh', ['-c', `lsof -ti :${targetPort} | xargs kill -9 2>/dev/null || true`], { timeout: 3000 });
    await fireSpawn('pkill', ['-f', 'openclaw.*gateway'], { timeout: 3000 });
  }
}

// ── Helper: poll HTTP until gateway is ready, then emit platform-ready ──
function startGatewayReadyPoller({ platformId, port, sendLog, maxRetries = 45, intervalMs = 1500 }) {
  let attempts = 0;

  const readToken = () => {
    try {
      const cfgPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        return cfg?.gateway?.auth?.token || null;
      }
    } catch (_) {}
    return null;
  };

  const notifyReady = (token) => {
    const dashboardUrl = `http://127.0.0.1:${port}/?token=${token}`;
    sendLog(`[SYSTEM] Gateway ready! Opening dashboard: ${dashboardUrl}`);
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('platform-ready', { platformId, dashboardUrl });
    }
  };

  const poll = () => {
    if (attempts++ >= maxRetries) {
      sendLog('[SYSTEM] Gateway readiness timeout. Check Console for errors.');
      return;
    }

    const token = readToken();
    if (!token) {
      // Token not written yet — gateway still starting; retry
      setTimeout(poll, intervalMs);
      return;
    }

    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      notifyReady(token);
    });

    req.on('error', () => setTimeout(poll, intervalMs));

    // If socket hangs (no response), destroy and retry
    req.setTimeout(1200, () => {
      req.destroy();
      setTimeout(poll, intervalMs);
    });
  };

  poll();
}

async function spawnPlatform(platformId, config, webContents) {
  if (runningProcesses.has(platformId)) return { success: false, reason: 'Already running' };

  const sendLog = (msg) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('platform-log', { platformId, msg });
    }
  };

  let child;

  try {
    const isWin = process.platform === 'win32';
    // ── Environment Precondition Checks ────────────────────────────────────
    const { execSync } = require('child_process');
    if (config.method === 'docker') {
      try {
        execSync('docker info', { stdio: 'ignore' });
      } catch (err) {
        sendLog('[SYSTEM] ERROR: Docker is not running or not installed! Please start Docker first.');
        event.sender.send('platform-error', { platformId, error: 'Docker is not running or not installed. Please start Docker.' });
        return;
      }
    } else {
      try {
        const shellOpt = isWin ? 'cmd.exe' : '/bin/bash';
        execSync('openclaw --version', { shell: shellOpt, stdio: 'ignore' });
      } catch (err) {
        sendLog('[SYSTEM] ERROR: openclaw CLI is missing or not in PATH! Please install it via NPM first.');
        return { success: false, reason: 'NPM_MISSING_DEPENDENCY' };
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    const containerName = config.container || `${platformId}-clawexpress`;
    let scriptArr = (config.startScript || []).map(arg => {
      if (typeof arg === 'string' && arg.includes('{{cwd}}')) {
        let absPath = config.cwd || app.getPath('home');
        return arg.replace('{{cwd}}', absPath);
      }
      return arg;
    });
    
    if (config.method === 'docker') {
       sendLog('[SYSTEM] Running zombie cleanup...');
       require('child_process').spawnSync('docker', ['rm', '-f', containerName]);
       
       const openclawDir = path.join(os.homedir(), '.openclaw');
       if (!fs.existsSync(openclawDir)) {
          fs.mkdirSync(openclawDir, { recursive: true });
       }
       
       // Prepare config for Docker: set bind=lan, strip stale Docker paths.
       prepareConfigForDocker(openclawDir);
       const dockerMountSrc = process.platform === 'win32'
         ? openclawDir.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/${d.toLowerCase()}`)
         : openclawDir;

       // If empty, or struck with the old NPM structure (non-docker), recreate standard execution command
       const targetTag = (config.version && config.version !== '-') ? config.version.replace(/^v+/i, '').trim() : 'latest';
       const targetImage = `ghcr.io/openclaw/openclaw:${targetTag}`;

       if (scriptArr.length === 0 || scriptArr[0] !== 'docker') {
           scriptArr = ['docker', 'run', '-i', targetImage];
       } else {
           // Dynamically patch the image element to the correct version over time (e.g., when they update)
           const imageIndex = scriptArr.findIndex(el => el.startsWith('ghcr.io/openclaw/openclaw'));
           if (imageIndex !== -1) {
             scriptArr[imageIndex] = targetImage;
           } else {
             scriptArr.push(targetImage);
           }
       }
       
       // Ensure naming constraint is set securely dynamically
       const runIndex = scriptArr.indexOf('run');
       if (runIndex !== -1) {
            // Strip out any potentially injected config directory mounts to enforce single-source-of-truth
            const customMountIdx = scriptArr.findIndex(arg => typeof arg === 'string' && arg.includes(':/home/node/.openclaw'));
            if (customMountIdx !== -1) {
                // Remove the mount path and the preceding '-v' argument
                if (customMountIdx > 0 && scriptArr[customMountIdx - 1] === '-v') {
                    scriptArr.splice(customMountIdx - 1, 2);
                } else {
                    scriptArr.splice(customMountIdx, 1);
                }
            }
            // Always inject the correct single-source-of-truth mount
            const finalRunIndex = scriptArr.indexOf('run');
            scriptArr.splice(finalRunIndex + 1, 0, '-v', `${dockerMountSrc}:/home/node/.openclaw`);
           if (!scriptArr.includes('--name')) {
               scriptArr.splice(runIndex + 1, 0, '--name', containerName);
           }
            // Configure the base environment and standard Ports for OpenClaw Gateway
           const isDefaultPlatform = platformId === 'openclaw' || config.registryId === 'openclaw' || config.name?.toLowerCase().includes('openclaw') || !config.registryId;
           if (isDefaultPlatform) {
               const nameIndex = scriptArr.indexOf('--name');
               const injectIndex = nameIndex !== -1 ? nameIndex + 2 : runIndex + 1;
               
               if (!scriptArr.includes('OPENCLAW_GATEWAY_BIND=lan')) {
                   scriptArr.splice(injectIndex, 0, '-e', 'OPENCLAW_GATEWAY_BIND=lan');
               }
               // Force bind 0.0.0.0 inside the docker namespace to allow host communication
               if (!scriptArr.includes('HOST=0.0.0.0')) {
                   scriptArr.splice(injectIndex, 0, '-e', 'HOST=0.0.0.0');
               }
               
               const portMap = `${config.port || 18789}:18789`;
               if (!scriptArr.includes(portMap)) {
                   scriptArr.splice(injectIndex, 0, '-p', portMap);
               }
               
           }
       }
    } else if (config.method === 'npm') {
       // '--allow-unconfigured' bypasses the gateway.mode validation check.
       // Config: uses default ~/.openclaw/openclaw.json (single source of truth).
       scriptArr = ['openclaw', 'gateway', '--allow-unconfigured'];

       const targetPort = config.port || 18789;

       // ── Step 1: Prepare config for NPM mode (reset Docker settings, patch origins) ──
       prepareConfigForNpm(targetPort);

       // ── Step 2: Kill zombie gateway processes (async, non-blocking) ──
       // Runs in background so Electron main thread stays responsive (no "Not Responding").
       // The gateway is spawned immediately after; if a zombie still holds the port,
       // openclaw will attach to stdout of the existing process instead of failing.
       sendLog(`[SYSTEM] Pre-flight: killing any zombie openclaw instances...`);
       await killZombiesAsync(isWin, targetPort);

       sendLog(`[SYSTEM] NPM mode: starting OpenClaw gateway...`);
    } else {
       if (scriptArr.length === 0) scriptArr = ['npm', 'start'];
    }

    let cmd = scriptArr[0];
    // On Windows, .cmd scripts must run through cmd.exe (shell: true).
    // DO NOT manually add .cmd suffix - let the shell resolve it.
    // Only npm/npx/openclaw need explicit .cmd on Windows when shell:false.
    if (isWin && (cmd === 'npm' || cmd === 'npx' || cmd === 'openclaw')) {
      cmd += '.cmd';
    }

    // Load Global API keys from Single Source of Truth so NPM mode can parse ${API_KEY} variables
    let ssotEnv = {};
    try {
      const cfgLoc = path.join(os.homedir(), '.openclaw', 'openclaw.json');
      if (fs.existsSync(cfgLoc)) {
        const fullCfg = JSON.parse(fs.readFileSync(cfgLoc, 'utf8'));
        if (fullCfg.env) ssotEnv = fullCfg.env;
      }
    } catch (_) {}

    // Gateway uses default ~/.openclaw/openclaw.json — single source of truth.
    // HOST is intentionally NOT overridden: forcing 127.0.0.1 (IPv4-only) breaks
    // Chrome's IPv6 WebSocket connections, causing message echo delay in the chat UI.
    const spawnEnv = { ...process.env, ...ssotEnv, ...(config.env || {}) };

    sendLog(`[SYSTEM] Starting: ${cmd} ${scriptArr.slice(1).join(' ')}`);

    // On Windows, run via cmd.exe /c ONLY for .cmd scripts (like npm/npx).
    // Native executables (like docker.exe) should be spawned natively to avoid
    // console allocation failures and quote mangling in packaged GUI mode.
    const isCmdScript = isWin && cmd.endsWith('.cmd');
    const spawnArgs = isCmdScript
      ? ['cmd.exe', ['/c', cmd, ...scriptArr.slice(1)]]
      : [cmd, scriptArr.slice(1)];

    child = spawn(spawnArgs[0], spawnArgs[1], {
      cwd: config.cwd || app.getPath('home'),
      env: spawnEnv
    });

    sendLog(`[SYSTEM] Process started (PID: ${child.pid})`);

    // ── Gateway readiness detection (NPM mode) ────────────────────────────
    // Strategy: parse stdout for startup signals, then poll HTTP endpoint.
    // The poller is also started unconditionally after a short delay to handle
    // the "attach to existing" case where no startup signals are ever emitted.
    let gatewayReadyEmitted = false;
    let pollerStarted = false;

    const maybeStartPoller = () => {
      if (pollerStarted || gatewayReadyEmitted) return;
      pollerStarted = true;
      startGatewayReadyPoller({
        platformId,
        port: config.port || 18789,
        sendLog,
        maxRetries: 45,
        intervalMs: 1500,
      });
    };

    child.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => sendLog(line));

      // ONLY start polling HTTP (to fetch the token and verify the API is up)
      // when the gateway explicitly announces it is ready or attached. 
      // Do not use generic strings like '[gateway]' as it starts too early.
      if (!gatewayReadyEmitted && (
        text.includes('Waiting for incoming connections') ||
        text.includes('Process already running') ||
        text.includes('[gateway] ready') ||
        text.includes('host mounted at')
      )) {
        maybeStartPoller();
      }
    });

    // Fallback: if stdout signals never arrive (e.g., openclaw attaches silently
    // to an already-running process), start the poller unconditionally after a
    // short grace period so the dashboard button always enables.
    if (config.method === 'npm') {
      setTimeout(maybeStartPoller, 8000);
    }

    child.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => sendLog(`[WARN] ${line}`));
    });

    child.on('exit', (code) => {
      sendLog(`[SYSTEM] Process exited with code ${code}`);
      runningProcesses.delete(platformId);
      // If the poller already started, gateway may be running externally (attach mode).
      // Don't send STOPPED because the HTTP poller will confirm the real state.
      if (!pollerStarted) {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('platform-status-change', { platformId, status: 'STOPPED' });
        }
      }
    });

    runningProcesses.set(platformId, { process: child, startTime: Date.now() });

    // Apply chosen model via CLI after gateway warms up (20s grace period)
    if (config.method === 'docker' && config.cwd) {
      const chosenModelPath = path.join(config.cwd, '.chosen-model');
      if (fs.existsSync(chosenModelPath)) {
        const chosenModel = fs.readFileSync(chosenModelPath, 'utf8').trim();
        if (chosenModel && chosenModel !== 'openrouter/auto') {
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
              sendLog(`[WARN] Model set failed (may need manual: openclaw models set ${chosenModel}): ${result.stderr || ''}`);
            }
          }, 20000);
        }
      }
    }

    return { success: true, pid: child.pid };

  } catch (err) {
    sendLog(`[ERROR] Failed to start: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

function stopPlatform(platformId, webContents, method, container) {
  const entry = runningProcesses.get(platformId);

  const sendLog = (msg) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('platform-log', { platformId, msg });
    }
  };

  const isWin = process.platform === 'win32';

  try {
    if (method === 'docker') {
      const containerName = container || `${platformId}-clawexpress`;
      sendLog(`[SYSTEM] Destroying container ${containerName}...`);
      require('child_process').spawnSync('docker', ['rm', '-f', containerName]);
    } else if (method === 'npm') {
      // Two-step kill for npm method on Windows:
      //
      // Step 1 — kill the tracked cmd.exe process tree (if we have a PID).
      //   openclaw.cmd uses `endLocal & goto #_undefined#` which can cause
      //   node.exe to be re-parented away from cmd.exe on some Windows builds,
      //   so /T alone is not always sufficient.
      //
      // Step 2 — kill by process name (belt-and-suspenders).
      //   This catches any orphaned openclaw.mjs node processes that survived
      //   step 1, or processes that were never tracked (zombies from a previous
      //   ClawExpress session).
      if (entry) {
        const pid = entry.process.pid;
        sendLog(`[SYSTEM] Terminating process tree (PID: ${pid})...`);
        if (isWin) {
          require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000 });
        } else {
          try { process.kill(-pid, 'SIGTERM'); } catch (_) { entry.process.kill('SIGTERM'); }
        }
      } else {
        sendLog(`[SYSTEM] No tracked PID — falling back to process-name kill...`);
      }

      // Always run name-based kill to catch orphans / detached node processes.
      if (isWin) {
        sendLog(`[SYSTEM] Sweeping orphaned openclaw.mjs processes...`);
        require('child_process').spawnSync(
          'powershell',
          ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '.*openclaw.*(index\\.js|openclaw\\.mjs).*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
          { timeout: 8000, windowsHide: true }
        );
      } else {
        require('child_process').spawnSync('pkill', ['-f', '.*openclaw.*(index\\.js|openclaw\\.mjs).*'], { timeout: 5000 });
      }
    } else {
      if (!entry) return { success: false, reason: 'Not running' };
      sendLog(`[SYSTEM] Sending SIGTERM to PID ${entry.process.pid}...`);
      entry.process.kill('SIGTERM');
    }

    runningProcesses.delete(platformId);
    return { success: true };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

module.exports = { runningProcesses, spawnPlatform, stopPlatform };
