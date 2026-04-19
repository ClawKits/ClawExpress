export const openfang = {
  id: 'openfang',
  name: 'OpenFang',
  version: null,
  author: 'RightNow-AI',
  description: 'Open-source Agent OS built in Rust. 7 autonomous Hands. 40 channel adapters. 16 security layers.',
  method: 'docker',
  verified: true,
  updatable: true,
  port: 4200,
  schema: {
    features: ['openfang_ai_setup', 'custom_env', 'raw_config'],
    fields: [
      { key: 'port', label: 'Listen Port', placeholder: '4200' }
    ]
  },
  installScript: {
    // GHCR is currently private — build locally from the public Git repo
    docker: ['docker', 'build', '-t', 'ghcr.io/rightnow-ai/openfang:latest', 'https://github.com/RightNow-AI/openfang.git']
  },
  startScript: {
    // OpenFang hardcodes its API server to 127.0.0.1 (loopback only).
    // We use a socat bridge: start.sh runs openfang + socat 0.0.0.0:50052 -> 127.0.0.1:50051
    // Docker maps host:4200 -> container:50052.
    // Credentials read from ~/.openfang/.env via --env-file (keys stay off ps output).
    docker: [
      'docker', 'run', '-i',
      '-p', '4200:50052',
      '-v', 'openfang-data:/data',
      '-v', '{{cwd}}/config.toml:/data/config.toml',
      '-v', '{{cwd}}/start.sh:/start.sh',
      '--env-file', '{{cwd}}/.env',
      // Required on Linux: host.docker.internal is not injected automatically by Docker on Linux hosts
      '--add-host', 'host.docker.internal:host-gateway',
      '--entrypoint', 'sh',
      'ghcr.io/rightnow-ai/openfang:latest',
      '/start.sh'
    ]
  },

  // ── Channel registry (mirrors OpenFang's 40 adapters) ──────────────────────
  // Fields: label, icon, group, envKey, placeholder, tomlKey
  //   tomlKey  = [channels.X] section name written to config.toml
  //   envKey   = environment variable that contains the credential
  channels: {
    // Core
    telegram:   { label: 'Telegram',          icon: '✈️',  group: 'Core',       envKey: 'TELEGRAM_BOT_TOKEN',    placeholder: '123456:ABC-DEF…', tomlKey: 'telegram'   },
    discord:    { label: 'Discord',            icon: '🎮',  group: 'Core',       envKey: 'DISCORD_BOT_TOKEN',     placeholder: 'Bot token…',      tomlKey: 'discord'    },
    slack:      { label: 'Slack Bot',          icon: '💼',  group: 'Core',       envKey: 'SLACK_BOT_TOKEN',       placeholder: 'xoxb-…',          tomlKey: 'slack'      },
    slack_app:  { label: 'Slack App Token',    icon: '💼',  group: 'Core',       envKey: 'SLACK_APP_TOKEN',       placeholder: 'xapp-…',          tomlKey: 'slack'      },
    whatsapp:   { label: 'WhatsApp Cloud API', icon: '📱',  group: 'Core',       envKey: 'WHATSAPP_TOKEN',        placeholder: 'Bearer token…',   tomlKey: 'whatsapp'   },
    signal:     { label: 'Signal',             icon: '🔒',  group: 'Core',       envKey: 'SIGNAL_PHONE',          placeholder: '+1234567890',     tomlKey: 'signal'     },
    matrix:     { label: 'Matrix',             icon: '🌐',  group: 'Core',       envKey: 'MATRIX_ACCESS_TOKEN',   placeholder: 'syt_…',           tomlKey: 'matrix'     },
    email:      { label: 'Email (IMAP/SMTP)',  icon: '📧',  group: 'Core',       envKey: 'EMAIL_PASSWORD',        placeholder: 'App password…',   tomlKey: 'email'      },
    // Enterprise
    msteams:    { label: 'Microsoft Teams',    icon: '👔',  group: 'Enterprise', envKey: 'MSTEAMS_BOT_TOKEN',     placeholder: 'Bot token…',      tomlKey: 'msteams'    },
    mattermost: { label: 'Mattermost',         icon: '🏢',  group: 'Enterprise', envKey: 'MATTERMOST_TOKEN',      placeholder: 'Access token…',   tomlKey: 'mattermost' },
    googlechat: { label: 'Google Chat',        icon: '💬',  group: 'Enterprise', envKey: 'GOOGLE_CHAT_KEY',       placeholder: 'Webhook key…',    tomlKey: 'googlechat' },
    webex:      { label: 'Webex',              icon: '🔷',  group: 'Enterprise', envKey: 'WEBEX_BOT_TOKEN',       placeholder: 'Bearer token…',   tomlKey: 'webex'      },
    feishu:     { label: 'Feishu / Lark',      icon: '🪶',  group: 'Enterprise', envKey: 'FEISHU_APP_SECRET',     placeholder: 'App secret…',     tomlKey: 'feishu'     },
    zulip:      { label: 'Zulip',              icon: '🌊',  group: 'Enterprise', envKey: 'ZULIP_API_KEY',         placeholder: 'API key…',        tomlKey: 'zulip'      },
    // Social
    line:       { label: 'LINE',               icon: '💚',  group: 'Social',     envKey: 'LINE_CHANNEL_TOKEN',    placeholder: 'Channel token…',  tomlKey: 'line'       },
    viber:      { label: 'Viber',              icon: '💜',  group: 'Social',     envKey: 'VIBER_AUTH_TOKEN',      placeholder: 'Auth token…',     tomlKey: 'viber'      },
    messenger:  { label: 'Facebook Messenger', icon: '📘',  group: 'Social',     envKey: 'FB_PAGE_ACCESS_TOKEN',  placeholder: 'Page token…',     tomlKey: 'messenger'  },
    mastodon:   { label: 'Mastodon',           icon: '🐘',  group: 'Social',     envKey: 'MASTODON_ACCESS_TOKEN', placeholder: 'Access token…',   tomlKey: 'mastodon'   },
    bluesky:    { label: 'Bluesky',            icon: '🦋',  group: 'Social',     envKey: 'BLUESKY_APP_PASSWORD',  placeholder: 'App password…',   tomlKey: 'bluesky'    },
    reddit:     { label: 'Reddit',             icon: '🤖',  group: 'Social',     envKey: 'REDDIT_CLIENT_SECRET',  placeholder: 'Client secret…',  tomlKey: 'reddit'     },
    linkedin:   { label: 'LinkedIn',           icon: '🔗',  group: 'Social',     envKey: 'LINKEDIN_ACCESS_TOKEN', placeholder: 'Access token…',   tomlKey: 'linkedin'   },
    twitch:     { label: 'Twitch',             icon: '🎮',  group: 'Social',     envKey: 'TWITCH_TOKEN',          placeholder: 'OAuth token…',    tomlKey: 'twitch'     },
    // Community
    irc:        { label: 'IRC',                icon: '📡',  group: 'Community',  envKey: 'IRC_PASSWORD',          placeholder: 'Server pass…',    tomlKey: 'irc'        },
    guilded:    { label: 'Guilded',            icon: '🏅',  group: 'Community',  envKey: 'GUILDED_BOT_TOKEN',     placeholder: 'Bot token…',      tomlKey: 'guilded'    },
    revolt:     { label: 'Revolt',             icon: '⚡',  group: 'Community',  envKey: 'REVOLT_BOT_TOKEN',      placeholder: 'Bot token…',      tomlKey: 'revolt'     },
    // Privacy
    nostr:      { label: 'Nostr',              icon: '🔓',  group: 'Privacy',    envKey: 'NOSTR_PRIVATE_KEY',     placeholder: 'nsec1…',          tomlKey: 'nostr'      },
    ntfy:       { label: 'Ntfy',               icon: '📣',  group: 'Privacy',    envKey: 'NTFY_TOKEN',            placeholder: 'Token…',          tomlKey: 'ntfy'       },
    gotify:     { label: 'Gotify',             icon: '🔔',  group: 'Privacy',    envKey: 'GOTIFY_APP_TOKEN',      placeholder: 'App token…',      tomlKey: 'gotify'     },
    // Workplace
    zalo:       { label: 'Zalo',               icon: '🇻🇳', group: 'Workplace',  envKey: 'ZALO_BOT_TOKEN',        placeholder: 'Bot token…',      tomlKey: 'zalo'       },
    dingtalk:   { label: 'DingTalk',           icon: '📎',  group: 'Workplace',  envKey: 'DINGTALK_ACCESS_TOKEN', placeholder: 'Access token…',   tomlKey: 'dingtalk'   },
    webhook:    { label: 'Webhooks',           icon: '🔗',  group: 'Workplace',  envKey: 'WEBHOOK_SECRET',        placeholder: 'Webhook secret…', tomlKey: 'webhook'    },
  },

  // ── Install-wizard configSchema ───────────────────────────────────────────
  configSchema: [
    {
      id: 'llm_config',
      type: 'llm-key-picker',
      label: 'Model Connection',
      description: 'Select an LLM connection. Credentials are stored in ~/.openfang/.env.'
    },
  ],

  // ── ConfigPanel feature flags ─────────────────────────────────────────────
  schema: {
    features: ['ai_engine_setup', 'raw_config', 'custom_env', 'updatable'],
    fields: [
      { key: 'port', label: 'Port', type: 'number', placeholder: 'e.g. 4200' }
    ]
  }
};
