/**
 * runners/default.runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generic fallback runner for any app that does NOT have a dedicated runner.
 * Uses config.port for readiness polling — no app-specific stdout patterns.
 *
 * Adding a dedicated runner for a new app:
 *   1. Create runners/<appName>.runner.js implementing the runner interface:
 *        detectReadiness(text, config) → { dashboardUrl } | null
 *        getFallbackPollerConfig(config) → { port, requireToken, readToken }
 *        prepareDockerScript(scriptArr, config, containerName) → scriptArr
 *        prepareNpmScript(scriptArr) → scriptArr
 *   2. Register it in processManager.js resolveRunner().
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { startReadyPoller } = require('./shared');

/**
 * Prepare Docker scriptArr: only inject --name.
 * Port mapping is left as-is from the startScript (use a dedicated runner
 * if you need port-sync or other Docker customisation).
 */
function prepareDockerScript(scriptArr, config, containerName) {
  const runIndex = scriptArr.indexOf('run');
  if (runIndex !== -1 && !scriptArr.includes('--name')) {
    scriptArr.splice(runIndex + 1, 0, '--name', containerName);
  }
  return scriptArr;
}

/**
 * NPM fallback: use existing script or default to `npm start`.
 */
function prepareNpmScript(scriptArr) {
  if (scriptArr.length === 0) return ['npm', 'start'];
  return scriptArr;
}

/**
 * Generic readiness detection: no app-specific stdout patterns.
 * Always returns null — falls back to HTTP polling via getFallbackPollerConfig.
 * Override in a dedicated runner if the app emits a known ready string.
 */
function detectReadiness(_text, _config) {
  return null;
}

/**
 * Fallback HTTP poller using config.port (or 3000 if not set).
 */
function getFallbackPollerConfig(config) {
  return {
    port:         config.port || 3000,
    requireToken: false,
    readToken:    null,
  };
}

module.exports = {
  prepareDockerScript,
  prepareNpmScript,
  startReadyPoller,
  detectReadiness,
  getFallbackPollerConfig,
};
