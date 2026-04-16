/**
 * platformInstaller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers the platform-install and platform-uninstall IPC handlers.
 * Handles npm / docker / generic install methods plus config compilation.
 */

const { ipcMain, app } = require('electron');
const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const log  = require('./logger');

// ── Async fire-and-forget spawn (never blocks main thread) ───────────────────
// Replaces spawnSync throughout uninstall flow so Electron stays responsive.
function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      const p = spawn(cmd, args, { stdio: 'ignore', windowsHide: true, ...opts });
      const t = setTimeout(() => { try { p.kill(); } catch (_) {} resolve(); }, opts.timeout || 8000);
      p.on('close', () => { clearTimeout(t); resolve(); });
      p.on('error', () => { clearTimeout(t); resolve(); });
    } catch (_) { resolve(); }
  });
}

// ── Config compiler ───────────────────────────────────────────────────────────
// Evaluates {{expr}} templates inside an install config object
function compileTemplate(template, context) {
  const processNode = (node) => {
    if (typeof node === 'string') {
      const strictMatch = node.match(/^\{\{(.+?)\}\}$/);
      if (strictMatch) {
        try {
          const keys = Object.keys(context);
          const values = Object.values(context);
          return new Function(...keys, `return ${strictMatch[1]}`)(...values);
        } catch { return ''; }
      }
      return node.replace(/\{\{(.+?)\}\}/g, (_, exp) => {
        try {
          const keys = Object.keys(context);
          const values = Object.values(context);
          return new Function(...keys, `return ${exp}`)(...values);
        } catch { return ''; }
      });
    }
    if (Array.isArray(node)) return node.map(processNode);
    if (typeof node === 'object' && node !== null) {
      const out = {};
      for (const [k, v] of Object.entries(node)) {
        const key = processNode(k);
        if (key) out[key] = processNode(v);
      }
      return out;
    }
    return node;
  };
  return processNode(template);
}

// ── Finalize Config ───────────────────────────────────────────────────────────
// Writes the compiled openclaw.json config to ~/.openclaw/ (single source of truth)
function finalizeConfig(targetDir, config, configMapping, sendLog) {
  if (config && configMapping) {
    sendLog('[INFO] Compiling dynamic Global Configuration...');
    try {
      const os = require('os');
      const openclawDir = path.join(os.homedir(), '.openclaw');
      if (!fs.existsSync(openclawDir)) fs.mkdirSync(openclawDir, { recursive: true });
      const configPath = path.join(openclawDir, 'openclaw.json');

      const llm = config.llm_config || {};

      let providerPrefix = llm.provider || 'openai';
      if (providerPrefix.toLowerCase() === 'openrouter') providerPrefix = 'openrouter';

      const rawModel = llm.model || '';
      const isOpenRouter = providerPrefix === 'openrouter';

      const hasProviderPrefix = rawModel.toLowerCase().startsWith(providerPrefix + '/');
      const assembledModel = hasProviderPrefix ? rawModel : `${providerPrefix}/${rawModel}`;
      const modelFull = isOpenRouter ? 'openrouter/auto' : assembledModel;

      sendLog(`[INFO] Provider prefix: ${providerPrefix}`);
      sendLog(`[INFO] Chosen model: ${assembledModel}`);

      const dynamicEnv = config.env || {};
      if (llm.provider && llm.key) {
        const envKey = `${llm.provider.toUpperCase()}_API_KEY`;
        dynamicEnv[envKey] = llm.key;
        if (llm.baseUrl) {
          dynamicEnv[`${llm.provider.toUpperCase()}_BASE_URL`] = llm.baseUrl;
        }
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

      if (llm.provider === 'custom' || llm.baseUrl) {
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
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
      fs.writeFileSync(path.join(targetDir, '.chosen-model'), assembledModel);
      sendLog(`[SUCCESS] Configuration written to ${configPath}. Chosen model saved: ${assembledModel}`);
    } catch (err) {
      sendLog(`[WARN] Config compiler error: ${err.message}`);
      log.error('[platformInstaller] Config compiler error:', err);
    }
  } else if (config) {
    fs.writeFileSync(path.join(targetDir, '.openclaw.json'), JSON.stringify(config, null, 2));
  }
}

// ── Uninstall Helper ──────────────────────────────────────────────────────────
async function uninstallPlatform(platformId, method, container, cwd, runningProcesses, registryId = '', wipeConfig = false) {
  const isWin = process.platform === 'win32';
  const isOpenClaw = platformId.toLowerCase().includes('openclaw') || registryId.toLowerCase().includes('openclaw');
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  // ── Step 1: Kill the tracked process ────────────────────────────────────────
  // On Windows, SIGTERM is a no-op for child processes. Use taskkill /F /T instead
  // to force-terminate the entire process tree before touching any files.
  const entry = runningProcesses.get(platformId);
  if (entry) {
    const pid = entry.process.pid;
    if (isWin) {
      await runCmd('taskkill', ['/F', '/T', '/PID', String(pid)], { timeout: 5000 });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch (_) { try { entry.process.kill('SIGTERM'); } catch (_) {} }
    }
    runningProcesses.delete(platformId);
  }

  // ── Step 2: Kill any zombies that survived (or were from previous sessions) ──
  // Must complete before npm uninstall or docker rm to avoid file-lock failures.
  if (method === 'npm' && isOpenClaw) {
    log.info('[Uninstall] Sweeping zombie openclaw processes...');
    if (isWin) {
      await runCmd('cmd.exe', ['/c', 'openclaw.cmd', 'gateway', 'stop'], { timeout: 4000 });
      await runCmd('powershell', [
        '-Command',
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '.*openclaw.*(index\\.js|openclaw\\.mjs|gateway).*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
      ], { timeout: 6000 });
    } else {
      await runCmd('openclaw', ['gateway', 'stop'], { timeout: 4000 });
      await runCmd('sh', ['-c', "pkill -f 'openclaw.*(gateway|index\\.js|openclaw\\.mjs)' 2>/dev/null || true"], { timeout: 3000 });
    }
    // Give OS time to release file handles before npm uninstall
    await wait(1500);
  }

  // ── Step 3: Method-specific removal ─────────────────────────────────────────
  if (method === 'docker') {
    const containerName = container || `${platformId}-clawexpress`;
    await runCmd('docker', ['rm', '-f', containerName], { timeout: 15000 });
  } else if (method === 'npm') {
    if (isOpenClaw) {
      const npmCmd = isWin ? 'npm.cmd' : 'npm';
      log.info('[Uninstall] Removing openclaw global npm package...');
      await runCmd(npmCmd, ['uninstall', '-g', 'openclaw'], { shell: isWin, timeout: 30000 });
    } else {
      log.info(`[Uninstall] Removing local npm directory for ${platformId}...`);
    }
  }

  // ── Step 4: Delete platform working directory ────────────────────────────────
  if (cwd && fs.existsSync(cwd)) {
    await fs.promises.rm(cwd, { recursive: true, force: true });
  }

  // ── Step 5: Wipe ~/.openclaw (only if user explicitly opted in) ─────────────
  // Default is false — skipping keeps config intact for other installed platforms
  // (e.g. removing NPM mode while Docker mode is still active, or vice versa).
  if (isOpenClaw && wipeConfig) {
    try {
      const os = require('os');
      const openclawDir = path.join(os.homedir(), '.openclaw');
      if (fs.existsSync(openclawDir)) {
        log.info(`[Uninstall] Wiping OpenClaw system directory: ${openclawDir}`);
        await fs.promises.rm(openclawDir, { recursive: true, force: true });
      }
    } catch (err) {
      log.error(`[Uninstall] Failed to remove ~/.openclaw: ${err.message}`);
    }
  }

  return { success: true };
}

// ── Register handlers ─────────────────────────────────────────────────────────
function registerPlatformInstallerHandlers(runningProcesses) {
  ipcMain.handle('platform-install', async (event, { platformId, method, config, configMapping, installScript }) => {
    const sendLog = (msg) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('platform-log', { platformId: `install-${platformId}`, msg });
      }
    };

    const platformsDir = path.join(app.getPath('userData'), 'platforms');
    const targetDir    = path.join(platformsDir, platformId);

    sendLog(`[SYSTEM] Initializing installation sequence for ${platformId}...`);
    sendLog(`[SYSTEM] Target directory: ${targetDir}`);
    sendLog(`[SYSTEM] Selected runtime: ${method.toUpperCase()}`);

    try {
      if (!fs.existsSync(platformsDir)) fs.mkdirSync(platformsDir);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      sendLog(`[ERROR] Failed to create directories: ${err.message}`);
      return { success: false, reason: err.message };
    }

    const doFinalizeConfig = () => finalizeConfig(targetDir, config, configMapping, sendLog);

    return new Promise((resolve) => {
      try {
        const isWin = process.platform === 'win32';
        
        const baseEnv = { ...process.env };
        if (process.platform === 'darwin') {
          baseEnv.PATH = `/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:${baseEnv.PATH || ''}`;
        }

        if (method === 'npm') {
          sendLog('[INFO] NPM method selected. Installing openclaw globally...');
          sendLog('[INFO] This may take a few minutes...');
          const npmCmd = isWin ? 'npm.cmd' : 'npm';
          sendLog('[CMD] npm install -g openclaw@latest');
          
          const npmEnv = { ...baseEnv, SHARP_IGNORE_GLOBAL_LIBVIPS: '1' };
          const installChild = spawn(npmCmd, ['install', '-g', 'openclaw@latest'], {
            cwd: targetDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: npmEnv,
            shell: isWin
          });

          installChild.stdout.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(l)));
          installChild.stderr.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(`[WARN] ${l}`)));
          installChild.on('error', err => {
            sendLog(`[ERROR] Failed to start npm: ${err.message}`);
            resolve({ success: false, reason: err.message });
          });
          installChild.on('close', code => {
            if (code !== 0) {
              sendLog(`[ERROR] openclaw install failed with exit code ${code}`);
              resolve({ success: false, reason: `npm install exit code ${code}` });
              return;
            }
            sendLog('[SUCCESS] openclaw installed globally.');
            doFinalizeConfig();
            const verifyCmd = isWin ? 'openclaw.cmd' : 'openclaw';
            const verify = require('child_process').spawnSync(verifyCmd, ['--version'], { encoding: 'utf8', env: baseEnv, shell: isWin });
            if (verify.status === 0) {
              sendLog(`[SUCCESS] openclaw CLI verified: ${verify.stdout.trim()}`);
            } else {
              sendLog('[WARN] openclaw CLI not found in PATH yet. You may need to restart your terminal or add npm global bin to PATH.');
            }
            resolve({ success: true, cwd: targetDir });
          });
          return;
        }

        if (!installScript || installScript.length === 0) {
          sendLog('[INFO] No installation script provided by Cloud Registry, keeping empty directory...');
          doFinalizeConfig();
          resolve({ success: true, cwd: targetDir });
          return;
        }

        let cmd = installScript[0];
        if (isWin && (cmd === 'npm' || cmd === 'npx' || cmd === 'docker')) {
          if (cmd === 'npm' || cmd === 'npx') cmd += '.cmd';
        }
        const args = installScript.slice(1);
        sendLog(`[INFO] Executing: ${cmd} ${args.join(' ')}`);

        const child = spawn(cmd, args, { 
          cwd: targetDir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: baseEnv,
          shell: isWin
        });
        child.stdout.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(l)));
        child.stderr.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(`[WARN] ${l}`)));
        child.on('error', err => {
          sendLog(`[ERROR] Failed to start command: ${err.message}`);
          resolve({ success: false, reason: err.message });
        });
        child.on('close', code => {
          if (code === 0) {
            sendLog('[SUCCESS] Execution completed successfully.');
            doFinalizeConfig();
            resolve({ success: true, cwd: targetDir });
          } else {
            sendLog(`[ERROR] Execution failed with exit code ${code}`);
            resolve({ success: false, reason: `Exit code ${code}` });
          }
        });

      } catch (err) {
        resolve({ success: false, reason: err.message });
      }
    });
  });

  ipcMain.handle('install-global-dependency', async (event) => {
    const sendLog = (msg) => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('dependency-log', msg);
      }
    };
    return new Promise((resolve) => {
      try {
        const isWin = process.platform === 'win32';
        const baseEnv = { ...process.env };
        if (process.platform === 'darwin') {
          baseEnv.PATH = `/usr/local/bin:/opt/homebrew/bin:/opt/local/bin:${baseEnv.PATH || ''}`;
        }
        
        sendLog('[SYSTEM] Starting automatic installation...');
        sendLog('[CMD] npm install -g openclaw@latest');
        
        const npmCmd = isWin ? 'npm.cmd' : 'npm';
        const npmEnv = { ...baseEnv, SHARP_IGNORE_GLOBAL_LIBVIPS: '1' };
        
        const child = spawn(npmCmd, ['install', '-g', 'openclaw@latest'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: npmEnv,
          shell: isWin
        });
        
        child.stdout.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(`[INFO] ${l}`)));
        child.stderr.on('data', d => d.toString().split(/[\r\n]+/).filter(Boolean).forEach(l => sendLog(`[WARN] ${l}`)));
        
        child.on('error', err => {
          sendLog(`[ERROR] Failed to start npm: ${err.message}`);
          resolve({ success: false, reason: err.message });
        });
        
        child.on('close', code => {
          if (code !== 0) {
            sendLog(`[ERROR] Installation failed with exit code ${code}`);
            resolve({ success: false, reason: `Exit code ${code}` });
          } else {
            sendLog('[SUCCESS] openclaw installed globally.');
            resolve({ success: true });
          }
        });
      } catch (err) {
        sendLog(`[ERROR] ${err.message}`);
        resolve({ success: false, reason: err.message });
      }
    });
  });

  ipcMain.handle('platform-uninstall', async (event, { platformId, method, container, cwd, registryId, wipeConfig }) => {
    return uninstallPlatform(platformId, method, container, cwd, runningProcesses, registryId || '', wipeConfig === true);
  });

  ipcMain.handle('platform-preflight-check', async (event, { method, port }) => {
    const checks = [];
    let success = true;

    // 1. Dependency Check
    try {
      if (method === 'docker') {
        const { spawnSync } = require('child_process');
        const res = spawnSync('docker', ['info']);
        if (res.status === 0) {
          checks.push({ id: 'dep', status: 'success', text: 'Docker daemon is running.' });
        } else {
          checks.push({ id: 'dep', status: 'error', text: 'Docker daemon is not running. Please start Docker Desktop.' });
          success = false;
        }
      } else if (method === 'npm') {
        const { spawnSync } = require('child_process');
        const isWin = process.platform === 'win32';
        const res = spawnSync('node', ['-v'], { shell: isWin });
        if (res.status === 0) {
          const ver = res.stdout.toString().trim();
          checks.push({ id: 'dep', status: 'success', text: `Node.js ${ver} detected.` });
        } else {
          checks.push({ id: 'dep', status: 'error', text: 'Node.js is not installed or not in PATH. Please install Node.js.' });
          success = false;
        }
      } else {
        checks.push({ id: 'dep', status: 'success', text: `Method ${method} requires no additional global dependencies.` });
      }
    } catch (e) {
      checks.push({ id: 'dep', status: 'error', text: `Dependency check failed: ${e.message}` });
      success = false;
    }

    // 2. Memory Check
    try {
      const os = require('os');
      const totalMemGB = os.totalmem() / (1024 ** 3);
      if (totalMemGB >= 3.5) {
        checks.push({ id: 'ram', status: 'success', text: `Memory: ${totalMemGB.toFixed(1)}GB available (Pass)` });
      } else {
        checks.push({ id: 'ram', status: 'error', text: `Memory: ${totalMemGB.toFixed(1)}GB detected. At least 4GB is recommended.` });
        success = false;
      }
    } catch (e) {
      checks.push({ id: 'ram', status: 'error', text: 'Failed to verify system memory.' });
      success = false;
    }

    // 3. Port Check
    try {
      const net = require('net');
      const targetPort = port || 18789;
      const isPortAvailable = await new Promise((resolve) => {
        const srv = net.createServer();
        srv.once('error', () => resolve(false));
        srv.once('listening', () => { srv.close(); resolve(true); });
        srv.listen(targetPort, '127.0.0.1');
      });

      if (isPortAvailable) {
        checks.push({ id: 'port', status: 'success', text: `Port ${targetPort} is available.` });
      } else {
        checks.push({ id: 'port', status: 'error', text: `Port ${targetPort} is currently in use. Please free this port first.` });
        success = false;
      }
    } catch (e) {
      checks.push({ id: 'port', status: 'error', text: `Port verification failed: ${e.message}` });
      success = false;
    }

    return { success, checks };
  });

  log.info('[platformInstaller] IPC handlers registered.');
}

module.exports = { registerPlatformInstallerHandlers };
