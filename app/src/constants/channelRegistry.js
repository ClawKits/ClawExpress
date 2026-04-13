// UI Metadata Hints for channels
// If a channel is NOT defined here, it will be rendered by default using the Generic Config Editor.
const CHANNEL_REGISTRY = {
  // ── Token-based channels ──
  telegram:  { authType: 'token', envKey: 'TELEGRAM_BOT_TOKEN',  label: 'Telegram',      icon: '✈️',  placeholder: '123456:ABCDEF...' },
  discord:   { authType: 'token', envKey: 'DISCORD_BOT_TOKEN',   label: 'Discord',       icon: '🎮',  placeholder: 'MTE...' },
  slack:     { authType: 'token', envKey: 'SLACK_BOT_TOKEN',     label: 'Slack',         icon: '💼',  placeholder: 'xoxb-...' },
  zalo:      { authType: 'token', envKey: 'ZALO_BOT_TOKEN',      label: 'Zalo Bot',      icon: '🇻🇳',  placeholder: ' numeric_id:secret ' },
  line:      { authType: 'token', envKey: 'LINE_CHANNEL_TOKEN',  label: 'LINE',          icon: '🟢',  placeholder: 'Channel access token' },
  msteams:   { authType: 'token', envKey: 'MSTEAMS_BOT_TOKEN',   label: 'MS Teams',      icon: '🟣',  placeholder: 'Bot token' },
  twitch:    { authType: 'token', envKey: 'TWITCH_TOKEN',        label: 'Twitch',        icon: '🟪',  placeholder: 'oauth:...' },
  
  // ── QR-based channels ──
  whatsapp:  { authType: 'qr',    label: 'WhatsApp',      icon: '💬', color: '#25D366', desc: 'Scan QR with your phone', requiresGateway: false, managesGateway: true },
  zalouser:  { authType: 'qr',    label: 'Zalo Personal', icon: '🇻🇳', color: '#0068FF', desc: 'Scan QR with your phone', requiresGateway: false },

  // ── Config-only channels ──
  matrix:    { authType: 'config', label: 'Matrix',    icon: '🟩' },
  irc:       { authType: 'config', label: 'IRC',       icon: '📡' },
  signal:    { authType: 'config', label: 'Signal',    icon: '🔵' },
  nostr:     { authType: 'config', label: 'Nostr',     icon: '🦩' },
};

export default CHANNEL_REGISTRY;
