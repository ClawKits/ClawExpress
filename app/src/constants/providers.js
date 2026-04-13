export const PROVIDER_CATEGORIES = {
  VENDOR: 'vendor',
  PROXY: 'proxy',
  CLI: 'cli',
};

export const PROVIDERS = [
  // ─── PROXIES & LOCAL ───────────────────────────────────────────────
  { id: 'custom',                label: 'Custom Proxy',             envKey: 'OPENAI_API_KEY',                hint: 'sk-...',            url: '',                                                                  defaultModel: '', category: PROVIDER_CATEGORIES.PROXY },


  // ─── VENDORS ────────────────────────────────────────────────────────
  { id: 'openrouter',            label: 'OpenRouter',               envKey: 'OPENROUTER_API_KEY',            hint: 'sk-or-v1-...',     url: 'https://openrouter.ai/keys',                                                        defaultModel: 'auto', modelsEndpoint: 'https://openrouter.ai/api/v1/models',
    models: ['auto', 'anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro-1.5', 'deepseek/deepseek-r1', 'meta-llama/llama-3-70b-instruct'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'anthropic',             label: 'Claude',                   envKey: 'ANTHROPIC_API_KEY',             hint: 'sk-ant-...',        url: 'https://console.anthropic.com/settings/keys',                                       defaultModel: 'claude-3-5-sonnet-20241022', modelsEndpoint: 'https://api.anthropic.com/v1/models',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-opus-20240229', 'claude-3-5-haiku-20241022'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'openai',                label: 'OpenAI',                   envKey: 'OPENAI_API_KEY',                hint: 'sk-...',            url: 'https://platform.openai.com/api-keys',                                              defaultModel: 'gpt-4o', modelsEndpoint: 'https://api.openai.com/v1/models',
    models: ['gpt-4o', 'gpt-4o-mini', 'o1-preview', 'o1-mini'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'google',                label: 'Gemini',                   envKey: 'GEMINI_API_KEY',                hint: 'AIza...',           url: 'https://aistudio.google.com/app/apikey',                                            defaultModel: 'gemini-1.5-pro-latest', modelsEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    models: ['gemini-1.5-pro-latest', 'gemini-1.5-flash-latest', 'gemini-exp-1114', 'gemini-2.0-flash-exp'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'mistral',               label: 'Mistral',                  envKey: 'MISTRAL_API_KEY',               hint: '...',               url: 'https://console.mistral.ai/api-keys',                                               defaultModel: 'mistral-large-latest', modelsEndpoint: 'https://api.mistral.ai/v1/models',
    models: ['mistral-large-latest', 'pixtral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'groq',                  label: 'Groq',                     envKey: 'GROQ_API_KEY',                  hint: 'gsk_...',           url: 'https://console.groq.com/keys',                                                     defaultModel: 'llama-3.3-70b-versatile', modelsEndpoint: 'https://api.groq.com/openai/v1/models',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'xai',                   label: 'Grok',                     envKey: 'XAI_API_KEY',                   hint: 'xai-...',           url: 'https://console.x.ai/',                                                             defaultModel: 'grok-beta', modelsEndpoint: 'https://api.x.ai/v1/models',
    models: ['grok-beta'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'deepseek',              label: 'DeepSeek',                 envKey: 'DEEPSEEK_API_KEY',              hint: 'sk-...',            url: 'https://platform.deepseek.com/api_keys',                                            defaultModel: 'deepseek-chat', modelsEndpoint: 'https://api.deepseek.com/models',
    models: ['deepseek-chat', 'deepseek-reasoner'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'nvidia',                label: 'NVIDIA',                   envKey: 'NVIDIA_API_KEY',                hint: 'nvapi-...',         url: 'https://build.nvidia.com/settings/api-key',                                         defaultModel: 'meta/llama-3.1-70b-instruct', modelsEndpoint: 'https://integrate.api.nvidia.com/v1/models',
    models: ['meta/llama-3.1-70b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'deepseek-ai/deepseek-r1', 'qwen/qwen2.5-72b-instruct'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'together',              label: 'Together AI',              envKey: 'TOGETHER_API_KEY',              hint: '...',               url: 'https://api.together.xyz/settings/api-keys',                                        defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', modelsEndpoint: 'https://api.together.xyz/v1/models',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct-Turbo'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'qwen',                  label: 'Qwen',                     envKey: 'QWEN_API_KEY',                  hint: 'sk-...',            url: 'https://bailian.console.aliyun.com/',                                               defaultModel: 'qwen-max', modelsEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/models',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'moonshot',              label: 'Moonshot',                 envKey: 'MOONSHOT_API_KEY',              hint: '...',               url: 'https://platform.moonshot.cn/console/api-keys',                                     defaultModel: 'moonshot-v1-32k', modelsEndpoint: 'https://api.moonshot.cn/v1/models',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'zai',                   label: 'Z.AI GLM',                 envKey: 'ZAI_API_KEY',                   hint: '...',               url: 'https://bigmodel.cn/usercenter/apikeys',                                            defaultModel: 'glm-4',
    models: ['glm-4', 'glm-4-flash', 'glm-4v', 'glm-3-turbo'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'minimax',               label: 'MiniMax',                  envKey: 'MINIMAX_API_KEY',               hint: '...',               url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',          defaultModel: 'abab6.5-chat',
    models: ['abab6.5-chat', 'abab6.5s-chat'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'cerebras',              label: 'Cerebras',                 envKey: 'CEREBRAS_API_KEY',              hint: '...',               url: 'https://cloud.cerebras.ai/platform/',                                               defaultModel: 'llama3.1-70b', modelsEndpoint: 'https://api.cerebras.ai/v1/models',
    models: ['llama3.1-70b', 'llama3.1-8b'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'venice',                label: 'Venice AI',                envKey: 'VENICE_API_KEY',                hint: '...',               url: 'https://venice.ai/settings/api',                                                    defaultModel: 'llama-3.3-70b', modelsEndpoint: 'https://api.venice.ai/api/v1/models',
    models: ['llama-3.3-70b', 'venice-uncensored', 'mistral-31-24b'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'huggingface',           label: 'Hugging Face',             envKey: 'HUGGINGFACE_HUB_TOKEN',         hint: 'hf_...',            url: 'https://huggingface.co/settings/tokens',                                            defaultModel: 'meta-llama/Llama-3.3-70B-Instruct',
    models: ['meta-llama/Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-72B-Instruct'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'opencode',              label: 'OpenCode Zen',             envKey: 'OPENCODE_API_KEY',              hint: '...',               url: 'https://opencode.ai',                                                               defaultModel: 'claude-3-opus',
    models: ['claude-3-opus', 'claude-3-sonnet', 'gpt-4o', 'gemini-1.5-pro'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'volcengine',            label: 'Volcengine',               envKey: 'VOLCANO_ENGINE_API_KEY',        hint: '...',               url: 'https://console.volcengine.com/ark',                                                defaultModel: 'ep-...',
    models: ['ep-...'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'kimi',                  label: 'Kimi Coding',              envKey: 'KIMI_API_KEY',                  hint: '...',               url: 'https://kimi.ai',                                                                   defaultModel: 'moonshot-v1-32k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'stepfun',               label: 'StepFun',                  envKey: 'STEPFUN_API_KEY',               hint: '...',               url: 'https://platform.stepfun.com/',                                                     defaultModel: 'step-1-32k',
    models: ['step-1-32k', 'step-1-128k', 'step-1-256k'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'xiaomi',                label: 'Xiaomi MiMo',              envKey: 'XIAOMI_API_KEY',                hint: '...',               url: 'https://ai.mi.com/',                                                                defaultModel: 'mimo-v2',
    models: ['mimo-v2'], category: PROVIDER_CATEGORIES.VENDOR },
  { id: 'qianfan',               label: 'Qianfan Baidu',            envKey: 'QIANFAN_API_KEY',               hint: '...',               url: 'https://console.bce.baidu.com/qianfan/',                                            defaultModel: 'ernie-4.0-8k',
    models: ['ernie-4.0-8k', 'ernie-3.5-8k', 'ernie-speed-128k'], category: PROVIDER_CATEGORIES.VENDOR },


  // ─── CLI / OAuth ─────────────────────────────────────────────────────
  {
    id: 'codex',
    label: 'OpenAI Codex',
    envKey: 'OPENAI_CODEX_API_KEY',
    hint: 'OAuth via browser',
    url: '',
    defaultModel: 'openai-codex/gpt-5.4',
    models: [],
    // Models are fetched live from the OpenClaw gateway (/v1/models) and
    // filtered by this prefix. No hardcoded list — gateway is source of truth.
    gatewayModelPrefix: 'openai-codex/',
    category: PROVIDER_CATEGORIES.CLI,
    oauth: {
      authUrl: 'https://auth.openai.com/oauth/authorize',
      tokenUrl: 'https://auth.openai.com/oauth/token',
      clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
      redirectPort: 1455,
      redirectPath: '/auth/callback',
      scopes: 'openid profile email offline_access',
      // Extra params required by Codex CLI (from reverse-engineered real URL)
      extraParams: {
        id_token_add_organizations: 'true',
        codex_cli_simplified_flow: 'true',
        originator: 'codex_cli_rs',
      },
    }
  },

  { 
    id: 'claude_code',
    label: 'Claude Code (API Key)',
    envKey: 'ANTHROPIC_API_KEY',
    hint: 'sk-ant-...',
    url: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'anthropic/claude-opus-4-5',
    models: ['anthropic/claude-opus-4-5', 'anthropic/claude-sonnet-4-5', 'anthropic/claude-haiku-4-5'],
    category: PROVIDER_CATEGORIES.VENDOR,
    // Note: Anthropic prohibits third-party OAuth using claude.ai subscriptions.
    // Users must use an API key from console.anthropic.com instead.
  },
  { id: 'cli_gemini', label: 'Gemini CLI', envKey: 'GEMINI_CLI_TOKEN', hint: 'OAuth via browser', url: '', defaultModel: 'gemini-2.5-pro',
    models: [], gatewayModelPrefix: 'gemini/', category: PROVIDER_CATEGORIES.CLI,
    oauth: {
      authUrl: 'https://accounts.google.com/o/oauth2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: '',     // loaded at runtime from /api/v1/config/oauth
      clientSecret: '', // loaded at runtime from /api/v1/config/oauth
      redirectPort: 1456,
      redirectPath: '/',
      scopes: 'openid email profile https://www.googleapis.com/auth/cloud-platform',
      extraParams: {
        access_type: 'offline',
        prompt: 'consent'
      }
    }
  },
];

export const ENV_KEY_TO_PROVIDER = Object.fromEntries(PROVIDERS.map(p => [p.envKey, p]));
