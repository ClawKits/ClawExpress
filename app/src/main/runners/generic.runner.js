/**
 * generic.runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manifest-driven runner for platforms that do not need custom spawn logic.
 * Reads manifest.install and manifest.readiness to determine how to
 * prepare scripts and detect readiness — no platform-specific hard-coding.
 *
 * Routing: processManager uses this runner for all manifest-backed platforms
 * (hermes and any future manifest platform). Only openclaw and openfang still
 * use dedicated runners due to legacy commit/bridge patterns.
 */

const { startReadyPoller } = require('./shared');
const { getManifest }      = require('../manifestRegistry');

function resolveManifest(config) {
  const id = config?.registryId || config?.id || '';
  return getManifest(id.toLowerCase());
}

// ── prepareDockerScript ───────────────────────────────────────────────────────
// For compose-type installs (e.g. Hermes): the script is already correct as-is.
// For single-container `docker run`: inject --name, --init, and port mapping.

// Injects --project-name after 'compose' so all containers are grouped as
// "<id>-clawexpress-<service>-<index>" rather than the bare directory name.
function composeProjectName(config) {
  const id = config?.registryId || config?.id || '';
  return `${id}-clawexpress`;
}

function injectProjectName(scriptArr, projectName) {
  const arr = [...scriptArr];
  const composeIdx = arr.indexOf('compose');
  if (composeIdx !== -1) arr.splice(composeIdx + 1, 0, '--project-name', projectName);
  return arr;
}

function prepareDockerScript(scriptArr, config, containerName) {
  const manifest = resolveManifest(config);
  if (manifest?.install?.docker?.type === 'compose') {
    return injectProjectName(scriptArr, composeProjectName(config));
  }

  const arr  = [...scriptArr];

  // Strip --env-file <path> pairs when the referenced file doesn't exist
  // (prevents Docker errors on first run before config is written).
  const fs = require('fs');
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] === '--env-file' && arr[i + 1] && !fs.existsSync(arr[i + 1])) {
      arr.splice(i, 2);
    }
  }

  const port = config.port;
  const runIdx = arr.indexOf('run');
  if (runIdx !== -1) {
    const inject = ['--name', containerName];
    if (!arr.includes('--init')) inject.push('--init');
    if (port && manifest?.port !== null && !arr.includes('-p')) {
      inject.push('-p', `${port}:${port}`);
    }
    arr.splice(runIdx + 1, 0, ...inject);
  }
  return arr;
}

function prepareNpmScript(scriptArr) {
  return scriptArr.length === 0 ? ['npm', 'start'] : scriptArr;
}

// ── detectReadiness ───────────────────────────────────────────────────────────
// Checks stdout/stderr text against manifest.readiness.logPatterns.

function detectReadiness(text, config) {
  const manifest = resolveManifest(config);
  const port     = config.port || manifest?.readiness?.http?.port || 3000;
  for (const pattern of (manifest?.readiness?.logPatterns || [])) {
    if (new RegExp(pattern, 'i').test(text)) {
      return { dashboardUrl: `http://127.0.0.1:${port}/` };
    }
  }
  return null;
}

// ── getFallbackPollerConfig ───────────────────────────────────────────────────

function getFallbackPollerConfig(config) {
  const manifest = resolveManifest(config);
  return {
    port:         config.port || manifest?.readiness?.http?.port || 3000,
    requireToken: false,
    readToken:    null,
  };
}

module.exports = {
  prepareDockerScript,
  prepareNpmScript,
  detectReadiness,
  getFallbackPollerConfig,
  startReadyPoller,
  composeProjectName,
  injectProjectName,
};
