
const { spawn }       = require('child_process');
const path            = require('path');
const fs              = require('fs');
const os              = require('os');
const http            = require('http');
const { app, BrowserWindow } = require('electron');
const log             = require('./logger');

const runningProcesses = new Map();

function spawnPlatform(platformId, config, webContents) {
  if (runningProcesses.has(platformId)) return { success: false, reason: 'Already running' };

  const sendLog = (msg) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('platform-log', { platformId, msg });
    }
  };

  let child;

  // ── Background channel registration (non-blocking) ────────────────────
  // QR-based channels (zalouser, whatsapp) need the GLOBAL extension
  // (at ~/.openclaw/extensions/) not the bundled plugin (which lacks gateway
  // methods like loginWithQrStart).
  // A flag file prevents re-running on every startup, UNLESS the extension
  // directories are missing — in that case force re-registration regardless.
  // This must run REGARDLESS of PC/Docker mode because the host CLI always handles QR login!
  const pluginFlagFile = path.join(app.getPath('userData'), '.channel-plugins-registered');
  const QR_CHANNELS = ['zalouser', 'whatsapp'];
  const openclawExtDir = path.join(os.homedir(), '.openclaw', 'extensions');
  const anyExtensionMissing = QR_CHANNELS.some(ch => {
    const extPath = path.join(openclawExtDir, ch);
    return !fs.existsSync(extPath) || fs.readdirSync(extPath).length === 0;
  });
  const isWin = process.platform === 'win32';
  if (!fs.existsSync(pluginFlagFile) || anyExtensionMissing) {
    if (anyExtensionMissing) sendLog('[SYSTEM] Extension(s) missing — forcing plugin re-registration...');
    const regEnv = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', CI: '1' };

    sendLog('[SYSTEM] Background: registering QR channel plugins (one-time)...');
    Promise.allSettled(
      QR_CHANNELS.map(ch =>
        new Promise((resolve) => {
          const regProc = isWin
            ? require('child_process').spawn('cmd.exe', ['/c', 'openclaw', 'channels', 'add', '--channel', ch, '--skip-login'], { env: regEnv, windowsHide: true })
            : require('child_process').spawn('openclaw', ['channels', 'add', '--channel', ch, '--skip-login'], { env: regEnv, windowsHide: true });
          // Auto-confirm any prompts with Enter
          const sendEnter = () => {
            try { if (regProc.stdin && !regProc.stdin.destroyed) regProc.stdin.write('\r\n'); } catch (_) {}
          };
          setTimeout(sendEnter, 500);
          setTimeout(sendEnter, 1500);
          setTimeout(sendEnter, 3000);
          regProc.on('close', (code) => {
            sendLog(`[SYSTEM] Channel ${ch} registered (exit ${code})`);
            resolve(code);
          });
          regProc.on('error', () => resolve(-1));
          setTimeout(() => { try { regProc.kill(); } catch (_) {} resolve(-99); }, 30000);
        })
      )
    ).then(() => {
      try { fs.writeFileSync(pluginFlagFile, new Date().toISOString(), 'utf8'); } catch (_) {}
      sendLog('[SYSTEM] Channel plugins ready.');
    });
  }

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
        event.sender.send('platform-error', { platformId, error: 'openclaw CLI is missing or not in PATH. Please install it first.' });
        return;
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
       
       // Ensure OpenClaw binds to 'lan' instead of 'loopback' so that container port mapping works
       const openclawConfPath = path.join(openclawDir, 'openclaw.json');
       if (fs.existsSync(openclawConfPath)) {
           try {
               let confData = JSON.parse(fs.readFileSync(openclawConfPath, 'utf8'));
               if (!confData.gateway) confData.gateway = {};
               if (confData.gateway.bind !== 'lan') {
                   confData.gateway.bind = 'lan';
                   fs.writeFileSync(openclawConfPath, JSON.stringify(confData, null, 2), 'utf8');
               }
           } catch(e) { }
       }
       const dockerMountSrc = process.platform === 'win32'
         ? openclawDir.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => `/${d.toLowerCase()}`)
         : openclawDir;

       // If empty, or struck with the old NPM structure (non-docker), recreate standard execution command
       const targetTag = config.version ? config.version.replace(/^v+/i, '').trim() : 'latest';
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
           if (!scriptArr.includes('-v') && !scriptArr.some(arg => arg.includes(':/home/node/.openclaw'))) {
               scriptArr.splice(runIndex + 1, 0, '-v', `${dockerMountSrc}:/home/node/.openclaw`);
           }
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

       sendLog(`[SYSTEM] Pre-flight: Hard-killing any zombie openclaw instances...`);
       try {
         if (isWin) {
           // Invoke-CimMethod Terminate sends WM_CLOSE which Node.js ignores.
           // Stop-Process -Force is equivalent to taskkill /F and reliably kills the process.
           require('child_process').spawnSync('powershell', ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { timeout: 8000, windowsHide: true });
         } else {
           require('child_process').spawnSync('pkill', ['-f', 'openclaw.mjs'], { timeout: 5000 });
         }
       } catch (e) { }

       sendLog(`[SYSTEM] NPM mode: starting OpenClaw gateway (foreground)...`);
    } else {
       if (scriptArr.length === 0) scriptArr = ['npm', 'start'];
    }

    let cmd = scriptArr[0];
    // On Windows, .cmd scripts must run through cmd.exe (shell: true).
    // DO NOT manually add .cmd suffix - let the shell resolve it.
    // Only npm/npx need explicit .cmd on Windows when shell:false.
    if (isWin && (cmd === 'npm' || cmd === 'npx')) {
      cmd += '.cmd';
    }

    // Gateway uses default ~/.openclaw/openclaw.json — single source of truth.
    // No OPENCLAW_CONFIG_PATH override needed.
    const spawnEnv = { ...process.env, ...(config.env || {}) };

    sendLog(`[SYSTEM] Starting: ${cmd} ${scriptArr.slice(1).join(' ')}`);

    // On Windows, run via cmd.exe /c to execute .cmd scripts safely.
    // This avoids both the EINVAL error (can't spawn .cmd directly) and
    // the DEP0190 security warning from shell:true with arg concatenation.
    const spawnArgs = isWin
      ? ['cmd.exe', ['/c', cmd, ...scriptArr.slice(1)]]
      : [cmd, scriptArr.slice(1)];

    child = spawn(spawnArgs[0], spawnArgs[1], {
      cwd: config.cwd || app.getPath('home'),
      env: spawnEnv
    });

    sendLog(`[SYSTEM] Process started (PID: ${child.pid})`);

    // ── Token detection for npm-based platforms (e.g. OpenClaw) ────────────
    // Watch stdout for signals that the gateway is starting, then poll
    // the HTTP server until it is fully ready to serve the UI.
    let gatewayReadyEmitted = false;
    let gatewayPollerActive = false;
    const startGatewayPoller = () => {
      if (gatewayPollerActive || gatewayReadyEmitted) return;
      gatewayPollerActive = true;

      const poll = () => {
        if (gatewayReadyEmitted || !runningProcesses.has(platformId)) return;
        
        const configLoc = path.join(os.homedir(), '.openclaw', 'openclaw.json');
        let token;
        try {
          if (fs.existsSync(configLoc)) {
            const cfg = JSON.parse(fs.readFileSync(configLoc, 'utf8'));
            token = cfg?.gateway?.auth?.token;
          }
        } catch (_) {}

        if (!token) {
          setTimeout(poll, 1500);
          return;
        }

        const port = config.port || 18789;
        const dashboardUrl = `http://127.0.0.1:${port}/?token=${token}`;
        const pollUrl = `http://127.0.0.1:${port}/`;

        const req = http.get(pollUrl, (res) => {
           gatewayReadyEmitted = true;
           sendLog(`[SYSTEM] Gateway UI fully ready! Dashboard: ${dashboardUrl}`);
           const win = BrowserWindow.getAllWindows()[0];
           if (win && !win.isDestroyed()) {
             win.webContents.send('platform-ready', { platformId, dashboardUrl });
           }
        }).on('error', (err) => {
           setTimeout(poll, 1500);
        });

        // Add timeout to prevent hanging connections
        req.setTimeout(1000, () => {
           req.destroy();
        });
      };
      
      poll();
    };

    child.stdout.on('data', (data) => {
      const text = data.toString();
      text.split('\n').filter(Boolean).forEach(line => sendLog(line));
      // Detect gateway startup signals in logs
      if (!gatewayReadyEmitted && (text.includes('[gateway]') || text.includes('[heartbeat]'))) {
        startGatewayPoller();
      }
    });

    child.stderr.on('data', (data) => {
      data.toString().split('\n').filter(Boolean).forEach(line => sendLog(`[WARN] ${line}`));
    });

    child.on('exit', (code) => {
      sendLog(`[SYSTEM] Process exited with code ${code}`);
      runningProcesses.delete(platformId);
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('platform-status-change', { platformId, status: 'STOPPED' });
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
          ['-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
          { timeout: 8000, windowsHide: true }
        );
      } else {
        require('child_process').spawnSync('pkill', ['-f', 'openclaw.mjs'], { timeout: 5000 });
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

  