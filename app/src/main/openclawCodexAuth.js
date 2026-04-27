const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENAI_CODEX_PROVIDER_ID = 'openai-codex';
const OPENAI_CODEX_DEFAULT_PROFILE_ID = 'openai-codex:default';

function decodeJwtPayload(token) {
  try {
    const payload = String(token || '').split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

function normalizeEpochMs(value) {
  if (!Number.isFinite(value)) return undefined;
  return value > 1e12 ? value : value * 1000;
}

function resolveCodexIdentity(accessToken) {
  const claims = decodeJwtPayload(accessToken) || {};
  const profile = claims['https://api.openai.com/profile'];
  const auth = claims['https://api.openai.com/auth'];
  return {
    email: typeof profile?.email === 'string' ? profile.email : undefined,
    displayName: typeof profile?.name === 'string' ? profile.name : undefined,
    accountId: typeof auth?.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined,
  };
}

function buildCodexCredentialFromTokens(tokens) {
  if (!tokens || typeof tokens !== 'object') return null;
  const access = tokens.access || tokens.access_token || tokens.token;
  const refresh = tokens.refresh || tokens.refresh_token;
  if (!access || typeof access !== 'string') return null;

  const identity = resolveCodexIdentity(access);
  const expires = normalizeEpochMs(tokens.expires)
    ?? normalizeEpochMs(tokens.expires_at)
    ?? normalizeEpochMs(tokens.exp)
    ?? (Number.isFinite(tokens.expires_in) ? Date.now() + tokens.expires_in * 1000 : undefined)
    ?? normalizeEpochMs(decodeJwtPayload(access)?.exp);

  if (!refresh) {
    return {
      type: 'token',
      provider: OPENAI_CODEX_PROVIDER_ID,
      token: access,
      ...(expires ? { expires } : {}),
      ...(identity.email ? { email: identity.email } : {}),
    };
  }

  return {
    type: 'oauth',
    provider: OPENAI_CODEX_PROVIDER_ID,
    access,
    refresh,
    ...(expires ? { expires } : {}),
    ...(tokens.account_id || identity.accountId ? { accountId: tokens.account_id || identity.accountId } : {}),
    ...(identity.email ? { email: identity.email } : {}),
    ...(identity.displayName ? { displayName: identity.displayName } : {}),
  };
}

function readCodexCliCredential() {
  try {
    const codexHome = process.env.CODEX_HOME
      ? path.resolve(process.env.CODEX_HOME.replace(/^~(?=$|[\\/])/, os.homedir()))
      : path.join(os.homedir(), '.codex');
    const authPath = path.join(codexHome, 'auth.json');
    if (!fs.existsSync(authPath)) return null;
    const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
    if (auth.auth_mode && auth.auth_mode !== 'chatgpt') return null;
    return buildCodexCredentialFromTokens(auth.tokens || auth);
  } catch (_) {
    return null;
  }
}

function upsertCodexAuthProfile(openclawDir, credential) {
  if (!credential) return false;
  const agentDir = path.join(openclawDir, 'agents', 'main', 'agent');
  const authPath = path.join(agentDir, 'auth-profiles.json');
  fs.mkdirSync(agentDir, { recursive: true });

  let store = { version: 1, profiles: {} };
  try {
    if (fs.existsSync(authPath)) {
      const existing = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (existing && typeof existing === 'object') {
        store = {
          version: Number(existing.version || 1),
          profiles: existing.profiles && typeof existing.profiles === 'object' ? existing.profiles : {},
        };
      }
    }
  } catch (_) {}

  store.profiles[OPENAI_CODEX_DEFAULT_PROFILE_ID] = credential;
  fs.writeFileSync(authPath, JSON.stringify(store, null, 2), 'utf8');
  return true;
}

function syncCodexAuthProfile(openclawDir, env = {}, oauthTokens) {
  const agentDir = path.join(openclawDir, 'agents', 'main', 'agent');
  const authPath = path.join(agentDir, 'auth-profiles.json');
  fs.mkdirSync(agentDir, { recursive: true });

  let store = { version: 1, profiles: {} };
  try {
    if (fs.existsSync(authPath)) {
      const existing = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (existing && typeof existing === 'object') {
        store.version = Number(existing.version || 1);
        store.profiles = existing.profiles && typeof existing.profiles === 'object' ? existing.profiles : {};
      }
    }
  } catch (_) {}

  // 1. Sync Codex
  if (env.CLAWEXPRESS_PROVIDER === 'codex') {
    const codexCred = buildCodexCredentialFromTokens(oauthTokens)
      || readCodexCliCredential()
      || buildCodexCredentialFromTokens({ access: env.OPENAI_CODEX_API_KEY });
    if (codexCred) store.profiles[OPENAI_CODEX_DEFAULT_PROFILE_ID] = codexCred;
  }

  // 2. Sync ClawExpress connections.json
  try {
    const { app } = require('electron');
    const connectionsPath = path.join(app.getPath('userData'), 'connections.json');
    if (fs.existsSync(connectionsPath)) {
      const connections = JSON.parse(fs.readFileSync(connectionsPath, 'utf8'));
      
      const providerMap = {
        'cli_gemini': 'google',
        'google': 'google',
        'openai': 'openai',
        'anthropic': 'anthropic',
        'deepseek': 'deepseek',
        'openrouter': 'openrouter',
        'xai': 'xai',
        'nvidia': 'nvidia_nim',
        'together': 'together_ai',
        'groq': 'groq',
        'moonshot': 'moonshot',
        'mistral': 'mistral',
        'qwen': 'qwen'
      };

      for (const cx of connections) {
        if (!cx.providerId || !cx.apiKey) continue;
        const openclawProvider = providerMap[cx.providerId];
        if (!openclawProvider) continue;
        
        let tokenStr = cx.apiKey;
        // Parse Gemini OAuth token
        if (tokenStr.startsWith('{')) {
          try {
            const parsed = JSON.parse(tokenStr);
            tokenStr = parsed.access_token || parsed.token || tokenStr;
          } catch(e) {}
        }
        
        const profileId = `${openclawProvider}:default`;
        // For Gemini CLI OAuth tokens (ya29.*), write as type 'oauth' with 'access' field
        // OpenClaw's schema strictly requires refresh, expires, and accountId for OAuth profiles
        if (openclawProvider === 'google' && cx.providerId === 'cli_gemini') {
          store.profiles[profileId] = {
            type: 'oauth',
            provider: openclawProvider,
            access: tokenStr,
            refresh: cx.oauthTokens?.refresh_token || 'dummy',
            expires: cx.oauthTokens?.expires_in ? Date.now() + (cx.oauthTokens.expires_in * 1000) : 9999999999999,
            accountId: 'dummy'
          };
        } else {
          store.profiles[profileId] = {
            type: 'token',
            provider: openclawProvider,
            token: tokenStr
          };
        }
      }
    }
  } catch (_) {}

  fs.writeFileSync(authPath, JSON.stringify(store, null, 2), 'utf8');
  return true;
}

module.exports = {
  syncCodexAuthProfile,
  buildCodexCredentialFromTokens,
};
