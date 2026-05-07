/**
 * manifestRegistry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Loads platform manifests with two source modes:
 *
 *   local  — reads bundled manifests from app/src/manifests/ (fast, offline)
 *   remote — fetches from Cloudflare, caches to userData/manifests/
 *
 * Source selection (priority order):
 *   1. Env var:   CLAWEXPRESS_MANIFEST_SOURCE=local|remote
 *   2. Auto:      remote when app.isPackaged (production build)
 *                 local  when !app.isPackaged (dev / unpackaged)
 *
 * Dev workflow:
 *   Just run the app normally — it auto-selects local.
 *   To test remote mode in dev: set CLAWEXPRESS_MANIFEST_SOURCE=remote
 */

const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const log     = require('./logger');

// ── Source detection ──────────────────────────────────────────────────────────

function detectSource() {
  if (process.env.CLAWEXPRESS_MANIFEST_SOURCE === 'local')  return 'local';
  if (process.env.CLAWEXPRESS_MANIFEST_SOURCE === 'remote') return 'remote';
  try {
    return require('electron').app?.isPackaged ? 'remote' : 'local';
  } catch {
    return 'local';
  }
}

// Evaluated once at require-time so the source stays stable for the app lifetime.
const SOURCE = detectSource();

// ── Paths ─────────────────────────────────────────────────────────────────────

// app.getAppPath() returns the project root (e.g. app/) in both dev (vite compiles
// main to dist-electron/main/, making __dirname wrong) and production (asar).
function getBundledDir() {
  try { return path.join(require('electron').app.getAppPath(), 'src', 'manifests'); } catch (_) {}
  return path.join(__dirname, '../manifests'); // fallback for unit tests
}

const BUNDLED_DIR  = getBundledDir();
const REMOTE_BASE  = 'https://clawexpress-registry.pages.dev';

function getUserDataDir() {
  try { return require('electron').app.getPath('userData'); } catch { return null; }
}

function getCacheDir() {
  const base = getUserDataDir();
  return base ? path.join(base, 'manifests') : null;
}

// ── In-memory cache ───────────────────────────────────────────────────────────

const memCache = new Map();

// ── Local loader (Phase 1 — default dev path) ─────────────────────────────────

function loadAllLocal() {
  if (!fs.existsSync(BUNDLED_DIR)) return;
  for (const file of fs.readdirSync(BUNDLED_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const m = JSON.parse(fs.readFileSync(path.join(BUNDLED_DIR, file), 'utf8'));
      if (m.id) memCache.set(m.id.toLowerCase(), m);
    } catch (_) {}
  }
}

// ── Remote fetch helpers (Phase 2 — production path) ─────────────────────────

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function fetchFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => { file.close(); reject(err); });
  });
}

// ── Remote manifest load + disk cache ────────────────────────────────────────

async function loadRemote(id) {
  const cacheDir = getCacheDir();
  const cacheFile = cacheDir ? path.join(cacheDir, `${id}.json`) : null;

  // 1. Try fetching fresh from Cloudflare
  try {
    const url = `${REMOTE_BASE}/manifests/${id}.json`;
    const manifest = await fetchJson(url);
    if (manifest?.id) {
      memCache.set(id, manifest);
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(manifest, null, 2), 'utf8');
      }
      return manifest;
    }
  } catch (err) {
    log.warn(`[manifestRegistry] Remote fetch failed for "${id}": ${err.message}`);
  }

  // 2. Fall back to disk cache (offline)
  if (cacheFile && fs.existsSync(cacheFile)) {
    try {
      const m = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      if (m?.id) { memCache.set(id, m); return m; }
    } catch (_) {}
  }

  // 3. Final fallback: bundled local manifest (always available)
  const bundledFile = path.join(BUNDLED_DIR, `${id}.json`);
  if (fs.existsSync(bundledFile)) {
    try {
      const m = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
      if (m?.id) { memCache.set(id, m); return m; }
    } catch (_) {}
  }

  return null;
}

// ── Template files ────────────────────────────────────────────────────────────

/**
 * Returns the directory where template files (e.g. docker-compose.yml) live.
 * local  → bundled app/src/manifests/templates/{id}/
 * remote → userData/manifests/templates/{id}/  (downloaded via ensureTemplates)
 */
function getTemplatesDir(id) {
  if (SOURCE === 'remote') {
    const cacheDir = getCacheDir();
    if (cacheDir) return path.join(cacheDir, 'templates', id);
  }
  return path.join(BUNDLED_DIR, 'templates', id);
}

/**
 * Downloads template files declared in the manifest into the cache dir.
 * Called by platformInstaller before install so generic.adapter can copy them.
 * No-op in local mode (files are already bundled).
 */
async function ensureTemplates(manifest) {
  if (SOURCE !== 'remote') return;
  const templateFiles = manifest?.install?.docker?.templateFiles || [];
  if (!templateFiles.length) return;

  const destDir = getTemplatesDir(manifest.id);
  fs.mkdirSync(destDir, { recursive: true });

  for (const file of templateFiles) {
    const destPath = path.join(destDir, file);
    if (fs.existsSync(destPath)) continue;  // already cached
    const url = `${REMOTE_BASE}/manifests/templates/${manifest.id}/${file}`;
    try {
      await fetchFile(url, destPath);
      log.info(`[manifestRegistry] Cached template: ${file} for ${manifest.id}`);
    } catch (err) {
      log.warn(`[manifestRegistry] Failed to fetch template "${file}": ${err.message}`);
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Sync lookup — returns cached manifest or null.
 * In local mode, loads all bundled manifests on first call.
 * In remote mode, only returns what is already in memCache (pre-fetched via
 * fetchManifest). Callers that need an async guarantee use fetchManifest().
 */
function getManifest(id) {
  const key = (id || '').toLowerCase();

  if (SOURCE === 'local') {
    const bundledFile = path.join(BUNDLED_DIR, `${key}.json`);
    if (fs.existsSync(bundledFile)) {
      try {
        const m = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
        if (m?.id) { memCache.set(key, m); return m; }
      } catch (_) {}
    }
    return null;
  }

  if (memCache.has(key)) return memCache.get(key);

  // Remote: attempt a synchronous fallback from bundled dir so sync callers
  // (e.g. resolveRunner at spawn-time) always get something sensible.
  const bundledFile = path.join(BUNDLED_DIR, `${key}.json`);
  if (fs.existsSync(bundledFile)) {
    try {
      const m = JSON.parse(fs.readFileSync(bundledFile, 'utf8'));
      if (m?.id) { memCache.set(key, m); return m; }
    } catch (_) {}
  }

  return null;
}

/**
 * Async fetch — ensures the latest manifest is in cache, then returns it.
 * Use this before install so the manifest + templates are up-to-date.
 */
async function fetchManifest(id) {
  const key = (id || '').toLowerCase();
  if (SOURCE === 'local') return getManifest(key);
  return loadRemote(key);
}

log.info(`[manifestRegistry] source=${SOURCE}, bundledDir=${BUNDLED_DIR}`);

// ── Dir resolution ────────────────────────────────────────────────────────────

/**
 * Resolves the canonical working directory (cwd) for a platform.
 *
 * manifest.dirs.cwd values:
 *   "userData"   → <userData>/platforms/<id>/   (ClawExpress manages it)
 *   "~/.{id}"    → path.join(homedir, '.' + id) (App manages its own dir)
 *   "~/.foo"     → path.join(homedir, '.foo')   (explicit home-relative)
 *   "/abs/path"  → absolute path as-is
 *
 * @param {object} manifest
 * @param {string} userDataPath  — app.getPath('userData')
 * @returns {string}             — resolved absolute path
 */
function resolveCwd(manifest, userDataPath) {
  const cwdSpec = manifest?.dirs?.cwd || 'userData';
  const os = require('os');

  if (cwdSpec === 'userData') {
    return require('path').join(userDataPath, 'platforms', manifest.id);
  }

  if (cwdSpec.startsWith('~/')) {
    const rel = cwdSpec
      .slice(2)
      .replace(/\{id\}/g, manifest.id);
    return require('path').join(os.homedir(), rel);
  }

  if (cwdSpec.startsWith('/') || /^[A-Za-z]:[\\/]/.test(cwdSpec)) {
    return cwdSpec; // absolute path
  }

  // fallback
  return require('path').join(userDataPath, 'platforms', manifest.id);
}

/**
 * Returns the list of host directories to delete when the user wipes a platform.
 * Resolves "~/.{id}" style tokens.
 */
function resolveWipeDirs(manifest) {
  const os = require('os');
  return (manifest?.dirs?.wipeOnUninstall || []).map(spec =>
    spec.startsWith('~/') ? require('path').join(os.homedir(), spec.slice(2).replace(/\{id\}/g, manifest.id)) : spec
  );
}

/**
 * Returns the docker volume names declared by the manifest (informational).
 */
function resolveVolumes(manifest) {
  return manifest?.dirs?.volumes || [];
}

module.exports = { SOURCE, getManifest, fetchManifest, getTemplatesDir, ensureTemplates, resolveCwd, resolveWipeDirs, resolveVolumes };
