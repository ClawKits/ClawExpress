/**
 * processManager.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Orchestration hub for platform lifecycle (spawn / stop).
 *
 * Routing logic:
 *   isOpenClaw → runners/openclaw.runner.js  (full config patching, docker
 *                cleanup, zombie kill, pairing watcher, model apply …)
 *   otherwise  → runners/default.runner.js   (generic: --name injection,
 *                HTTP-200 readiness check)
 *
 * Adding a new platform runner:
 *   1. Create  app/src/main/runners/<platform>.runner.js
 *   2. Add a condition in `resolveRunner()` below.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { spawn }              = require('child_process');
const path                   = require('path');
const fs                     = require('fs');
const os                     = require('os');
const { app, BrowserWindow } = require('electron');


const openclawRunner  = require('./runners/openclaw.runner');
const openfangRunner  = require('./runners/openfang.runner');
const genericRunner   = require('./runners/generic.runner');
const defaultRunner   = require('./runners/default.runner');
const { getManifest } = require('./manifestRegistry');

const runningProcesses = new Map();

// ── Runner selector ───────────────────────────────────────────────────────────

function isOpenClaw(platformId, config) {
  return (
    platformId === 'openclaw' ||
    config.registryId === 'openclaw' ||
    config.name?.toLowerCase().includes('openclaw')
  );
}

function resolveRunner(platformId, config) {
  if (isOpenClaw(platformId, config)) return openclawRunner;
  if (
    platformId === 'openfang' ||
    config.registryId === 'openfang' ||
    config.name?.toLowerCase().includes('openfang')
  ) return openfangRunner;
  // Manifest-backed platforms (hermes + any future platform) use the generic runner.
  // Platforms with no manifest fall back to defaultRunner (HTTP poll on config.port).
  const id = config.registryId || platformId || '';
  return getManifest(id) ? genericRunner : defaultRunner;
}

// ── spawnPlatform ─────────────────────────────────────────────────────────────

async function spawnPlatform(platformId, config, webContents) {
  if (runningProcesses.has(platformId)) return { success: false, reason: 'Already running' };

  const sendLog = (msg) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('platform-log', { platformId, msg });
    }
  };

  let child;

  try {
    const isWin    = process.platform === 'win32';
    const runner   = resolveRunner(platformId, config);
    const useOC    = isOpenClaw(platformId, config);

    // ── Precondition checks ───────────────────────────────────────────────────
    const { execSync } = require('child_process');
    const runnerCmd = global.CONTAINER_RUNTIME || 'docker';

    if (config.method === 'docker') {
      try {
        execSync(`${runnerCmd} info`, { stdio: 'ignore', windowsHide: true });
      } catch {
        sendLog(`[SYSTEM] ERROR: ${runnerCmd} is not running or not installed! Please start Docker/Podman first.`);
        return { success: false, reason: 'DOCKER_NOT_RUNNING' };
      }
    } else if (useOC) {
      // Only require openclaw CLI when it's the OpenClaw platform in NPM mode.
      try {
        execSync('openclaw --version', { shell: isWin ? 'cmd.exe' : '/bin/bash', stdio: 'ignore', windowsHide: true });
      } catch {
        sendLog('[SYSTEM] ERROR: openclaw CLI is missing or not in PATH! Please install it via NPM first.');
        return { success: false, reason: 'NPM_MISSING_DEPENDENCY' };
      }
    }

    // ── Resolve container name & expand {{cwd}} ───────────────────────────────
    const containerName = config.container || `${platformId}-clawexpress`;
    let scriptArr = (config.startScript || []).map(arg => {
      if (typeof arg === 'string' && arg.includes('{{cwd}}')) {
        return arg.replace('{{cwd}}', config.cwd || app.getPath('home'));
      }
      return arg;
    });

    // ── Per-method script preparation ─────────────────────────────────────────
    const manifestForPlatform = getManifest(config.registryId || platformId);
    const isComposePlatform   = manifestForPlatform?.install?.docker?.type === 'compose';

    if (config.method === 'docker') {
      // Compose-type platforms (e.g. hermes) manage their own lifecycle via
      // `docker compose up/down` — skip the single-container zombie cleanup.
      if (!isComposePlatform) {
        sendLog('[SYSTEM] Running zombie cleanup...');
        require('child_process').spawnSync(runnerCmd, ['rm', '-f', containerName], { windowsHide: true });
      }

      if (useOC) {
        // Also free the gateway port on the HOST so OpenClaw always binds to
        // the configured port (18789) rather than auto-incrementing to 18791.
        const gatewayPort = config.port || 18789;
        sendLog(`[SYSTEM] Freeing host port ${gatewayPort}...`);
        await openclawRunner.killZombiesAsync(isWin, gatewayPort);

        scriptArr = openclawRunner.prepareDockerScript(scriptArr, config, containerName);
      } else {
        scriptArr = runner.prepareDockerScript(scriptArr, config, containerName);
      }

    } else if (config.method === 'npm') {
      if (useOC) {
        // Override script to use the openclaw CLI gateway command.
        scriptArr = ['openclaw', 'gateway', '--allow-unconfigured'];
        const targetPort = config.port || 18789;
        openclawRunner.prepareConfigForNpm(targetPort);
        sendLog('[SYSTEM] Pre-flight: killing any zombie openclaw instances...');
        await openclawRunner.killZombiesAsync(isWin, targetPort);
        sendLog('[SYSTEM] NPM mode: starting OpenClaw gateway...');
      } else {
        scriptArr = defaultRunner.prepareNpmScript(scriptArr);
      }
    } else {
      if (scriptArr.length === 0) scriptArr = ['npm', 'start'];
    }

    // ── Map docker to podman/orbstack if detected & apply Win .cmd suffix ───────
    let cmd = scriptArr[0];
    if (cmd === 'docker' && global.CONTAINER_RUNTIME && global.CONTAINER_RUNTIME !== 'docker') {
      scriptArr[0] = global.CONTAINER_RUNTIME;
      cmd = global.CONTAINER_RUNTIME;
    }

    if (isWin && (cmd === 'npm' || cmd === 'npx' || cmd === 'openclaw')) {
      cmd += '.cmd';
    }

    // ── Build environment ─────────────────────────────────────────────────────
    // For OpenClaw: merge global API keys from ~/.openclaw/openclaw.json so
    // SSOT env vars (e.g. ${OPENAI_API_KEY}) are resolved at spawn time.
    let ssotEnv = {};
    if (useOC) {
      try {
        const cfgLoc = path.join(os.homedir(), '.openclaw', 'openclaw.json');
        if (fs.existsSync(cfgLoc)) {
          const fullCfg = JSON.parse(fs.readFileSync(cfgLoc, 'utf8'));
          if (fullCfg.env) ssotEnv = fullCfg.env;
        }
      } catch (_) {}
    }
    const spawnEnv = { ...process.env, ...ssotEnv, ...(config.env || {}) };

    sendLog(`[SYSTEM] Starting: ${cmd} ${scriptArr.slice(1).join(' ')}`);

    // ── Spawn ─────────────────────────────────────────────────────────────────
    const isCmdScript = isWin && cmd.endsWith('.cmd');
    const spawnArgs   = isCmdScript
      ? ['cmd.exe', ['/c', cmd, ...scriptArr.slice(1)]]
      : [cmd, scriptArr.slice(1)];

    child = spawn(spawnArgs[0], spawnArgs[1], {
      cwd: config.cwd || app.getPath('home'),
      env: spawnEnv,
      windowsHide: true,
    });

    sendLog(`[SYSTEM] Process started (PID: ${child.pid})`);

    // ── Readiness detection — fully delegated to the runner ───────────────────
    // processManager has zero app-specific knowledge here.
    // Each runner owns its own detectReadiness() and getFallbackPollerConfig().
    let gatewayReadyEmitted = false;
    let pollerStarted       = false;

    const emitReady = (dashboardUrl) => {
      gatewayReadyEmitted = true;
      pollerStarted = true;
      sendLog(`[SYSTEM] Gateway ready! Opening dashboard: ${dashboardUrl}`);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('platform-ready', { platformId, dashboardUrl });
      }
    };

    child.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => sendLog(line));

      if (!gatewayReadyEmitted) {
        // Ask the runner whether this stdout chunk signals readiness.
        const ready = runner.detectReadiness(text, config);
        if (ready) emitReady(ready.dashboardUrl);
      }
    });

    // Fallback timer: only for non-compose platforms.
    // Compose platforms rely on the exit-code-0 signal from `docker compose up -d`
    // which already waits for depends_on healthchecks — that's the reliable trigger.
    if (!isComposePlatform) {
      const fallbackDelay = config.method === 'npm' ? 8000 : 20000;
      setTimeout(() => {
        if (pollerStarted || gatewayReadyEmitted) return;
        const pollerConfig = runner.getFallbackPollerConfig(config);
        sendLog(`[SYSTEM] Fallback: polling dashboard on port ${pollerConfig.port}...`);
        pollerStarted = true;
        runner.startReadyPoller({
          platformId,
          port:         pollerConfig.port,
          requireToken: pollerConfig.requireToken,
          readToken:    pollerConfig.readToken,
          sendLog,
          maxRetries:   45,
          intervalMs:   1500,
        });
      }, fallbackDelay);
    }

    child.stderr.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => sendLog(`[WARN] ${line}`));
      // Some apps (e.g. OpenFang) print readiness announcements to stderr.
      if (!gatewayReadyEmitted) {
        const ready = runner.detectReadiness(text, config);
        if (ready) emitReady(ready.dashboardUrl);
      }

    });

    child.on('exit', (code) => {
      sendLog(`[SYSTEM] Process exited with code ${code}`);

      // For compose platforms, `docker compose up -d` exits after starting containers.
      // Exit 0 = success. Non-zero can still mean containers are up (e.g. healthcheck
      // timeout on a slow machine) so we always try polling rather than giving up.
      if (isComposePlatform && !pollerStarted) {
        if (code !== 0) {
          sendLog(`[WARN] Compose exited with code ${code} — containers may still be starting. Polling anyway...`);
        } else {
          sendLog('[SYSTEM] Compose stack started. Containers are running.');
        }
        const pollerConfig = runner.getFallbackPollerConfig(config);
        sendLog(`[SYSTEM] Polling dashboard on port ${pollerConfig.port}...`);
        pollerStarted = true;
        runner.startReadyPoller({
          platformId,
          port:         pollerConfig.port,
          requireToken: pollerConfig.requireToken,
          readToken:    pollerConfig.readToken,
          sendLog,
          maxRetries:   90,
          intervalMs:   2000,
        });
        return;
      }

      runningProcesses.delete(platformId);
      if (!pollerStarted) {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('platform-status-change', { platformId, status: 'STOPPED' });
        }
      }
    });

    runningProcesses.set(platformId, { process: child, startTime: Date.now() });

    // ── Post-start hooks ────────────────────────────────────────
    if (useOC) {
      openclawRunner.startPairingWatcher(platformId, child);
      openclawRunner.scheduleModelApply(config, containerName, sendLog);  // 20s: apply chosen model
    } else if (runner === openfangRunner && typeof openfangRunner.scheduleVersionCheck === 'function') {
      const win = BrowserWindow.getAllWindows()[0];
      openfangRunner.scheduleVersionCheck(config, containerName, sendLog, win?.webContents, platformId);
    }

    return { success: true, pid: child.pid };

  } catch (err) {
    sendLog(`[ERROR] Failed to start: ${err.message}`);
    return { success: false, reason: err.message };
  }
}

// ── stopPlatform ──────────────────────────────────────────────────────────────

async function stopPlatform(platformId, webContents, method, container, registryId = '', cwd = null) {
  const entry = runningProcesses.get(platformId);
  const isWin = process.platform === 'win32';
  const sendLog = (msg) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('platform-log', { platformId, msg });
    }
  };

  try {
    if (method === 'docker') {
      const containerName = container || `${platformId}-clawexpress`;
      const isOpenfang = registryId === 'openfang' || platformId === 'openfang' ||
        (entry && entry.process.spawnargs && entry.process.spawnargs.join(' ').includes('openfang'));
      const { getManifest } = require('./manifestRegistry');
      const manifest = getManifest(registryId || platformId);
      const isCompose = manifest?.install?.docker?.type === 'compose';

      runningProcesses.delete(platformId);

      const runnerCmd = global.CONTAINER_RUNTIME || 'docker';

      const sendProgress = (data) => {
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('platform-stop-progress', { platformId, ...data });
        }
      };

      (async () => {
        // ── Compose platforms: bring stack down gracefully ──────────────────
        if (isCompose && cwd) {
          if (webContents && !webContents.isDestroyed()) {
            webContents.send('platform-status-change', { platformId, status: 'STOPPING' });
          }
          sendProgress({ step: 'stop', status: 'running', msg: 'Bringing compose stack down...' });
          const { composeProjectName } = require('./runners/generic.runner');
          const projectName = composeProjectName({ registryId: registryId || platformId });
          await new Promise((resolve) => {
            const proc = require('child_process').spawn(
              runnerCmd, ['compose', '--project-name', projectName, 'down'],
              { cwd, stdio: 'ignore', windowsHide: true }
            );
            proc.on('close', resolve);
            proc.on('error', resolve);
            setTimeout(resolve, 60000);
          });
          sendProgress({ step: 'stop', status: 'done', msg: 'Stack stopped' });
          sendProgress({ step: 'complete' });
          if (webContents && !webContents.isDestroyed()) {
            webContents.send('platform-status-change', { platformId, status: 'STOPPED' });
          }
          return;
        }

        // ── Single-container: stop → commit → rm, non-blocking async ────────
        const runDockerAsync = (args, timeoutMs = 30000) => new Promise((resolve) => {
          const p = require('child_process').spawn(runnerCmd, args, { windowsHide: true, stdio: 'ignore' });
          const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(); }, timeoutMs);
          p.on('close', () => { clearTimeout(t); resolve(); });
          p.on('error', () => { clearTimeout(t); resolve(); });
        });

        // 1. Capture container ID before stopping.
        const idResult = require('child_process').spawnSync(
          runnerCmd, ['inspect', '--format={{.Id}}', containerName],
          { windowsHide: true, encoding: 'utf8' }
        );
        const containerId = (idResult.stdout || '').trim() || containerName;

        // 2. Stop.
        sendProgress({ step: 'stop', status: 'running', msg: 'Stopping container...' });
        await runDockerAsync(['stop', '--time', '8', containerId], 15000);
        sendProgress({ step: 'stop', status: 'done', msg: 'Container stopped' });

        // 3. Commit (save installed packages into image for next start).
        const savedImage = isOpenfang ? 'openfang-custom:latest' : `clawexpress-${registryId || platformId}:saved`;
        sendProgress({ step: 'commit', status: 'running', msg: `Saving state → ${savedImage}` });
        sendLog(`[SYSTEM] Committing container state: ${savedImage}`);
        await runDockerAsync(['commit', containerId, savedImage], 120000);
        sendProgress({ step: 'commit', status: 'done', msg: 'State saved' });

        // 4. Remove — container disappears from Docker Desktop here.
        sendProgress({ step: 'remove', status: 'running', msg: 'Removing container...' });
        await runDockerAsync(['rm', '-f', containerId], 10000);
        sendProgress({ step: 'remove', status: 'done', msg: 'Container removed' });

        if (webContents && !webContents.isDestroyed()) {
          webContents.send('platform-status-change', { platformId, status: 'STOPPED' });
        }
        sendProgress({ step: 'complete' });
      })();

      return { success: true };

    } else if (method === 'npm') {
      if (entry) {
        const pid = entry.process.pid;
        sendLog(`[SYSTEM] Terminating process tree (PID: ${pid})...`);
        if (isWin) {
          require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000, windowsHide: true });
        } else {
          try { process.kill(-pid, 'SIGTERM'); } catch (_) { entry.process.kill('SIGTERM'); }
        }
      } else {
        sendLog('[SYSTEM] No tracked PID — falling back to process-name kill...');
      }

      // Belt-and-suspenders: sweep orphaned openclaw node processes.
      if (isWin) {
        sendLog('[SYSTEM] Sweeping orphaned openclaw.mjs processes...');
        require('child_process').spawnSync('powershell', [
          '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '.*openclaw.*(index\\.js|openclaw\\.mjs).*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
        ], { timeout: 8000, windowsHide: true });
      } else {
        require('child_process').spawnSync('pkill', ['-f', '.*openclaw.*(index\\.js|openclaw\\.mjs).*'], { timeout: 5000, windowsHide: true });
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

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  runningProcesses,
  spawnPlatform,
  stopPlatform,
  // Re-export for legacy callers (configHandler.js, platformInstaller.js)
  prepareConfigForDocker: openclawRunner.prepareConfigForDocker,
  prepareConfigForNpm:    openclawRunner.prepareConfigForNpm,
};
