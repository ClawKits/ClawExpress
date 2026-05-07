/**
 * platformRegistry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registry for platform adapters.
 *
 * Resolution order for getAdapter(id):
 *   1. Explicitly registered override adapters (openclaw, openfang)
 *   2. Manifest-backed generic adapter (hermes + any future manifest platform)
 *   3. Fallback: openclaw adapter
 */

const { getManifest }          = require('./manifestRegistry');
const { createGenericAdapter } = require('./platform-adapters/generic.adapter');

const adapters = new Map();

function register(adapter) {
  adapters.set(adapter.id, adapter);
  if (adapter.aliases && Array.isArray(adapter.aliases)) {
    adapter.aliases.forEach(a => adapters.set(a, adapter));
  }
}

function getAdapter(platformId) {
  const id = (platformId || '').toLowerCase();

  // 1. Override adapters (complex platforms with custom logic)
  if (adapters.has(id)) return adapters.get(id);

  // 2. Manifest-backed generic adapter
  const manifest = getManifest(id);
  if (manifest) return createGenericAdapter(manifest);

  // 3. Fallback
  return adapters.get('openclaw');
}

// Register override adapters (platforms with custom logic beyond what generic.adapter provides)
require('./platform-adapters/openclaw.adapter').register(register);
require('./platform-adapters/openfang.adapter').register(register);
// hermes: fully manifest-driven — uses generic.adapter with yaml/llm-provider-env/defaults

module.exports = {
  register,
  getAdapter
};
