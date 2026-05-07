/**
 * Hermes Workspace — platform definition for ClawExpress
 *
 * Architecture: two-container Docker Compose stack
 *   - hermes-agent     → nousresearch/hermes-agent:latest   (port 8642, gateway)
 *   - hermes-workspace → ghcr.io/outsourc-e/hermes-workspace:latest (port 3000, UI)
 *
 * Install flow (no git clone needed):
 *   1. installScript is empty → platformInstaller calls finalizeConfig immediately
 *   2. hermes.adapter.js#finalizeConfig writes docker-compose.yml + .env to targetDir
 *   3. startScript runs `docker compose up -d` from targetDir
 *
 * Isolation: agent state lives in the `claude-data` Docker named volume.
 * No other platform is affected.
 *
 * Source: https://github.com/outsourc-e/hermes-workspace
 */
export const hermes = {
  id: 'hermes',
  name: 'Hermes Workspace',
  version: 'latest',
  author: 'outsourc-e / NousResearch',
  description:
    "Your AI agent's command center — chat, files, memory, skills, MCP, and terminal in one place. Powered by NousResearch/hermes-agent + Docker Compose.",
  method: 'docker',
  verified: true,
  updatable: true,

  // Primary UI port exposed to the host
  port: 3000,

  // ── Installation ──────────────────────────────────────────────────────────
  // Empty → platformInstaller.js line 280-285 skips to doFinalizeConfig()
  // which triggers hermes.adapter.js#finalizeConfig to write
  // docker-compose.yml + .env into targetDir.
  installScript: {
    docker: []
  },

  // ── Start ─────────────────────────────────────────────────────────────────
  // docker-compose.yml is present in targetDir after finalizeConfig.
  // ClawExpress sets CWD = targetDir before spawning.
  startScript: {
    docker: ['docker', 'compose', 'up', '-d']
  },

  // ── Stop ──────────────────────────────────────────────────────────────────
  stopScript: {
    docker: ['docker', 'compose', 'down']
  },

  // ── Install-wizard configSchema ───────────────────────────────────────────
  configSchema: [
    {
      id: 'llm_config',
      type: 'llm-key-picker',
      label: 'LLM Provider',
      description:
        'Select an LLM provider key. The credential is injected into the Hermes Agent gateway via .env so it can reach your chosen model.'
    },
    {
      id: 'hermes_password',
      type: 'text',
      label: 'Workspace Password (optional)',
      envKey: 'HERMES_PASSWORD',
      placeholder: 'Leave blank to disable password protection',
      description:
        'Password-protect the Hermes Workspace web UI. Recommended when exposed on a LAN or Tailscale.'
    },
    {
      id: 'api_server_key',
      type: 'text',
      label: 'Gateway API Key (optional)',
      envKey: 'API_SERVER_KEY',
      placeholder: 'Leave blank for loopback-only installs',
      description:
        'Shared secret for the hermes-agent gateway. Set only if you expose port 8642 outside localhost.'
    }
  ],

  // ── ConfigPanel feature flags ─────────────────────────────────────────────
  schema: {
    features: ['ai_engine_setup', 'custom_env'],
    fields: [
      { key: 'port', label: 'UI Port', type: 'number', placeholder: '3000' }
    ]
  }
};
