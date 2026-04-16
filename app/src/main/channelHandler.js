/**
 * channelHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers IPC handlers for QR-based channel login flows:
 *   channel-login        : Start QR login for WhatsApp / Zalo / etc.
 *   channel-logout       : Logout a channel
 *   channel-login-cancel : Kill active login process
 *
 * Login strategy (simple & transparent):
 *   • Gateway MUST be running first — user starts it from Installed page.
 *   • Gateway channels (whatsapp) → use RPC (web.login.start / web.login.wait)
 *   • CLI-only channels (zalouser) → stop gateway, run standalone CLI, restart gateway
 *   • If gateway is NOT running → return clear error, UI tells user to start it.
 */

const { ipcMain } = require('electron');
const fs   = require('fs');
const path = require('path');
const net  = require('net');
const os   = require('os');
const log  = require('./logger');
const { prepareConfigForDocker, prepareConfigForNpm } = require('./processManager');

const channelLoginProcs = new Map();

const GATEWAY_LOGIN_CHANNELS = new Set(['web', 'whatsapp', 'zalouser']);

/**
 * Run `openclaw gateway call <method> --json` and return parsed JSON result.
 */
function gatewayCall(method, params, env, timeoutMs = 35000) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const isWin = process.platform === 'win32';
    const args = ['gateway', 'call', method, '--json', '--timeout', String(timeoutMs)];
    if (params && Object.keys(params).length > 0) {
      args.push('--params', JSON.stringify(params));
    }

    const child = isWin
      ? spawn('cmd.exe', ['/c', 'openclaw', ...args], { env, windowsHide: true })
      : spawn('openclaw', args, { env, windowsHide: true });

    let stdoutBuf = '';
    let stderrBuf = '';
    child.stdout.on('data', d => { stdoutBuf += d.toString(); });
    child.stderr.on('data', d => { stderrBuf += d.toString(); });

    const timeout = setTimeout(() => {
      if (isWin) {
        try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]); } catch (_) {}
      } else {
        try { child.kill('SIGTERM'); } catch (_) {}
      }
      resolve({ error: true, raw: stdoutBuf + stderrBuf, message: 'Gateway call timed out after ' + timeoutMs + 'ms' });
    }, timeoutMs + 3000);

    child.on('close', (code) => {
      clearTimeout(timeout);
      
      // Try to parse stdout directly first
      try {
        resolve(JSON.parse(stdoutBuf.trim()));
        return;
      } catch (_) {}

      // Try finding the JSON bounds in stdout
      const start = stdoutBuf.indexOf('{');
      const end = stdoutBuf.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          resolve(JSON.parse(stdoutBuf.slice(start, end + 1)));
          return;
        } catch (_) {}
      }

      // Try combined buffer as fallback
      const combined = stdoutBuf + stderrBuf;
      const cStart = combined.indexOf('{');
      const cEnd = combined.lastIndexOf('}');
      if (cStart >= 0 && cEnd > cStart) {
        try {
          resolve(JSON.parse(combined.slice(cStart, cEnd + 1)));
          return;
        } catch (_) {}
      }

      resolve({ error: true, raw: combined, message: 'Failed to parse JSON from gateway response', exitCode: code });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ error: true, raw: stdoutBuf + stderrBuf, message: 'Process error: ' + err.message });
    });
  });
}

/** TCP probe — returns true if something is listening on the given port */
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

/** Try to read QR PNG file from known locations on disk */
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

function registerChannelHandlers(runningProcesses) {
  ipcMain.handle('channel-login', async (event, { channel, platformId, platformConfig }) => {
    const isWin = process.platform === 'win32';
    const { execSync } = require('child_process');
    
    // ── Environment Precondition Checks ────────────────────────────────────
    if (platformConfig?.method === 'docker') {
      try {
        execSync('docker info', { stdio: 'ignore' });
      } catch (err) {
        return { success: false, reason: 'Docker is not running or not installed. Please start Docker first.' };
      }
    } else {
      try {
        const shellOpt = isWin ? 'cmd.exe' : '/bin/bash';
        execSync('openclaw --version', { shell: shellOpt, stdio: 'ignore' });
      } catch (err) {
        return { success: false, reason: 'openclaw CLI is missing or not in PATH. Please install it first.' };
      }
    }
    // ──────────────────────────────────────────────────────────────────────

    // Kill any existing login process for this channel
    if (channelLoginProcs.has(channel)) {
      channelLoginProcs.get(channel).kill();
      channelLoginProcs.delete(channel);
    }

    const send = (type, payload) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('channel-login-event', { channel, type, ...payload });
      }
    };

    const env = { ...process.env };
    env.NO_COLOR   = '1';
    env.FORCE_COLOR = '0';
    env.TERM = 'dumb';
    env.CI   = '1';

    // Single source of truth: ~/.openclaw/openclaw.json
    const cfgFile = path.join(os.homedir(), '.openclaw', 'openclaw.json');

    // ── Pre-registration bypassed: Let OpenClaw's CLI strictly manage its own plugin installations ─

    // Zalo plugin is bundled with OpenClaw — no separate install needed.

    // ── Check if gateway is reachable ────────────────────────────────────
    const gatewayPort = platformConfig?.port || 18789;
    const gatewayUp = await isPortOpen(gatewayPort);
    log.info(`[channelHandler] Gateway probe: ${gatewayUp ? 'UP' : 'DOWN'} for ${channel}`);

    // ════════════════════════════════════════════════════════════════════════
    // Per OpenClaw docs (https://docs.openclaw.ai/channels/whatsapp):
    //   Step 1: Configure access policy
    //   Step 2: openclaw channels login --channel whatsapp  ← standalone CLI
    //   Step 3: openclaw gateway                            ← start AFTER login
    //
    // Both WhatsApp and Zalo use standalone CLI login.
    // WhatsApp: auto-stops gateway if running, runs CLI, auto-restarts after.
    // Zalo:     UI requires gateway to be stopped first (uses headless browser).
    // ════════════════════════════════════════════════════════════════════════
    if (GATEWAY_LOGIN_CHANNELS.has(channel)) {

      // ══════════════════════════════════════════════════════════════════
      // WHATSAPP STANDALONE LOGIN
      // Documented flow: channels login CLI → then start gateway.
      // If gateway is running, we stop it automatically, run the CLI to get
      // the QR and complete linking, then restart the gateway.
      // This avoids all web.login.start/wait RPC issues (hot-reload, key
      // conflicts, Baileys state collisions).
      // ══════════════════════════════════════════════════════════════════
      if (channel === 'whatsapp' || channel === 'web') {
        // ── Flow ──────────────────────────────────────────────────────────────
        // 1. Stop gateway
        // 2. Write a batch/shell script that runs the CLI and writes a sentinel file
        // 3. Open a visible terminal with that script (CMD auto-closes after /c)
        // 4. Tell UI → show "waiting for terminal" screen
        // 5. Poll sentinel file → when CLI exits 0: success + restart gateway
        // ─────────────────────────────────────────────────────────────────────

        const isWin = process.platform === 'win32';

        // Step 1: stop gateway
        send('log', { line: '[ClawExpress] Stopping gateway…' });
        
        const { stopPlatform } = require('./processManager');
        if (platformId) {
          stopPlatform(platformId, null, platformConfig?.method, platformConfig?.container);
        } else {
          // Fallback cleanup if platformId missing
          if (isWin) {
            require('child_process').spawnSync('powershell', ['-Command',
              "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'openclaw.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"],
              { timeout: 8000, windowsHide: true });
          } else {
            require('child_process').spawnSync('pkill', ['-f', 'openclaw.mjs'], { timeout: 5000 });
          }
        }
        // The gateway is stopped. Wait briefly for OS to release ports.
        await new Promise(r => setTimeout(r, 2000));

        // Tell UI to open the embedded terminal with the login command.
        // ptyHandler.js (main process) + EmbeddedTerminal (renderer) handle the PTY lifecycle.
        // On exit code 0 the renderer will send success + restart the gateway.
        let ptyCommand, ptyArgs;
        if (platformConfig?.method === 'docker') {
           const openclawDir = path.join(os.homedir(), '.openclaw');
           prepareConfigForDocker(openclawDir);
           
           const envArgs = [];
           try {
             const cfg = JSON.parse(fs.readFileSync(path.join(openclawDir, 'openclaw.json'), 'utf8'));
             if (cfg.env) {
               for (const [k, v] of Object.entries(cfg.env)) {
                 envArgs.push('-e', `${k}=${v}`);
               }
             }
           } catch (_) {}
           
           const dockerMountSrc = openclawDir;
           // Rely entirely on the :latest tag since installer/updater handle syncing it locally
           const targetImage = `ghcr.io/openclaw/openclaw:latest`;

           ptyCommand = 'docker';
           ptyArgs = ['run', ...envArgs, '-e', 'CI=1', '-it', '--rm', '-v', `${dockerMountSrc}:/home/node/.openclaw`, targetImage, 'node', 'openclaw.mjs', 'channels', 'login', '--channel', 'whatsapp'];
        } else {
           prepareConfigForNpm(platformConfig?.port || 18789);
           
           ptyCommand = isWin ? 'cmd.exe' : 'openclaw';
           ptyArgs    = isWin
             ? ['/c', 'openclaw', 'channels', 'login', '--channel', 'whatsapp']
             : ['channels', 'login', '--channel', 'whatsapp'];
        }

        send('terminal-opened', { platformId, platformConfig, command: ptyCommand, args: ptyArgs });

        return { success: true };
      } // end whatsapp

      // ══════════════════════════════════════════════════════════════════
      // ZALO STANDALONE LOGIN
      // Zalo uses zca-js running a heavy headless browser (~1-3 minutes).
      // OpenClaw Gateway will timeout after 25s → killing the QR process.
      // => Gateway MUST BE OFF before connecting to Zalo.
      // The UI already disabled the Connect button when the Gateway is running.
      // ══════════════════════════════════════════════════════════════════
      if (channel === 'zalouser') {
        send('log', { line: '[ClawExpress] Initiating Zalo connection (Standalone mode)...' });

        // Final safety check — if port is still open, try to kill phantom proc
        if (await isPortOpen(gatewayPort)) {
          if (process.platform === 'win32') {
             try {
                const execSync = require('child_process').execSync;
                const out = execSync(`netstat -ano | findstr :${gatewayPort}`).toString();
                const lines = out.split('\n').filter(l => l.includes('LISTENING'));
                if (lines.length > 0) {
                    const parts = lines[0].trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid) {
                        send('log', { line: `[ClawExpress] Terminating phantom process on Port ${gatewayPort} (PID: ${pid})...` });
                        execSync(`taskkill /F /PID ${pid}`);
                    }
                }
             } catch(e) {}
             await new Promise(r => setTimeout(r, 1000));
          }

          if (await isPortOpen(gatewayPort)) {
            send('error', { message: `A phantom OpenClaw process is still holding Port ${gatewayPort}. Please manually kill Node.js tasks or restart your PC, then try again.` });
            return { success: false, reason: 'gateway-must-stop' };
          }
        }

        // ── PREPARE CLEAN ENVIRONMENT ──
        const qrFileName = `openclaw-${channel}-qr-default.png`;
        const qrLocations = [
          path.join('C:\\tmp', 'openclaw', qrFileName),
          path.join('/tmp', 'openclaw', qrFileName),
          path.join(os.tmpdir(), 'openclaw', qrFileName),
          path.join(os.homedir(), '.openclaw', qrFileName),
          path.join(os.homedir(), '.openclaw', 'tmp', qrFileName), // For Docker mounted tmp
        ];
        for (const loc of qrLocations) {
          try { if (fs.existsSync(loc)) fs.unlinkSync(loc); } catch (_) {}
        }

        const isWin = process.platform === 'win32';
        let cliCmd, cliArgs, containerName;
        if (platformConfig?.method === 'docker') {
           const openclawDir = path.join(os.homedir(), '.openclaw');
           prepareConfigForDocker(openclawDir);
           
           const envArgs = [];
           try {
             const cfg = JSON.parse(fs.readFileSync(path.join(openclawDir, 'openclaw.json'), 'utf8'));
             if (cfg.env) {
               for (const [k, v] of Object.entries(cfg.env)) {
                 envArgs.push('-e', `${k}=${v}`);
               }
             }
           } catch (_) {}
           
           const dockerMountSrc = openclawDir;
           const tmpHostDir = path.join(openclawDir, 'tmp');
           fs.mkdirSync(tmpHostDir, { recursive: true });

           // Rely entirely on the :latest tag since installer/updater handle syncing it locally
           const targetImage = `ghcr.io/openclaw/openclaw:latest`;

           containerName = `openclaw_zalo_${Date.now()}`;
           cliCmd = 'docker';
           cliArgs = ['run', '--name', containerName, ...envArgs, '-e', 'CI=1', '-it', '--rm', '-v', `${dockerMountSrc}:/home/node/.openclaw`, targetImage, 'node', 'openclaw.mjs', 'channels', 'login', '--channel', channel];
        } else {
           prepareConfigForNpm(platformConfig?.port || 18789);
           
           cliCmd = isWin ? 'cmd.exe' : 'openclaw';
           cliArgs = isWin
             ? ['/c', 'openclaw', 'channels', 'login', '--channel', channel]
             : ['channels', 'login', '--channel', channel];
        }
        
        // Zalo CLI must run exactly like typing inside CMD.
        // CI=1 and TERM=dumb causes the CLI to skip QR generation and exit immediately.
        const cliEnv = { ...process.env };  // use pristine env, NO CI=1
        delete cliEnv.CI;
        delete cliEnv.TERM;
        cliEnv.NO_COLOR = '1';
        cliEnv.FORCE_COLOR = '0';

        // ── HANDOVER EXECUTION TO FRONTEND TERMINAL ──
        send('terminal-opened', { platformId, platformConfig, command: cliCmd, args: cliArgs, env: cliEnv });
        
        let qrFileFound = false;
        let done = false;
        
        // Expose a cancel fn so when the user hits cancel/done, we clear the interval
        channelLoginProcs.set(channel, {
          kill: () => { done = true; }
        });

        // ── START POLLING FOR QR FILE ──
        const pollInterval = setInterval(() => {
          if (done) { clearInterval(pollInterval); return; }
          
          if (platformConfig?.method === 'docker' && containerName) {
            try {
              const execSync = require('child_process').execSync;
              const hostTmpFile = path.join(os.homedir(), '.openclaw', 'tmp', qrFileName);
              
              // Run find inside container to locate any subfolder in /tmp avoiding uid hardcodes
              execSync(`docker exec ${containerName} sh -c "mkdir -p /home/node/.openclaw/tmp && find /tmp -name '${qrFileName}' -exec cp {} /home/node/.openclaw/tmp/${qrFileName} \\;"`, { stdio: 'ignore' });
            } catch (e) {
              // Ignore exec errors (e.g. file is not there yet)
            }
          }

          const qr = tryReadQrFile(channel, 5 * 60 * 1000);
          if (qr && !qrFileFound) {
            qrFileFound = true;
            clearInterval(pollInterval);
            send('qr-image', { dataUrl: qr.dataUrl });
            send('log', { line: `[ClawExpress] ✅ Zalo QR file detected on disk — Please scan it with your phone!` });
          }
        }, 2000);

        // ── AUTO TIMEOUT ──
        setTimeout(() => {
          if (!done) {
            done = true;
            clearInterval(pollInterval);
            send('error', { message: 'Zalo QR generation timed out after 5 minutes. Please try again.' });
            send('close', { code: 1 });
          }
        }, 5 * 60 * 1000);

        return { success: true };
      }

      // Gateway didn't produce QR (fallback)
      send('error', { message: 'Could not generate QR code. Try restarting OpenClaw and trying again.' });
      return { success: false, reason: 'no-qr' };
    }

    // Channel not in GATEWAY_LOGIN_CHANNELS — unsupported
    send('error', { message: `Channel "${channel}" is not supported for QR login.` });
    return { success: false, reason: 'unsupported-channel' };
  });

  // Called by UI when user confirms WhatsApp QR was scanned and linked.
  // Restarts the gateway so it picks up the new credentials.
  try { ipcMain.removeHandler('channel-login-complete'); } catch (_) {}
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

  try { ipcMain.removeHandler('channel-logout'); } catch (_) {}
  ipcMain.handle('channel-logout', async (event, { channel }) => {
    if (channelLoginProcs.has(channel)) {
      const proc = channelLoginProcs.get(channel);
      if (process.platform === 'win32') {
        try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch (_) {}
      } else {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }
      channelLoginProcs.delete(channel);
    }
    
    const isWin = process.platform === 'win32';
    const logoutEnv = { ...process.env };
    
    // For all channels, we now rely entirely on physical deletion of session files 
    // because the UI forces the OpenClaw gateway to stop before invoking this handler.
    // Calling gatewayCall('web.login.cancel') here when the gateway is stopped would hang for 10s.

    const tryRmDir = async (dirPath) => {
      // On Windows, file handles from the killed gateway process can persist briefly.
      // Retry up to 4 times with increasing delays to survive EBUSY/EPERM errors.
      const delays = [0, 1000, 2000, 3000];
      let lastErr = null;
      for (const delay of delays) {
        if (delay > 0) await new Promise(r => setTimeout(r, delay));
        try {
          if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
          }
          return null; // success
        } catch (e) {
          lastErr = e;
          log.info(`[channelHandler] rmSync attempt failed (will retry): ${e.message}`);
        }
      }
      return lastErr;
    };

    try {
      const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
      const sessionDir = path.join(openclawDir, 'credentials', channel);

      const err1 = await tryRmDir(sessionDir);
      if (err1) return { success: false, output: `Failed to remove session: ${err1.message}` };

      // Known anomaly for zalouser fallback folder
      if (channel === 'zalouser') {
        const fallbackSessionDir = path.join(openclawDir, 'credentials', 'whatsapp', 'zalouser-default');
        const err2 = await tryRmDir(fallbackSessionDir);
        if (err2) return { success: false, output: `Failed to remove Zalo fallback session: ${err2.message}` };
      }

      // Clean up channel config and plugin entries from openclaw.json.
      // Since we now restart the gateway after QR linking anyway, we can cleanly remove
      // the plugin entries during logout without worrying about breaking runtime sessions.
      try {
        const cfgFile = path.join(openclawDir, 'openclaw.json');
        if (fs.existsSync(cfgFile)) {
          const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
          let changed = false;
          
          if (cfg.channels && cfg.channels[channel] !== undefined) {
            delete cfg.channels[channel];
            changed = true;
          }
          
          if (cfg.plugins && cfg.plugins.entries && cfg.plugins.entries[channel] !== undefined) {
            delete cfg.plugins.entries[channel];
            changed = true;
          }
          
          if (changed) {
            fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
            log.info(`[channelHandler] Removed ${channel} from channels and plugins.entries in openclaw.json`);
          }
        }
      } catch (cfgErr) {
        log.info(`[channelHandler] Warning: could not clean config for ${channel}: ${cfgErr.message}`);
      }

      return { success: true, output: 'Logged out successfully.' };
    } catch (err) {
      return { success: false, output: `Failed to remove session locally: ${err.message}` };
    }
  });

  ipcMain.handle('channel-login-success', async (event, { channel }) => {
    try {
      const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
      const cfgFile = path.join(openclawDir, 'openclaw.json');
      if (fs.existsSync(cfgFile)) {
        const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
        let changed = false;

        cfg.channels = cfg.channels || {};
        if (!cfg.channels[channel]) {
          cfg.channels[channel] = {
            enabled: true,
            dmPolicy: 'pairing',
          };
          changed = true;
        }

        cfg.plugins = cfg.plugins || {};
        cfg.plugins.entries = cfg.plugins.entries || {};
        if (!cfg.plugins.entries[channel] || !cfg.plugins.entries[channel].enabled) {
          cfg.plugins.entries[channel] = { enabled: true };
          changed = true;
        }
        
        if (changed) {
          fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
          log.info(`[channelHandler] Injected default open policy and plugin entry for ${channel} upon successful login.`);
        }
      }
      return { success: true };
    } catch (err) {
      log.error(`[channelHandler] Failed to save config on success: ${err.message}`);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('channel-login-cancel', (event, { channel }) => {
    if (channelLoginProcs.has(channel)) {
      const proc = channelLoginProcs.get(channel);
      if (process.platform === 'win32') {
        try { require('child_process').spawnSync('taskkill', ['/F', '/T', '/PID', String(proc.pid)]); } catch (_) {}
      } else {
        try { proc.kill('SIGTERM'); } catch (_) {}
      }
      channelLoginProcs.delete(channel);
      return { success: true };
    }
    return { success: false, reason: 'No active login process' };
  });
  // ── Check if a channel is currently linked (filesystem-based) ──────
  ipcMain.handle('channel-check-linked', async (event, { channel }) => {
    const openclawDir = path.join(process.env.USERPROFILE || process.env.HOME, '.openclaw');
    
    if (channel === 'whatsapp') {
      // Baileys stores session files in ~/.openclaw/credentials/whatsapp/default/
      const sessionDir = path.join(openclawDir, 'credentials', 'whatsapp', 'default');
      try {
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir);
          if (files.length > 0) {
            log.info(`[channelHandler] channel-check-linked(whatsapp): LINKED (${files.length} session files)`);
            return { linked: true, phone: null, message: `WhatsApp session active (${files.length} files)` };
          }
        }
      } catch (_) {}
      log.info(`[channelHandler] channel-check-linked(whatsapp): NOT LINKED (no session files)`);
      return { linked: false };
    }
    
    if (channel === 'zalouser') {
      // zca-js stores session at ~/.openclaw/credentials/zalouser/credentials.json
      const sessionDir = path.join(openclawDir, 'credentials', 'zalouser');
      const credFile = path.join(sessionDir, 'credentials.json');
      try {
        if (fs.existsSync(credFile) && fs.statSync(credFile).size > 10) {
          log.info(`[channelHandler] channel-check-linked(zalouser): LINKED (credentials.json exists)`);
          return { linked: true, phone: null, message: 'Zalo session active' };
        }
        // Fallback: check if the directory has any files at all
        if (fs.existsSync(sessionDir)) {
          const files = fs.readdirSync(sessionDir);
          if (files.length > 0) {
            log.info(`[channelHandler] channel-check-linked(zalouser): LINKED (${files.length} session files)`);
            return { linked: true, phone: null, message: `Zalo session active (${files.length} files)` };
          }
        }
      } catch (_) {}
      log.info(`[channelHandler] channel-check-linked(zalouser): NOT LINKED`);
      return { linked: false };
    }

    return { linked: false, reason: 'unknown-channel' };
  });

  log.info('[channelHandler] IPC handlers registered.');
}

module.exports = { registerChannelHandlers };
