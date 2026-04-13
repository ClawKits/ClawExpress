/**
 * authHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers all authentication-related IPC handlers:
 *   - open-auth-window  : Spawns a local HTTP server to catch the OAuth callback
 *   - auth-get-token    : Reads session token from disk (userData/session.json)
 *   - auth-set-token    : Writes session token to disk
 *   - auth-clear-token  : Deletes session token from disk
 */

const { ipcMain, shell } = require('electron');
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { app } = require('electron');
const log  = require('./logger');

// ── Session token path ────────────────────────────────────────────────────────
function getSessionPath() {
  return path.join(app.getPath('userData'), 'session.json');
}

// ── Module-level server ref — ensures port 4012 is always cleanly released ───
let _authServer = null;

function destroyAuthServer() {
  if (_authServer) {
    try {
      if (typeof _authServer.closeAllConnections === 'function') {
        _authServer.closeAllConnections();
      }
      _authServer.close();
    } catch (_) {}
    _authServer = null;
  }
}

function registerAuthHandlers() {
  // ── open-auth-window ────────────────────────────────────────────────────────
  ipcMain.handle('open-auth-window', async (event, { authUrl, openBrowser = true }) => {
    destroyAuthServer();

    return new Promise((resolve) => {
      let settled = false;

      const settle = (result) => {
        if (settled) return;
        settled = true;
        
        // Delay server destruction by a few seconds so the browser has enough time 
        // to receive the HTTP response. closeAllConnections() instantly severs the socket!
        setTimeout(() => destroyAuthServer(), 3000);
        
        resolve(result);
      };

      const makeServer = () => http.createServer((req, res) => {
        if (req.url.startsWith('/callback-process')) {
          const urlObj = new URL(req.url, 'http://127.0.0.1:4012');
          const code     = urlObj.searchParams.get('id_token') || urlObj.searchParams.get('access_token') || urlObj.searchParams.get('code');
          const errParam = urlObj.searchParams.get('error');

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));

          if (code) {
            settle({ success: true, code });
          } else {
            settle({ success: false, reason: errParam || 'No token/code returned' });
          }
          return;
        }

        if (req.url.startsWith('/callback')) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <script>
              // Extract both search ?query and hash #fragment
              const search = window.location.search || '';
              const hash = window.location.hash ? window.location.hash.substring(1) : '';
              
              // Combine them so we can fetch callback-process
              const query = (search ? search + (hash ? '&' + hash : '') : (hash ? '?' + hash : ''));
              
              fetch('/callback-process' + query).then(() => {
                 document.body.innerHTML = '<div style="font-family: sans-serif; text-align: center; margin-top: 50px;"><h2>Please return to ClawExpress</h2><p>Authentication successful. You can close this tab now.</p></div>';
                 setTimeout(() => window.close(), 1000);
              }).catch(() => {
                 document.body.innerHTML = '<div style="color: red; text-align: center; margin-top: 50px;">Error parsing token.</div>';
              });
            </script>
            <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">Processing login...</div>
          `);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      const server = makeServer();
      _authServer = server;

      server.on('error', (e) => {
        if (e.code === 'EADDRINUSE') {
          setTimeout(() => {
            destroyAuthServer();
            const retryServer = makeServer();
            _authServer = retryServer;
            retryServer.on('error', (e2) => settle({ success: false, reason: e2.message }));
            retryServer.listen(4012, '127.0.0.1', () => {
              if (openBrowser) shell.openExternal(authUrl);
            });
          }, 500);
        } else {
          settle({ success: false, reason: e.message });
        }
      });

      server.listen(4012, '127.0.0.1', () => {
        if (openBrowser) shell.openExternal(authUrl);
      });

      // 2-minute timeout
      setTimeout(() => {
        settle({ success: false, reason: 'Timeout waiting for authentication' });
      }, 120_000);
    });
  });

  // ── Native session token storage (disk-based) ─────────────────────────────
  // Persists auth session token to userData/session.json.
  // Survives Electron restarts in both dev and production, unlike localStorage.

  ipcMain.handle('auth-get-token', () => {
    try {
      const p = getSessionPath();
      if (!fs.existsSync(p)) return null;
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      return data.sessionToken || null;
    } catch (_) {
      return null;
    }
  });

  ipcMain.handle('auth-set-token', (_, { token }) => {
    try {
      fs.writeFileSync(getSessionPath(), JSON.stringify({ sessionToken: token }), 'utf8');
      return { success: true };
    } catch (err) {
      log.error('[Auth] Failed to write session token:', err.message);
      return { success: false };
    }
  });

  ipcMain.handle('auth-clear-token', () => {
    try {
      const p = getSessionPath();
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { success: true };
    } catch (_) {
      return { success: false };
    }
  });

  log.info('[authHandler] IPC handlers registered.');
}

module.exports = { registerAuthHandlers };
