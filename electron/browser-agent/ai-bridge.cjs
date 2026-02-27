/**
 * ai-bridge.js — Connects Web Agent to Root AI's gateway AI provider
 * 
 * Uses the same multi-fallback approach as computer-use/vision.js:
 * 1. Direct API key from env/config
 * 2. Gateway HTTP endpoint
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const os = require('os');

const ROOT_CONFIG = path.join(os.homedir(), '.root-ai', 'root.json');
const GATEWAY_PORT = 18790;

/**
 * Call AI with system prompt + user message.
 * Used by WebNavigator for decision making.
 * 
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @returns {Promise<string>} AI response text
 */
async function callGatewayForWebAgent(systemPrompt, userMessage) {
  const config = getAIConfig();

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  switch (config.provider) {
    case 'anthropic':
      return callAnthropic(config, systemPrompt, userMessage);
    case 'openai':
      return callOpenAI(config, messages);
    case 'google':
      return callGoogle(config, systemPrompt, userMessage);
    default:
      // Use gateway CLI (handles OAuth tokens)
      return callGatewayCLI(systemPrompt, userMessage);
  }
}

function getAIConfig() {
  // Check env vars
  if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-oat')) {
    return { provider: 'anthropic', apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514' };
  }
  if (process.env.OPENAI_API_KEY) {
    return { provider: 'openai', apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4o', baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com' };
  }
  if (process.env.GOOGLE_API_KEY) {
    return { provider: 'google', apiKey: process.env.GOOGLE_API_KEY, model: process.env.GOOGLE_MODEL || 'gemini-2.0-flash' };
  }

  // Check root.json
  try {
    const raw = fs.readFileSync(ROOT_CONFIG, 'utf8');
    const config = JSON.parse(raw);
    
    // Check env section
    const env = config.env || {};
    if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.startsWith('sk-ant-oat')) {
      return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514' };
    }
    if (env.OPENAI_API_KEY) {
      return { provider: 'openai', apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4o', baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com' };
    }
    if (env.GOOGLE_API_KEY) {
      return { provider: 'google', apiKey: env.GOOGLE_API_KEY, model: env.GOOGLE_MODEL || 'gemini-2.0-flash' };
    }

    // Check providers section
    const providers = config.providers || {};
    if (providers.anthropic?.apiKey) {
      return { provider: 'anthropic', apiKey: providers.anthropic.apiKey, model: providers.anthropic.model || 'claude-sonnet-4-20250514' };
    }
    if (providers.openai?.apiKey) {
      return { provider: 'openai', apiKey: providers.openai.apiKey, model: providers.openai.model || 'gpt-4o', baseUrl: providers.openai.baseUrl || 'https://api.openai.com' };
    }
  } catch (e) { /* no config */ }

  return { provider: 'gateway' };
}

// ─── Provider Calls ──────────────────────────────────

async function callAnthropic(config, systemPrompt, userMessage) {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 1000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  return httpRequest({
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
  }, body, (data) => {
    const json = JSON.parse(data);
    if (json.error) throw new Error(json.error.message);
    return json.content?.[0]?.text || '';
  });
}

async function callOpenAI(config, messages) {
  const url = new URL(config.baseUrl || 'https://api.openai.com');
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 1000,
    messages,
  });

  return httpRequest({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
  }, body, (data) => {
    const json = JSON.parse(data);
    if (json.error) throw new Error(json.error.message);
    return json.choices?.[0]?.message?.content || '';
  }, url.protocol === 'http:');
}

async function callGoogle(config, systemPrompt, userMessage) {
  const body = JSON.stringify({
    contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
    generationConfig: { maxOutputTokens: 1000 },
  });

  return httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body, (data) => {
    const json = JSON.parse(data);
    if (json.error) throw new Error(json.error.message);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  });
}

async function callGatewayCLI(systemPrompt, userMessage) {
  // Use root.mjs CLI to make AI calls (handles OAuth tokens properly)
  const { execFile } = require('child_process');

  // Find root.mjs
  const candidates = [
    path.join(__dirname, '..', '..', 'root.mjs'),
    path.join(__dirname, '..', 'gateway', 'root.mjs'),
    path.join(os.homedir(), '.root-ai', 'root.mjs'),
  ];
  // Also check for openclaw
  candidates.push(
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(os.homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', 'openclaw', 'src', 'entry.js'),
  );

  let cliPath = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { cliPath = p; break; }
  }
  if (!cliPath) throw new Error('Gateway CLI not found');

  // Find node
  const nodePaths = ['C:\\Program Files\\nodejs\\node.exe', '/usr/local/bin/node', '/usr/bin/node'];
  let nodeBin = 'node';
  for (const p of nodePaths) {
    if (fs.existsSync(p)) { nodeBin = p; break; }
  }

  const message = `${systemPrompt}\n\n${userMessage}\n\nRespond with ONLY the JSON object, no other text.`;

  return new Promise((resolve, reject) => {
    const args = [
      '--disable-warning=ExperimentalWarning',
      cliPath, 'agent', '--local',
      '--session-id', 'web-agent',
      '--json',
      '--message', message,
    ];

    const env = {
      ...process.env,
      Root_NO_RESPAWN: '1',
      Root_NODE_OPTIONS_READY: '1',
    };

    execFile(nodeBin, args, {
      cwd: path.dirname(cliPath),
      env,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new Error(`CLI error: ${err.message}`));
        return;
      }

      // Parse JSON output
      try {
        const jsonMatch = stdout.match(/\{[\s\S]*"payloads"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const text = parsed.payloads?.[0]?.text || '';
          resolve(text);
          return;
        }
      } catch (e) {}

      // Fallback: return raw stdout
      resolve(stdout.trim());
    });
  });
}

function getGatewayToken() {
  const configs = [
    ROOT_CONFIG,
    path.join(os.homedir(), '.openclaw', 'config.json'),
  ];
  for (const p of configs) {
    try {
      const config = JSON.parse(fs.readFileSync(p, 'utf8'));
      const token = config.gateway?.auth?.token || config.auth?.token || config.gateway?.token || '';
      if (token) return token;
    } catch (e) { /* continue */ }
  }
  return '';
}

// ─── HTTP Helper ─────────────────────────────────────
function httpRequest(options, body, parseResponse, useHttp = false) {
  return new Promise((resolve, reject) => {
    const lib = useHttp ? http : https;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(parseResponse(data)); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('AI request timeout (60s)')); });
    req.write(body);
    req.end();
  });
}

module.exports = { callGatewayForWebAgent, getAIConfig };
