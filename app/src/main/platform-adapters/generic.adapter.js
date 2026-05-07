/**
 * generic.adapter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Manifest-driven adapter. Reads manifest.configFiles to determine which files
 * to generate at install time (finalizeConfig), and to read/write at runtime
 * (readConfig / writeConfig).
 *
 * Supported configFile types:
 *   template  — copy bundled/cached template file as-is (no field mapping)
 *   dotenv    — KEY=VALUE pairs written to a .env file
 *   json      — JSON file; mappings can target nested paths or named sections
 *   toml      — TOML file; mappings target [section] tables
 *   yaml      — YAML file; generated from mappings (llm-model-config, etc.)
 *
 * Mapping entry shapes:
 *   { field, type: "llm-provider-key" }          → resolves provider envKey from PROVIDERS[]
 *   { field, type: "llm-provider-env", providerMap } → provider-specific env vars (with $key interpolation)
 *   { field, type: "llm-model-config", yamlPath, providerMap } → YAML model config from provider selection
 *   { field, type: "llm-meta", section }          → writes { connectionId, provider, model } into a JSON section
 *   { field, envKey }                             → direct field value → dotenv key
 *   { field, path: "a.b.c" }                      → set nested path in JSON object
 *   { field, section, key }                        → set key inside a TOML/JSON [section]
 *
 * dotenv-specific features:
 *   "defaults": { KEY: value }                    → static env vars always written
 */

const fs   = require('fs');
const path = require('path');
const log  = require('../logger');
const { getManifest, getTemplatesDir } = require('../manifestRegistry');

// ── LLM key resolver ──────────────────────────────────────────────────────────

function resolveLlmEnv(llmConfig) {
  const env = {};
  if (!llmConfig?.provider || !llmConfig?.key) return env;
  const { PROVIDERS, PROVIDER_CATEGORIES } = require('../../constants/providers');
  const provider = PROVIDERS.find(p => p.id === llmConfig.provider);
  if (provider && provider.category !== PROVIDER_CATEGORIES.CLI) {
    env[provider.envKey] = llmConfig.key;
    if (llmConfig.baseUrl) {
      const baseUrlKey = provider.envKey.replace(/(_API_KEY|_TOKEN|_KEY)$/, '_BASE_URL');
      env[baseUrlKey] = llmConfig.baseUrl;
    }
  }
  return env;
}

// ── Provider metadata resolver (connection hub) ──────────────────────────────
// Auto-derives model name, base_url, and provider type from providers.js.
// Manifest only needs to declare exceptions (providerTypeOverrides) instead
// of hardcoding every provider's details.

function resolveProviderMeta(providerId) {
  const { PROVIDERS } = require('../../constants/providers');
  const p = PROVIDERS.find(prov => prov.id === providerId);
  if (!p) return null;

  // Derive base_url from modelsEndpoint (strip trailing /models, /v1/models, etc.)
  let baseUrl = null;
  if (p.modelsEndpoint) {
    baseUrl = p.modelsEndpoint.replace(/\/models$/, '');
  }

  return {
    providerId:   p.id,
    defaultModel: p.defaultModel || '',
    baseUrl,
    envKey:       p.envKey,
  };
}

// ── dotenv helpers ────────────────────────────────────────────────────────────

function parseDotEnv(content) {
  const env = {};
  for (const line of content.split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function serializeDotEnv(env) {
  return Object.entries(env)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${v}`)
    .join('\n') + '\n';
}

// ── JSON path helpers ─────────────────────────────────────────────────────────

function setNestedPath(obj, dotPath, value) {
  const keys = dotPath.split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] === undefined || typeof cur[keys[i]] !== 'object') {
      cur[keys[i]] = {};
    }
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
}

function getNestedPath(obj, dotPath) {
  return dotPath.split('.').reduce((cur, k) => cur?.[k], obj);
}

// ── Simple TOML serializer (covers [section] + key=value) ────────────────────
// Handles the common pattern: flat keys at root + [section] groups.
// Does not support arrays of tables — use a full library if needed.

function serializeToml(data) {
  const lines = [];
  const rootEntries = [];
  const sections = {};

  for (const [k, v] of Object.entries(data)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      sections[k] = v;
    } else {
      rootEntries.push([k, v]);
    }
  }

  for (const [k, v] of rootEntries) lines.push(`${k} = ${tomlValue(v)}`);

  for (const [section, entries] of Object.entries(sections)) {
    if (lines.length) lines.push('');
    lines.push(`[${section}]`);
    for (const [k, v] of Object.entries(entries)) {
      lines.push(`${k} = ${tomlValue(v)}`);
    }
  }

  return lines.join('\n') + '\n';
}

function parseToml(content) {
  // Minimal parser: flat keys and [section] groups only.
  const result = {};
  let currentSection = result;

  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const key = sectionMatch[1].trim();
      result[key] = result[key] || {};
      currentSection = result[key];
      continue;
    }
    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const k = kvMatch[1].trim();
      const v = kvMatch[2].trim().replace(/^["']|["']$/g, ''); // strip quotes
      currentSection[k] = v;
    }
  }
  return result;
}

function tomlValue(v) {
  if (typeof v === 'string') return `"${v.replace(/"/g, '\\"')}"`;
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  return `"${String(v)}"`;
}

// ── Minimal YAML serializer ───────────────────────────────────────────────────
// Handles nested objects with string/number/boolean values. No arrays or
// multi-line strings — sufficient for config.yaml model sections.

function serializeYaml(obj, indent = 0) {
  const lines = [];
  const prefix = '  '.repeat(indent);
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`${prefix}${k}:`);
      lines.push(serializeYaml(v, indent + 1));
    } else {
      lines.push(`${prefix}${k}: "${String(v)}"`);
    }
  }
  return lines.join('\n');
}

// ── Config file processor ─────────────────────────────────────────────────────
//
// applyMappings(mappings, wizardConfig) → flat env dict { KEY: value }
// Used for dotenv output and as the canonical "env" representation for readConfig.

function applyMappingsToEnv(mappings, wizardConfig, defaults) {
  const env = {};

  // Static defaults go first — explicit mappings override them.
  if (defaults && typeof defaults === 'object') {
    Object.assign(env, defaults);
  }

  for (const mapping of (mappings || [])) {
    const value = wizardConfig[mapping.field];
    if (mapping.type === 'llm-provider-key') {
      Object.assign(env, resolveLlmEnv(value));
    } else if (mapping.type === 'llm-provider-env') {
      // Provider-specific env vars with two modes:
      //
      // autoResolve (preferred) — derives values from providers.js (connection hub):
      //   envTemplate:  { ENV_KEY: "$providerId/$defaultModel" }
      //   openaiCompat: { providers: [...], envKeys: { OPENAI_BASE_URL: "$baseUrl" } }
      //
      // providerMap (legacy) — static lookup:
      //   providerMap: { deepseek: { ENV_KEY: "value" } }

      if (value?.provider) {
        if (mapping.autoResolve) {
          const meta = resolveProviderMeta(value.provider);
          if (meta) {
            // Interpolate $-variables: $providerId, $defaultModel, $baseUrl, $key, $envKey
            const interpolate = (tmpl) => tmpl
              .replace(/\$providerId/g,   meta.providerId)
              .replace(/\$defaultModel/g, meta.defaultModel)
              .replace(/\$baseUrl/g,      meta.baseUrl || '')
              .replace(/\$envKey/g,       meta.envKey || '')
              .replace(/\$key/g,          value.key || '');

            // envTemplate: write for ALL providers
            if (mapping.envTemplate) {
              for (const [ek, tmpl] of Object.entries(mapping.envTemplate)) {
                env[ek] = interpolate(tmpl);
              }
            }

            // openaiCompat: write only for listed providers that need OPENAI_BASE_URL routing
            if (mapping.openaiCompat && mapping.openaiCompat.providers?.includes(value.provider)) {
              for (const [ek, tmpl] of Object.entries(mapping.openaiCompat.envKeys || {})) {
                env[ek] = interpolate(tmpl);
              }
            }
          }
        } else if (mapping.providerMap) {
          // Legacy: static providerMap lookup
          const providerEnv = mapping.providerMap[value.provider];
          if (providerEnv) {
            for (const [ek, ev] of Object.entries(providerEnv)) {
              env[ek] = (ev === '$key') ? (value.key || '') : ev;
            }
          }
        }
      }
    } else if (mapping.type === 'llm-meta') {
      // llm-meta is JSON-only; skip for flat env
    } else if (mapping.type === 'llm-model-config') {
      // yaml-only; skip for flat env
    } else if (mapping.envKey && value !== undefined && value !== '') {
      env[mapping.envKey] = value;
    }
  }
  return env;
}

// applyMappingsToJson — builds a JSON-serializable object from mappings.
// Used for "json" and "toml" file types.

function applyMappingsToJson(mappings, wizardConfig) {
  const obj = {};
  for (const mapping of (mappings || [])) {
    const value = wizardConfig[mapping.field];
    if (value === undefined || value === null) continue;

    if (mapping.type === 'llm-provider-key') {
      const env = resolveLlmEnv(value);
      if (mapping.section) {
        obj[mapping.section] = obj[mapping.section] || {};
        Object.assign(obj[mapping.section], env);
      } else {
        Object.assign(obj, env);
      }
    } else if (mapping.type === 'llm-model-config') {
      const llm = wizardConfig[mapping.field] || {};

      if (mapping.format === 'zeroclaw-v2' && mapping.autoResolve && llm.provider) {
        // ZeroClaw v2: section name IS the provider identifier, no `kind` field.
        // Native providers: "anthropic", "openai", "gemini", etc.
        // Custom OpenAI-compatible: "custom:https://api.example.com"
        const meta = resolveProviderMeta(llm.provider);
        let sectionName = mapping.providerSectionOverrides?.[llm.provider];
        if (!sectionName) {
          const baseUrl = meta?.baseUrl || llm.baseUrl;
          sectionName = baseUrl ? `custom:${baseUrl}` : llm.provider;
        }
        const section = { [mapping.modelKey || 'model']: llm.model || meta?.defaultModel || '' };
        // Custom endpoints need an explicit api_key since ZeroClaw has no standard env var for them.
        if (sectionName.startsWith('custom:') && llm.key) {
          section.api_key = llm.key;
        }
        // Quoted section key for names containing ":" or "/" (TOML requires quoting).
        const sectionKey = (sectionName.includes(':') || sectionName.includes('/'))
          ? `providers.models."${sectionName}"`
          : `providers.models.${sectionName}`;
        obj[sectionKey] = section;
        obj['providers'] = { fallback: sectionName };
        obj['schema_version'] = 2;
      } else {
        let section = {};
        if (mapping.autoResolve && llm.provider) {
          const meta = resolveProviderMeta(llm.provider);
          if (meta) {
            const modelKey    = mapping.modelKey || 'default';
            const providerKey = mapping.providerKey || 'provider';
            const baseUrlKey  = mapping.baseUrlKey || 'base_url';

            section[modelKey] = meta.defaultModel;
            const provType = mapping.providerTypeOverrides?.[meta.providerId] || mapping.fallbackProviderType || meta.providerId;
            section[providerKey] = provType;

            if (meta.baseUrl) {
              section[baseUrlKey] = meta.baseUrl;
            }
          }
        } else if (mapping.providerMap) {
          const providerId = llm.provider || mapping.fallbackProvider || Object.keys(mapping.providerMap)[0];
          const resolved = mapping.providerMap[providerId] || mapping.providerMap[mapping.fallbackProvider] || {};
          for (const [k, v] of Object.entries(resolved)) {
            section[k] = v;
          }
        }

        if (Object.keys(section).length > 0) {
          if (mapping.tomlSection) {
            obj[mapping.tomlSection] = Object.assign(obj[mapping.tomlSection] || {}, section);
          } else if (mapping.yamlPath) {
            setNestedPath(obj, mapping.yamlPath, section);
          } else if (mapping.tomlPath) {
            setNestedPath(obj, mapping.tomlPath, section);
          } else if (mapping.jsonPath) {
            setNestedPath(obj, mapping.jsonPath, section);
          } else {
            Object.assign(obj, section);
          }
        }
      }

    } else if (mapping.type === 'llm-meta') {
      // Persist connection metadata (connectionId, provider, model) for runtime use.
      const meta = {
        ...(value.connectionId ? { CLAWEXPRESS_CONNECTION_ID: value.connectionId } : {}),
        ...(value.provider     ? { CLAWEXPRESS_PROVIDER: value.provider }          : {}),
        ...(value.model        ? { CLAWEXPRESS_MODEL: value.model }                 : {}),
      };
      if (mapping.section) {
        obj[mapping.section] = obj[mapping.section] || {};
        Object.assign(obj[mapping.section], meta);
      } else {
        Object.assign(obj, meta);
      }
    } else if (mapping.path) {
      setNestedPath(obj, mapping.path, value);
    } else if (mapping.section && mapping.key) {
      obj[mapping.section] = obj[mapping.section] || {};
      obj[mapping.section][mapping.key] = value;
    } else if (mapping.type === 'static') {
      if (mapping.section && mapping.key) {
        obj[mapping.section] = obj[mapping.section] || {};
        obj[mapping.section][mapping.key] = mapping.value;
      }
    } else if (mapping.envKey) {
      if (mapping.section) {
        obj[mapping.section] = obj[mapping.section] || {};
        obj[mapping.section][mapping.envKey] = value;
      } else {
        obj[mapping.envKey] = value;
      }
    }
  }
  return obj;
}

// ── Write a single config file ────────────────────────────────────────────────

function writeConfigFile(filePath, fileSpec, wizardConfig, sendLog) {
  const { type, mappings } = fileSpec;

  switch (type) {
    case 'template':
      // Handled separately in finalizeConfig (copy from templates dir).
      return;

    case 'dotenv': {
      const env = applyMappingsToEnv(mappings, wizardConfig, fileSpec.defaults);
      fs.writeFileSync(filePath, serializeDotEnv(env), 'utf8');
      sendLog(`[INFO] ${path.basename(filePath)} written (${Object.keys(env).length} key(s))`);
      break;
    }

    case 'yaml': {
      // Build YAML from mappings. Supports llm-model-config for provider→model resolution.
      const yamlObj = {};
      for (const mapping of (mappings || [])) {
        if (mapping.type === 'llm-model-config') {
          const llm = wizardConfig[mapping.field] || {};
          let section = {};
          let logModel = '?';
          let logProvider = '?';

          if (mapping.autoResolve && llm.provider) {
            // Resolve from connection hub
            const meta = resolveProviderMeta(llm.provider);
            if (meta) {
              const modelKey    = mapping.modelKey || 'default';
              const providerKey = mapping.providerKey || 'provider';
              const baseUrlKey  = mapping.baseUrlKey || 'base_url';

              section[modelKey] = meta.defaultModel;

              // Use override if specified in manifest, else fallback type (e.g. 'custom')
              const provType = mapping.providerTypeOverrides?.[meta.providerId] || mapping.fallbackProviderType || meta.providerId;
              section[providerKey] = provType;

              if (meta.baseUrl) {
                section[baseUrlKey] = meta.baseUrl;
              }

              logModel = meta.defaultModel;
              logProvider = provType;
            }
          } else if (mapping.providerMap) {
            // Legacy static lookup
            const providerId = llm.provider || mapping.fallbackProvider || Object.keys(mapping.providerMap)[0];
            const resolved = mapping.providerMap[providerId] || mapping.providerMap[mapping.fallbackProvider] || {};
            for (const [k, v] of Object.entries(resolved)) {
              section[k] = v;
            }
            logModel = resolved.default || '?';
            logProvider = resolved.provider || '?';
          }

          if (Object.keys(section).length > 0) {
            if (mapping.yamlPath) {
              setNestedPath(yamlObj, mapping.yamlPath, section);
            } else {
              Object.assign(yamlObj, section);
            }
            sendLog(`[INFO] ${path.basename(filePath)} — model: ${logModel}, provider: ${logProvider}`);
          }
        }
      }
      const header = fileSpec.header || '';
      const body = serializeYaml(yamlObj);
      fs.writeFileSync(filePath, header + body + '\n', 'utf8');
      sendLog(`[INFO] ${path.basename(filePath)} written`);
      break;
    }

    case 'json': {
      const existing = fs.existsSync(filePath)
        ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
        : {};
      const patch = applyMappingsToJson(mappings, wizardConfig);
      // Deep merge patch into existing
      const merged = deepMerge(existing, patch);
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2), 'utf8');
      sendLog(`[INFO] ${path.basename(filePath)} written`);
      break;
    }

    case 'toml': {
      const existing = fs.existsSync(filePath)
        ? parseToml(fs.readFileSync(filePath, 'utf8'))
        : {};
      const patch = applyMappingsToJson(mappings, wizardConfig);
      const merged = deepMerge(existing, patch);
      fs.writeFileSync(filePath, serializeToml(merged), 'utf8');
      sendLog(`[INFO] ${path.basename(filePath)} written`);
      break;
    }

    default:
      sendLog(`[WARN] Unknown configFile type "${type}" for ${path.basename(filePath)} — skipped`);
  }
}

function deepMerge(target, source) {
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== null && typeof v === 'object' && !Array.isArray(v) &&
        out[k] !== null && typeof out[k] === 'object') {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── Read the primary env from config files ────────────────────────────────────
// Returns a flat { KEY: value } dict by reading all dotenv/json files
// declared in configFiles and merging their mapped keys.

function readEnvFromConfigFiles(configFiles, dir) {
  const env = {};
  for (const [filename, fileSpec] of Object.entries(configFiles || {})) {
    const filePath = path.join(dir, filename);
    if (!fs.existsSync(filePath)) continue;

    if (fileSpec.type === 'dotenv') {
      Object.assign(env, parseDotEnv(fs.readFileSync(filePath, 'utf8')));
    } else if (fileSpec.type === 'json') {
      try {
        const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        // Flatten env section and root-level string keys
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') env[k] = v;
        }
        if (obj.env && typeof obj.env === 'object') Object.assign(env, obj.env);
      } catch (_) {}
    } else if (fileSpec.type === 'toml') {
      try {
        const obj = parseToml(fs.readFileSync(filePath, 'utf8'));
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === 'string') env[k] = v;
        }
      } catch (_) {}
    }
  }
  return env;
}

// ── Factory ───────────────────────────────────────────────────────────────────

function createGenericAdapter(manifest) {
  const configFiles = manifest.configFiles || {};

  return {
    id:      manifest.id,
    aliases: manifest.aliases || [],

    // ── readConfig ────────────────────────────────────────────────────────────
    readConfig: ({ cwd }) => {
      if (!cwd) return { success: false, reason: 'No cwd provided' };
      try {
        const env = readEnvFromConfigFiles(configFiles, cwd);
        return { success: true, env };
      } catch (err) {
        return { success: false, reason: err.message };
      }
    },

    // ── writeConfig ───────────────────────────────────────────────────────────
    // Called by ConfigPanel when user edits settings at runtime.
    // Writes the flat `env` dict back to whichever dotenv/json file owns each key.
    writeConfig: ({ cwd, env }) => {
      if (!cwd) return { success: false, reason: 'No cwd provided' };
      try {
        for (const [filename, fileSpec] of Object.entries(configFiles)) {
          if (fileSpec.type === 'template') continue;
          const filePath = path.join(cwd, filename);

          if (fileSpec.type === 'dotenv') {
            // Merge incoming env into existing file content
            const existing = fs.existsSync(filePath)
              ? parseDotEnv(fs.readFileSync(filePath, 'utf8'))
              : {};
            fs.writeFileSync(filePath, serializeDotEnv({ ...existing, ...env }), 'utf8');
          } else if (fileSpec.type === 'json') {
            const existing = fs.existsSync(filePath)
              ? JSON.parse(fs.readFileSync(filePath, 'utf8'))
              : {};
            // Update only env section (flat keys from env dict)
            const envSection = existing.env || {};
            Object.assign(envSection, env);
            existing.env = envSection;
            fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf8');
          }
        }
        return { success: true };
      } catch (err) {
        log.error(`[generic.adapter:${manifest.id}] writeConfig failed:`, err.message);
        return { success: false, reason: err.message };
      }
    },

    // ── finalizeConfig ────────────────────────────────────────────────────────
    // Called once by platformInstaller after the installScript completes.
    // Processes manifest.configFiles: copies templates and writes data files.
    finalizeConfig: (config, writeDir, sendLog) => {
      sendLog(`[INFO] Finalizing ${manifest.name} configuration...`);
      try {
        if (!fs.existsSync(writeDir)) fs.mkdirSync(writeDir, { recursive: true });

        const templatesDir = getTemplatesDir(manifest.id);

        for (const [filename, fileSpec] of Object.entries(configFiles)) {
          const destPath = path.join(writeDir, filename);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });

          if (fileSpec.type === 'template') {
            const src = path.join(templatesDir, filename);
            if (fs.existsSync(src)) {
              fs.copyFileSync(src, destPath);
              sendLog(`[INFO] ${filename} written to ${writeDir}`);
            } else {
              sendLog(`[WARN] Template not found: ${src}`);
            }
          } else {
            writeConfigFile(destPath, fileSpec, config, sendLog);
          }
        }

        sendLog(`[SUCCESS] ${manifest.name} is ready.`);
      } catch (err) {
        log.error(`[generic.adapter:${manifest.id}] finalizeConfig error:`, err);
        sendLog(`[WARN] Config error: ${err.message}`);
      }
    },

    // ── Stubs ─────────────────────────────────────────────────────────────────
    readRawConfig:       () => ({ success: false, reason: 'Not supported' }),
    writeRawConfig:      () => ({ success: false, reason: 'Not supported' }),
    getRawConfigHistory: () => ({ success: false, history: [] }),
    restoreRawConfig:    () => ({ success: false, reason: 'Not supported' }),
    channelCheckLinked:  () => ({ linked: false }),
    channelLogin:        () => ({ success: false, reason: 'Not supported' }),
    channelLogout:       () => ({ success: false }),
    channelLoginSuccess: () => ({ success: false }),
  };
}

module.exports = { createGenericAdapter };
