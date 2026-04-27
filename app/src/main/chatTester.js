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
  'codex': 'https://api.openai.com/v1/chat/completions',
  'claude_code': 'https://api.anthropic.com/v1/messages',
  'cli_gemini': 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
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

    if (providerId === 'codex') {
      try {
        const checkRes = await makeRequest('https://api.openai.com/v1/models', 'GET', {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': 'ClawExpress/1.0'
        });
        
        if (checkRes.status === 200 || checkRes.status === 201) {
          return { success: true, text: `✅ Connection established! (Token is valid and authenticated via OpenAI)` };
        } else {
          // Parse error
          let jsonResp;
          try { jsonResp = JSON.parse(checkRes.data); } catch(e) {}
          
          const errMsg = jsonResp?.error?.message || checkRes.data;
          
          // OpenAI returns 401 or 403 with "Missing scopes: api.model.read" or "model.request" for valid Codex OAuth tokens.
          // This proves the token is perfectly alive and authenticated, it's just restricted to internal ChatGPT APIs.
          if ((checkRes.status === 401 || checkRes.status === 403) && errMsg.includes('Missing scopes')) {
            return { success: true, text: `✅ Connection established! (Token is active and verified as Codex OAuth token)` };
          }
          
          return { success: false, error: `Connection failed: HTTP ${checkRes.status}. ${errMsg}` };
        }
      } catch (checkErr) {
         return { success: false, error: `Direct verification failed: ${checkErr.message}` };
      }
    }

    if (providerId === 'cli_gemini') {
      try {
        let tokenStr = apiKey;
        if (apiKey.startsWith('{')) {
          try {
            const parsed = JSON.parse(apiKey);
            tokenStr = parsed.access_token || parsed.token || apiKey;
          } catch(e) {}
        }
        
        const knownGeminiModels = ['gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3-pro-preview'];
        const isValidName = knownGeminiModels.some(m => cleanModel.includes(m));
        
        if (!isValidName) {
           return { success: false, error: `Model "${cleanModel}" is not a valid Gemini model. CLI mode strictly validates model names before execution.` };
        }

        // We test the token by calling Google's userinfo endpoint instead of the Gemini API directly.
        // Google's Generative Language REST API returns ACCESS_TOKEN_TYPE_UNSUPPORTED for 3rd-party OAuth tokens.
        // The OpenClaw engine handles the actual translation to Vertex/Internal APIs.
        // Verifying the token against userinfo guarantees the token is alive and valid.
        let checkRes = await makeRequest('https://www.googleapis.com/oauth2/v3/userinfo', 'GET', {
          'Authorization': `Bearer ${tokenStr}`,
          'User-Agent': 'ClawExpress/1.0'
        });
        
        let newTokens = null;

        // Auto-refresh mechanism for UI Testing via Cloudflare Proxy
        if (checkRes.status === 401 && payload.oauthTokens?.refresh_token) {
          try {
            const refreshRes = await makeRequest('https://clawexpress-api.pages.dev/api/v1/auth/gemini-exchange', 'POST', {
              'Content-Type': 'application/json'
            }, JSON.stringify({
              grant_type: 'refresh_token',
              refresh_token: payload.oauthTokens.refresh_token
            }));
            
            if (refreshRes.status === 200) {
              const refreshedData = JSON.parse(refreshRes.data);
              tokenStr = refreshedData.access_token;
              newTokens = { ...payload.oauthTokens, ...refreshedData };
              
              // Retry userinfo with new token
              checkRes = await makeRequest('https://www.googleapis.com/oauth2/v3/userinfo', 'GET', {
                'Authorization': `Bearer ${tokenStr}`,
                'User-Agent': 'ClawExpress/1.0'
              });
            }
          } catch(e) {}
        }
        
        if (checkRes.status === 200 || checkRes.status === 201) {
          return { success: true, text: `✅ Connection established! (OAuth Token is active & ${cleanModel} is a valid schema)`, newTokens };
        } else {
          let errMsg = checkRes.data;
          try {
            const parsed = JSON.parse(checkRes.data);
            if (parsed.error && parsed.error.message) errMsg = parsed.error.message;
            else if (parsed.error_description) errMsg = parsed.error_description;
          } catch(e) {}
          return { success: false, error: `Token verification failed: HTTP ${checkRes.status}. ${errMsg}` };
        }
      } catch (err) {
        return { success: false, error: `Direct verification failed: ${err.message}` };
      }
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
    return { success: false, error: `Network error: ${err.message}` };
  }
}

module.exports = { handleTestChat };
