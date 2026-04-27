/**
 * oauthHandler.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers OAuth2 PKCE flow IPC handlers:
 *   oauth-start    : Begins PKCE flow — opens browser, starts local callback server
 *   oauth-exchange : Manual fallback — exchanges authorization code from pasted URL
 */

const { ipcMain, shell } = require('electron');
const http   = require('http');
const crypto = require('crypto');
const log    = require('./logger');

// Session store: providerId → { codeVerifier, tokenUrl, clientId, redirectUri, state }
const _oauthSessions = new Map();

function registerOAuthHandlers() {
  // ── oauth-start ─────────────────────────────────────────────────────────────
  ipcMain.removeHandler('oauth-start');
  ipcMain.handle('oauth-start', async (event, { providerId, oauthConfig }) => {
    try {
      const codeVerifier  = crypto.randomBytes(32).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const state = crypto.randomBytes(16).toString('hex');

      const { authUrl, tokenUrl, clientId, clientSecret, redirectPort, redirectPath, redirectHost = 'localhost', scopes, extraParams } = oauthConfig;
      const redirectUri = `http://${redirectHost}:${redirectPort}${redirectPath}`;

      _oauthSessions.set(providerId, { codeVerifier, tokenUrl, clientId, clientSecret, redirectUri, state });

      const authParams = {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...(extraParams || {}),
        state,
      };
      const fullAuthUrl = `${authUrl}?${new URLSearchParams(authParams).toString()}`;

      let server  = null;
      let settled = false;

      const tokenPromise = new Promise((resolve, reject) => {
        server = http.createServer(async (req, res) => {
          const reqPath = req.url?.split('?')[0];

          if (reqPath !== redirectPath) { res.writeHead(204); res.end(); return; }
          if (settled) { res.writeHead(204); res.end(); return; }
          settled = true;

          try {
            const url       = new URL(`http://${redirectHost}:${redirectPort}${req.url}`);
            const code      = url.searchParams.get('code');
            const error     = url.searchParams.get('error');
            const errorDesc = url.searchParams.get('error_description');

            if (error) {
              const msg = `Authorization Error: ${error} - ${errorDesc}`;
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end(msg);
              return reject(new Error(msg));
            }

            const returnedState = url.searchParams.get('state');

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('Missing authorization code');
              return reject(new Error('No authorization code in callback URL'));
            }
            if (returnedState !== state) {
              res.writeHead(400, { 'Content-Type': 'text/plain' });
              res.end('State mismatch');
              return reject(new Error('State mismatch – possible CSRF attack'));
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:80px;background:#0a0a0a;color:#fff">
              <h2 style="color:#22c55e">✓ Authorization Successful</h2>
              <p style="color:#888">You can close this tab and return to ClawExpress.</p>
            </body></html>`);

            let tokenRes, tokens;
            
            if (oauthConfig.proxyExchangeUrl) {
              // Proxy exchange (e.g. through Cloudflare to protect client_secret)
              tokenRes = await fetch(oauthConfig.proxyExchangeUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, redirect_uri: redirectUri, code_verifier: codeVerifier }),
              });
              tokens = await tokenRes.json();
            } else {
              // Direct local exchange
              tokenRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                  grant_type:    'authorization_code',
                  code,
                  redirect_uri:  redirectUri,
                  client_id:     clientId,
                  code_verifier: codeVerifier,
                  ...(clientSecret ? { client_secret: clientSecret } : {})
                }).toString(),
              });
              tokens = await tokenRes.json();
            }

            log.info('[OAuth] Token response:', JSON.stringify(tokens).slice(0, 200));
            if (!tokenRes.ok) return reject(new Error(tokens.error_description || tokens.error || `Token exchange failed (HTTP ${tokenRes.status})`));
            resolve({ tokens });
          } catch (e) {
            reject(e);
          } finally {
            _oauthSessions.delete(providerId);
            if (server) server.close();
          }
        });

        server.listen(redirectPort, redirectHost === 'localhost' ? '127.0.0.1' : redirectHost, () => {
          log.info(`[OAuth] Callback server on ${redirectHost}:${redirectPort}${redirectPath}`);
        });
        server.on('error', (e) => reject(new Error(`Port ${redirectPort} unavailable: ${e.message}`)));
        // 5-minute timeout
        setTimeout(() => {
          if (!settled) { server.close(); reject(new Error('OAuth timeout – no callback received within 5 minutes')); }
        }, 5 * 60 * 1000);
      });

      shell.openExternal(fullAuthUrl);
      log.info(`[OAuth] Browser opened for ${providerId}: ${fullAuthUrl.slice(0, 120)}...`);

      tokenPromise
        .then((result) => {
          log.info(`[OAuth] Token exchange success for ${providerId}`);
          event.sender.send('oauth-token-received', { providerId, ...result });
        })
        .catch((err) => {
          log.error(`[OAuth] Token exchange failed for ${providerId}: ${err.message}`);
          event.sender.send('oauth-token-received', { providerId, error: err.message });
        });

      return { success: true, authUrl: fullAuthUrl, redirectUri };
    } catch (err) {
      log.error('[OAuth] oauth-start failed:', err.message);
      return { success: false, message: err.message };
    }
  });

  // ── oauth-exchange (manual fallback) ─────────────────────────────────────
  ipcMain.removeHandler('oauth-exchange');
  ipcMain.handle('oauth-exchange', async (event, { callbackUrl, providerId }) => {
    try {
      const session = _oauthSessions.get(providerId);
      if (!session) return { success: false, message: 'Session expired — please click "Connect with..." again to restart OAuth.' };

      const { codeVerifier, tokenUrl, clientId, clientSecret, redirectUri } = session;
      const url  = new URL(callbackUrl.trim());
      const code = url.searchParams.get('code');
      if (!code) return { success: false, message: 'No authorization code found in the pasted URL. Make sure you copy the full redirect URL.' };

      const tokenRes = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          redirect_uri:  redirectUri,
          client_id:     clientId,
          code_verifier: codeVerifier,
          ...(clientSecret ? { client_secret: clientSecret } : {})
        }).toString(),
      });
      const tokens = await tokenRes.json();
      log.info('[OAuth] Manual exchange response:', JSON.stringify(tokens).slice(0, 200));
      if (!tokenRes.ok) return { success: false, message: tokens.error_description || tokens.error || `HTTP ${tokenRes.status}` };
      _oauthSessions.delete(providerId);
      return { success: true, tokens };
    } catch (err) {
      return { success: false, message: err.message };
    }
  });

  log.info('[oauthHandler] IPC handlers registered.');
}

module.exports = { registerOAuthHandlers };
