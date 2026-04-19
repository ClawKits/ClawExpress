/**
 * adapter.interface.js
 * ─────────────────────────────────────────────────────────────────────────────
 * JSDoc definitions for the Platform Adapter contract.
 * Each platform adapter must implement these methods.
 */

/**
 * @typedef {Object} PlatformAdapter
 * @property {string}   id                  - Platform ID (e.g. 'openclaw', 'openfang')
 * @property {string[]} aliases             - Other IDs that map to this adapter
 *
 * @property {Function} readConfig          - ({ cwd }) => { success, env, model, channels }
 * @property {Function} writeConfig         - ({ cwd, env, envToRemove, model, model_display, customProxyTarget, channelConfig }) => { success }
 * @property {Function} readRawConfig       - () => { success, text, language }
 * @property {Function} writeRawConfig      - ({ rawJson, rawToml, text }) => { success }
 * @property {Function} getRawConfigHistory - () => { success, history }
 * @property {Function} restoreRawConfig    - ({ filename }) => { success, text }
 *
 * @property {Function} channelCheckLinked  - ({ channel }) => { linked, phone, message }
 * @property {Function} channelLogin        - ({ channel, platformId, platformConfig, event }) => { success, reason }
 * @property {Function} channelLogout       - ({ channel }) => { success, output }
 * @property {Function} channelLoginSuccess - ({ channel }) => { success, error }
 *
 * @property {Function} finalizeConfig      - (config, writeDir, sendLog) => void
 */

module.exports = {};
