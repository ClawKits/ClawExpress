/**
 * platformRegistry.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registry for platform adapters. Adapters provide platform-specific configuration
 * and connection logic.
 */

const adapters = new Map();

function register(adapter) {
  adapters.set(adapter.id, adapter);
  if (adapter.aliases && Array.isArray(adapter.aliases)) {
    adapter.aliases.forEach(a => adapters.set(a, adapter));
  }
}

function getAdapter(platformId) {
  const id = (platformId || '').toLowerCase();
  return adapters.get(id) || adapters.get('openclaw'); // default fallback
}

// Auto-register currently available adapters
require('./platform-adapters/openclaw.adapter').register(register);
require('./platform-adapters/openfang.adapter').register(register);

module.exports = {
  register,
  getAdapter
};
