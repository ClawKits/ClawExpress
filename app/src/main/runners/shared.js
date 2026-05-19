/**
 * runners/shared.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared utilities for all platform runners.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { spawn }              = require('child_process');
const http                   = require('http');
const { BrowserWindow }      = require('electron');

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

/**
 * Poll HTTP until the platform is reachable, then emit `platform-ready`.
 *
 * @param {object} opts
 * @param {string}  opts.platformId
 * @param {boolean} opts.requireToken  – true for OpenClaw (must read auth token)
 * @param {Function} opts.readToken    – async fn that returns the token string or null
 * @param {number}  opts.port
 * @param {Function} opts.sendLog
 * @param {number}  [opts.maxRetries=45]
 * @param {number}  [opts.intervalMs=1500]
 */
function startReadyPoller({ platformId, requireToken = false, readToken, port, sendLog, maxRetries = 45, intervalMs = 1500 }) {
  let attempts = 0;

  // After this many attempts without a token, probe the HTTP endpoint
  // anyway — the gateway may have started with auth disabled or the
  // token file hasn't been flushed to the host mount yet (common after
  // Docker image upgrades).
  const TOKEN_GRACE_ATTEMPTS = 15;

  const notifyReady = (token) => {
    const dashboardUrl = token ? `http://127.0.0.1:${port}/?token=${token}` : `http://127.0.0.1:${port}/`;
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

    let token = null;
    if (requireToken) {
      token = readToken ? readToken() : null;
      if (!token && attempts < TOKEN_GRACE_ATTEMPTS) {
        // Token not written yet — retry after a short delay.
        setTimeout(poll, intervalMs);
        return;
      }
      // After grace period, probe HTTP anyway even without token.
      // The gateway may have generated its token by the time we connect.
      if (!token && attempts === TOKEN_GRACE_ATTEMPTS) {
        sendLog('[SYSTEM] Auth token not found in config yet — probing gateway anyway...');
      }
    }

    let settled = false;
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      if (settled) return;
      settled = true;
      // Re-read token one last time — it may have appeared between poll start and response
      if (requireToken && !token) {
        token = readToken ? readToken() : null;
      }
      notifyReady(token);
    });
    req.on('error', () => {
      if (settled) return;
      settled = true;
      setTimeout(poll, intervalMs);
    });
    req.setTimeout(1200, () => {
      if (settled) return;
      settled = true;
      req.destroy();
      setTimeout(poll, intervalMs);
    });
  };

  poll();
}

module.exports = { fireSpawn, startReadyPoller };
