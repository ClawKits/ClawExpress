/**
 * openclawUpdater.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers IPC handlers for managing the openclaw CLI version lifecycle:
 *   get-openclaw-versions     : Returns current installed + latest available versions
 *   openclaw-install-version  : Installs a specific openclaw version with
 *                               checkpoint/rollback safety
 */

const { ipcMain, app } = require('electron');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const log  = require('./logger');

function registerOpenclawUpdaterHandlers() {
  // ── get-openclaw-versions ─────────────────────────────────────────────────
  ipcMain.handle('get-openclaw-versions', async (event, params) => {
    try {
      const method = (params && params.method) || 'npm';
      let current = 'unknown';
      let latest = 'unknown';
      let versions = [];

      if (method === 'docker') {
        try {
          const tokenRes = await fetch('https://ghcr.io/token?scope=repository:openclaw/openclaw:pull');
          const tokenData = await tokenRes.json();
          const token = tokenData.token;

          const tagsRes = await fetch('https://ghcr.io/v2/openclaw/openclaw/tags/list?n=10000', {
            headers: { Authorization: `Bearer ${token}` }
          });
          const tagsData = await tagsRes.json();
          let allTags = tagsData.tags || [];

          current = 'unknown';
          try {
            const util = require('util');
            const exec = util.promisify(require('child_process').exec);
            const targetTag = (params && params.config && params.config.version) ? params.config.version.replace(/^v+/i, '').trim() : 'latest';
            
            const isWin = process.platform === 'win32';
            const PATH_SEP = isWin ? ';' : ':';
            const home = require('os').homedir();
            const macPaths = `/usr/local/bin:/opt/homebrew/bin:${home}/.npm-global/bin:${home}/.orbstack/bin`;
            const customPath = process.env.PATH + PATH_SEP + (isWin ? '' : macPaths);
            const envWithPath = { ...process.env, PATH: customPath };
            const shellOpt = isWin ? 'cmd.exe' : '/bin/bash';

            let imageExistsLocally = false;
            try {
              await exec(`docker image inspect ghcr.io/openclaw/openclaw:${targetTag}`, { shell: shellOpt, env: envWithPath });
              imageExistsLocally = true;
            } catch (err) {}

            let tagToRun = null;
            if (imageExistsLocally) {
                tagToRun = targetTag;
            } else {
                try {
                  await exec(`docker image inspect ghcr.io/openclaw/openclaw:latest`, { shell: shellOpt, env: envWithPath });
                  tagToRun = 'latest';
                } catch (err) {}
            }

            if (tagToRun) {
              const { stdout } = await exec(`docker run --rm ghcr.io/openclaw/openclaw:${tagToRun} node openclaw.mjs --version`, { 
                shell: shellOpt,
                env: envWithPath
              });
              const match = stdout.trim().match(/\d+\.\d+\.\d+(?:-\w+)?/);
              if (match) current = match[0];
            }
          } catch(e) {
            log.warn('[Updater] Could not retrieve local docker version. Container missing or stopped?', e.message);
          }

          const pVersion = (params && params.pVersion) || '';
          const isPreviewTrack = current.includes('-preview') || pVersion.includes('-preview');

          // Filter by track
          if (isPreviewTrack) {
            allTags = allTags.filter(t => t.match(/^\d+\.\d+\.\d+-preview$/))
                             .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          } else {
            allTags = allTags.filter(t => t.match(/^\d+\.\d+\.\d+$/))
                             .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          }

          versions = allTags.slice(0, 15);
          latest = allTags[0] || current;

          return { success: true, current, latest, versions };
        } catch (err) {
          log.error('[Updater] Docker version check failed:', err.message);
          return { success: false, reason: err.message };
        }
      }

      const util = require('util');
      const exec = util.promisify(require('child_process').exec);
      const isWin    = process.platform === 'win32';
      const shellOpt = isWin ? 'cmd.exe' : '/bin/bash';

      const PATH_SEP = isWin ? ';' : ':';
      const home = require('os').homedir();
      const macPaths = `/usr/local/bin:/opt/homebrew/bin:${home}/.npm-global/bin:${home}/.orbstack/bin`;
      const customPath = process.env.PATH + PATH_SEP + (isWin ? '' : macPaths);
      const envWithPath = { ...process.env, PATH: customPath };

      try {
        const { stdout } = await exec('openclaw --version', { shell: shellOpt, env: envWithPath });
        const match = stdout.trim().match(/\d+\.\d+\.\d+(?:-\w+)?/);
        if (match) current = match[0];
      } catch (_) {
        try {
          const { stdout } = await exec('npx --no-install openclaw --version', { shell: shellOpt, env: envWithPath });
          const match2 = stdout.trim().match(/\d+\.\d+\.\d+(?:-\w+)?/);
          if (match2) current = match2[0];
        } catch (e2) {
          log.error('[Updater] version check failed entirely:', e2.message);
        }
      }

      // Check current version from params or exec
      const pVersion = (params && params.pVersion) || '';
      const isPreviewTrack = current.includes('-preview') || pVersion.includes('-preview');

      const res = await fetch(`https://registry.npmjs.org/openclaw?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`NPM Registry responded with ${res.status}`);
      const data     = await res.json();
      
      let allNpmVersions = Object.keys(data.versions || {}).reverse();
      
      if (isPreviewTrack) {
        versions = allNpmVersions.filter(v => v.includes('-preview'));
        // Sort to ensure highest preview version is first
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return {
          success: true,
          current,
          latest: versions[0] || current,
          versions: versions.slice(0, 15)
        };
      } else {
        versions = allNpmVersions.filter(v => !v.includes('-'));
        versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        return {
          success: true,
          current,
          latest: data['dist-tags']?.latest || versions[0],
          versions: versions.slice(0, 15),
        };
      }
    } catch (err) {
      log.error('[Updater] Failed to get versions:', err.message);
      return { success: false, reason: err.message };
    }
  });

  // ── openclaw-install-version ──────────────────────────────────────────────
  ipcMain.handle('openclaw-install-version', async (event, { targetVersion, cwd, method }) => {
    if (!targetVersion) return { success: false, reason: 'Target version is required' };

    const util = require('util');
    const exec = util.promisify(require('child_process').exec);
    const spawn = require('child_process').spawn;
    const isWin    = process.platform === 'win32';
    const shellOpt = isWin ? 'cmd.exe' : '/bin/bash';

    const PATH_SEP = isWin ? ';' : ':';
    const home = require('os').homedir();
    const macPaths = `/usr/local/bin:/opt/homebrew/bin:${home}/.npm-global/bin:${home}/.orbstack/bin`;
    const customPath = process.env.PATH + PATH_SEP + (isWin ? '' : macPaths);
    const envWithPath = { ...process.env, PATH: customPath };

    try {
      if (method === 'docker') {
         log.info(`[Updater] Pulling docker image ghcr.io/openclaw/openclaw:${targetVersion}...`);
         try {
           await new Promise((resolve, reject) => {
             const pullProc = spawn('docker', ['pull', `ghcr.io/openclaw/openclaw:${targetVersion}`], { 
               stdio: 'ignore', 
               env: envWithPath 
             });
             pullProc.on('close', code => {
               if (code === 0) resolve();
               else reject(new Error('Docker pull exited with code ' + code));
             });
             pullProc.on('error', reject);
           });
           
           try {
               await new Promise((resolve) => {
                 const tagProc = spawn('docker', ['tag', `ghcr.io/openclaw/openclaw:${targetVersion}`, `ghcr.io/openclaw/openclaw:latest`], { 
                   stdio: 'ignore', 
                   env: envWithPath 
                 });
                 tagProc.on('close', () => resolve());
               });
           } catch(e) {}
           
           return { success: true, versionInstalled: targetVersion };
         } catch (err) {
           return { success: false, reason: 'Docker pull failed: ' + err.message };
         }
      }

      // 1. Snapshot current version
      let currentVersion = 'unknown';
      try {
        const { stdout } = await exec('openclaw --version', { shell: shellOpt, env: envWithPath });
        currentVersion = stdout.trim().match(/\d+\.\d+\.\d+(?:-\w+)?/)?.[0] || 'unknown';
      } catch (_) {}

      const isRollback = fs.existsSync(path.join(os.homedir(), '.openclaw', `.openclaw.backup_${targetVersion}.json`));

      // Backup current config before changing anything
      const openclawDir = path.join(os.homedir(), '.openclaw');
      const configFile = path.join(openclawDir, 'openclaw.json');
      if (fs.existsSync(configFile) && currentVersion !== 'unknown') {
        const backupPath = path.join(openclawDir, `.openclaw.backup_${currentVersion}.json`);
        fs.copyFileSync(configFile, backupPath);
        log.info(`[Updater] Created configuration checkpoint at ${backupPath}`);
      }

      // 2. Install
      log.info(`[Updater] Installing openclaw@${targetVersion}...`);
      await new Promise((resolve, reject) => {
        const installProcess = spawn('npm', ['install', '-g', `openclaw@${targetVersion}`], { shell: true, stdio: 'ignore', env: envWithPath });
        installProcess.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error('npm install exited with code ' + code));
        });
        installProcess.on('error', reject);
      });

      // 3. Health check — auto-rollback if new version is broken
      try {
        await exec('openclaw --version', { shell: shellOpt, env: envWithPath });
      } catch (_) {
        log.error('[Updater] Health check failed after installation! Rolling back binary...');
        if (currentVersion !== 'unknown') {
          await new Promise((resolve) => {
            const revertProc = spawn('npm', ['install', '-g', `openclaw@${currentVersion}`], { shell: true, stdio: 'ignore', env: envWithPath });
            revertProc.on('close', () => resolve());
            revertProc.on('error', () => resolve());
          });
        }
        return { success: false, reason: 'New version crashed on startup. Successfully auto-reverted binary.' };
      }

      // 4. Restore checkpoint for manual rollback scenarios
      if (isRollback) {
        const backupPath = path.join(openclawDir, `.openclaw.backup_${targetVersion}.json`);
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, configFile);
          log.info(`[Updater] Restored configuration checkpoint from ${backupPath}`);
        }
      }

      return { success: true, versionInstalled: targetVersion };
    } catch (err) {
      log.error('[Updater] Installation sequence failed:', err.message);
      return { success: false, reason: err.message };
    }
  });

  log.info('[openclawUpdater] IPC handlers registered.');
}

module.exports = { registerOpenclawUpdaterHandlers };
