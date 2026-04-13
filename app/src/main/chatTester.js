const https = require('https');
const http = require('http');

function makeRequest(urlStr, method, headers, body) {
  return new Promise((resolve, reject) => {
    try {
      const url = new URL(urlStr);
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: method,
        headers: headers,
        timeout: 120000 // 120s timeout
      };

      const client = url.protocol === 'https:' ? https : http;
      const req = client.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            data: Buffer.concat(chunks).toString('utf8')
          });
        });
      });

      req.on('error', (e) => reject(e));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timed out after 120s (local models may take time to load to memory)'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
}

const PROVIDER_API_MAP = {
  'openai': 'https://api.openai.com/v1/chat/completions',
  'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
  'groq': 'https://api.groq.com/openai/v1/chat/completions',
  'deepseek': 'https://api.deepseek.com/chat/completions',
  'mistral': 'https://api.mistral.ai/v1/chat/completions',
  'xai': 'https://api.x.ai/v1/chat/completions',
  'together': 'https://api.together.xyz/v1/chat/completions',
  'nvidia': 'https://integrate.api.nvidia.com/v1/chat/completions',
  'qwen': 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
  'moonshot': 'https://api.moonshot.cn/v1/chat/completions',
  'zai': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  'google': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
  'anthropic': 'https://api.anthropic.com/v1/messages',
  'codex': 'http://127.0.0.1:18789/v1/chat/completions',
  'claude_code': 'http://127.0.0.1:18789/v1/chat/completions',
  'cli_gemini': 'http://127.0.0.1:18789/v1/chat/completions'
};

async function handleTestChat(event, payload) {
  const { providerId, model, apiKey, baseUrl, prompt } = payload;
  
  if (!apiKey) {
    return { success: false, error: 'API Key is missing.' };
  }
  if (!model) {
    return { success: false, error: 'Model is missing.' };
  }

  let cleanModel = model;
  if (providerId.startsWith('cli_') || ['claude_code', 'codex'].includes(providerId)) {
    // Strip the OpenClaw namespace prefix for direct REST API testing
    if (cleanModel.includes('/')) {
      cleanModel = cleanModel.split('/').pop();
    }
    // Google API does not accept "default", map it to something testable
    if (providerId === 'cli_gemini' && cleanModel === 'default') {
      cleanModel = 'gemini-1.5-flash';
    }
  }

  const activePrompt = prompt || 'Hello! Please reply with exactly: "Hello, I am ready!"';

  let endpoint = baseUrl;
  
  // If no base URL mapped, guess it from provider map
  if (!endpoint) {
    endpoint = PROVIDER_API_MAP[providerId];
  } else {
    // If user provided a base URL but forgot /chat/completions, auto-append for openai-compatible
    if (!endpoint.includes('/chat/completions') && providerId !== 'anthropic') {
      endpoint = endpoint.replace(/\/+$/, '') + '/chat/completions';
    }
  }

  if (!endpoint) {
    return { success: false, error: `No test endpoint configured for provider: ${providerId}` };
  }

  try {
    let body;
    let headers = {
      'Content-Type': 'application/json'
    };

    if (providerId === 'cli_gemini' || providerId === 'codex') {
      const { exec } = require('child_process');
      return new Promise((resolve) => {
        let tokenStr = apiKey;
        if (apiKey.startsWith('{')) {
          try {
            const parsed = JSON.parse(apiKey);
            tokenStr = parsed.access_token || parsed.token || apiKey;
          } catch(e) {}
        }
        
        const safePrompt = activePrompt.replace(/"/g, '\\"');
        const cmd = providerId === 'codex'
          ? `codex exec -c api_key="${tokenStr}" --skip-git-repo-check "${safePrompt}"`
          : `gemini -p "${safePrompt}" -y`;
          
        exec(cmd, { 
          timeout: 30000, 
          env: { ...process.env, GEMINI_API_KEY: tokenStr, GEMINI_CLI_TOKEN: tokenStr } 
        }, (error, stdout, stderr) => {
          if (error) {
            resolve({ success: false, error: stderr || error.message });
          } else {
            resolve({ success: true, text: stdout.trim() });
          }
        });
      });
    }

    if (['anthropic', 'claude_code'].includes(providerId)) {
      // Anthropic format
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model: cleanModel,
        stream: false,
        max_tokens: 1024,
        messages: [{ role: 'user', content: activePrompt }]
      };
    } else {
      // OpenAI-compatible format
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model: cleanModel,
        stream: false,
        messages: [{ role: 'user', content: activePrompt }]
      };
    }

    const response = await makeRequest(endpoint, 'POST', headers, body);
    
    // Parse json
    let jsonResp;
    try {
      jsonResp = JSON.parse(response.data);
    } catch (e) {
      return { success: false, error: `Invalid JSON returned: ${response.data.substring(0, 50)}...` };
    }

    if (response.status !== 200) {
      const errMsg = jsonResp.error?.message || jsonResp.error || JSON.stringify(jsonResp);
      return { success: false, error: `HTTP ${response.status}: ${errMsg}` };
    }

    let reply = '';
    if (['anthropic', 'claude_code'].includes(providerId)) {
      reply = jsonResp.content?.[0]?.text || '';
    } else {
      const msg = jsonResp.choices?.[0]?.message;
      reply = msg?.content || '';
      if (!reply && msg?.reasoning_content) {
        reply = `🤔 [Reasoning...]\n${msg.reasoning_content}`;
      }
    }

    if (!reply) {
      return { success: false, error: `Empty reply received: ${JSON.stringify(jsonResp)}` };
    }

    return { success: true, text: reply.trim() };

  } catch (err) {
    if (err.message.includes('ECONNREFUSED') && err.message.includes('18789') && ['cli_gemini', 'claude_code', 'codex'].includes(providerId)) {
      try {
        const { loadPlatforms } = require('./storage');
        const { spawnPlatform } = require('./processManager');
        let platforms = loadPlatforms();
        if (!platforms || !Array.isArray(platforms)) {
          platforms = [];
        }
        const p = platforms.find(x => x.id === 'openclaw');
        if (p && p.config) {
          spawnPlatform('openclaw', p.config, null);
          return { success: false, error: '⚡ OpenClaw Gateway is Offline. The system is automatically STARTING it in the background (takes 3-5s). Please wait a bit and click Test again!' };
        }
      } catch (autoStartErr) {
        console.error('Failed to auto-start gateway:', autoStartErr);
        return { success: false, error: 'Auto-Start Failed: ' + autoStartErr.message };
      }
      return { success: false, error: 'OpenClaw Gateway is OFF. Please START the Gateway on the main Dashboard before testing the CLI model.' };
    }
    return { success: false, error: `Network error: ${err.message}` };
  }
}

module.exports = { handleTestChat };
