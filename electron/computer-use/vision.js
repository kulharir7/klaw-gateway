/**
 * vision.js — AI Vision for Korvus Computer Use
 * 
 * Takes a screenshot (base64), sends to AI with the user's goal,
 * and gets back a structured action to execute.
 * 
 * Uses the Korvus gateway API (port 18790) to make AI calls,
 * so it automatically uses whatever AI provider the user configured.
 * Also supports direct API calls if env vars are set.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// ─── Config ──────────────────────────────────────────
const ROOT_STATE_DIR = path.join(require('os').homedir(), '.korvus');
const ROOT_CONFIG = path.join(ROOT_STATE_DIR, 'root.json');
const GATEWAY_PORT = 18790;

/**
 * Read AI config. Priority:
 * 1. Environment variables (ANTHROPIC_API_KEY, OPENAI_API_KEY)
 * 2. root.json providers section
 * 3. Gateway API (uses gateway's configured provider)
 */
function getAIConfig() {
  // Check environment variables first (skip OAuth tokens — they don't work for direct API)
  if (process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-oat')) {
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      baseUrl: 'https://api.anthropic.com',
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com',
    };
  }
  if (process.env.GOOGLE_API_KEY) {
    return {
      provider: 'google',
      apiKey: process.env.GOOGLE_API_KEY,
      model: process.env.GOOGLE_MODEL || 'gemini-2.0-flash',
      baseUrl: 'https://generativelanguage.googleapis.com',
    };
  }
  
  // Check root.json for direct provider config
  try {
    const raw = fs.readFileSync(ROOT_CONFIG, 'utf8');
    const config = JSON.parse(raw);
    const providers = config.providers || {};
    
    if (providers.anthropic?.apiKey) {
      return { provider: 'anthropic', apiKey: providers.anthropic.apiKey, model: providers.anthropic.model || 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com' };
    }
    if (providers.openai?.apiKey) {
      return { provider: 'openai', apiKey: providers.openai.apiKey, model: providers.openai.model || 'gpt-4o', baseUrl: providers.openai.baseUrl || 'https://api.openai.com' };
    }
    if (providers.google?.apiKey) {
      return { provider: 'google', apiKey: providers.google.apiKey, model: providers.google.model || 'gemini-2.0-flash', baseUrl: 'https://generativelanguage.googleapis.com' };
    }
    if (providers.ollama) {
      return { provider: 'ollama', apiKey: '', model: providers.ollama.model || 'llava', baseUrl: providers.ollama.baseUrl || 'http://localhost:11434' };
    }
  } catch (e) { /* no config or parse error — fall through */ }
  
  // Check OpenClaw auth-profiles.json (works for both Korvus and OpenClaw)
  const authPaths = [
    path.join(ROOT_STATE_DIR, 'agents', 'main', 'agent', 'auth-profiles.json'),
    path.join(require('os').homedir(), '.openclaw', 'agents', 'main', 'agent', 'auth-profiles.json'),
  ];
  for (const authPath of authPaths) {
    try {
      const raw = fs.readFileSync(authPath, 'utf8');
      const auth = JSON.parse(raw);
      const profiles = auth.profiles || {};
      
      // Check anthropic profiles (skip OAuth tokens — they don't work for direct API)
      for (const [key, prof] of Object.entries(profiles)) {
        if (prof.provider === 'anthropic' && prof.token && !prof.token.startsWith('sk-ant-oat')) {
          return { provider: 'anthropic', apiKey: prof.token, model: 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com' };
        }
      }
      // Check openai profiles  
      for (const [key, prof] of Object.entries(profiles)) {
        if ((prof.provider === 'openai' || prof.provider === 'openai-codex') && prof.access) {
          return { provider: 'openai', apiKey: prof.access, model: 'gpt-4o', baseUrl: 'https://api.openai.com' };
        }
      }
    } catch (e) { /* no auth file — continue */ }
  }
  
  // Fallback: use gateway API (Korvus on 18790, or OpenClaw on 18789)
  const gatewayPort = findRunningGateway();
  return { provider: 'gateway', apiKey: getGatewayToken(), model: '', baseUrl: `http://127.0.0.1:${gatewayPort}` };
}

/**
 * Read gateway auth token from config files.
 */
function getGatewayToken() {
  const configs = [
    ROOT_CONFIG,
    path.join(require('os').homedir(), '.openclaw', 'config.json'),
  ];
  for (const configPath of configs) {
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      const token = config.gateway?.auth?.token || config.auth?.token || config.gateway?.token || '';
      if (token) return token;
    } catch (e) { /* continue */ }
  }
  return '';
}

/**
 * Find which gateway port is running (Korvus 18790 or OpenClaw 18789).
 */
function findRunningGateway() {
  const net = require('net');
  // Check Korvus first, then OpenClaw
  for (const port of [18790, 18789]) {
    try {
      const sock = new net.Socket();
      sock.setTimeout(200);
      const result = new Promise((resolve) => {
        sock.on('connect', () => { sock.destroy(); resolve(true); });
        sock.on('error', () => { sock.destroy(); resolve(false); });
        sock.on('timeout', () => { sock.destroy(); resolve(false); });
        sock.connect(port, '127.0.0.1');
      });
      // Sync check — use execSync
    } catch (e) { /* continue */ }
  }
  // Simple sync check using execSync
  const { execSync } = require('child_process');
  for (const port of [18790, 18789]) {
    try {
      execSync(`powershell -NoProfile -Command "(New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', ${port})"`, 
        { timeout: 1000, stdio: 'ignore' });
      return port;
    } catch (e) { /* port not open */ }
  }
  return GATEWAY_PORT; // default
}

// ─── System Prompt ───────────────────────────────────
const SYSTEM_PROMPT = `You are Korvus's Computer Use agent controlling a Windows desktop.

You see a screenshot and must decide the NEXT SINGLE ACTION toward the user's goal.

OUTPUT: Exactly one JSON object. No markdown, no explanation, no extra text.

{"thought":"what I see + plan","action":"<action>","params":{...}}

ACTIONS:
- click:     {"x":int,"y":int,"button":"left|right|double"} — Click at exact pixel coordinates
- drag:      {"x1":int,"y1":int,"x2":int,"y2":int} — Drag from point A to B
- type:      {"text":"string"} — Type text (click target field first!)
- key:       {"combo":"ctrl+a"} — Keyboard shortcut (ctrl+c, alt+f4, enter, tab, escape, win, etc)
- scroll:    {"direction":"up|down","amount":3} — Scroll mouse wheel
- open_app:  {"name":"notepad|chrome|explorer|code|calc|cmd|powershell"} — Launch app via Start menu
- open_url:  {"url":"https://..."} — Open URL in default browser
- find_and_click: {"text":"button name","button":"left"} — Find UI element by label and click it (PREFER THIS over click when you can read a button/link/menu name!)
- window:    {"action":"minimize|maximize|restore|close|snap_left|snap_right"} — Manage active window
- wait:      {"ms":2000,"reason":"page loading"} — Wait for something to happen
- done:      {"summary":"what was accomplished"} — Goal complete!
- error:     {"message":"reason"} — Goal impossible

COORDINATE RULES (CRITICAL):
- Screen origin (0,0) is TOP-LEFT corner
- X increases going RIGHT, Y increases going DOWN
- To click a button/link: aim for its CENTER, not its edge
- Taskbar is at the BOTTOM (~40px from bottom edge)
- Title bar buttons (minimize/maximize/close) are TOP-RIGHT corner
- For text input: click the field FIRST, then type in next step
- Double-check coordinates against the resolution provided

STRATEGY:
- Prefer keyboard shortcuts over clicking when possible:
  * Ctrl+L = browser address bar
  * Ctrl+T = new browser tab
  * Ctrl+W = close tab
  * Alt+Tab = switch apps
  * Win+E = File Explorer
  * Win+D = show desktop
  * Ctrl+A = select all, Ctrl+C = copy, Ctrl+V = paste
- After opening an app/URL, use "wait" (1-2s) for it to load
- If a click didn't work (screen unchanged in next step), try:
  1. Different coordinates (maybe you missed)
  2. Double-click instead of single
  3. Keyboard shortcut alternative
- Always verify your action worked by checking the next screenshot
- Break complex goals into small steps

SAFETY:
- NEVER type passwords, credit card numbers, or sensitive data
- NEVER interact with banking/payment sites
- If you see a login page you can't bypass, report error
- If unsure, report error rather than guess`;

// ─── API Calls ───────────────────────────────────────

/**
 * Send screenshot + goal to AI and get back a structured action.
 * 
 * @param {string} screenshotBase64 - PNG screenshot as base64
 * @param {string} goal - User's goal description
 * @param {string[]} [history] - Previous thoughts for context
 * @param {{ width: number, height: number }} [screenSize] - Screen resolution
 * @returns {Promise<{ thought: string, action: string, params: object }>}
 */
async function analyzeScreen(screenshotBase64, goal, history = [], screenSize = { width: 1920, height: 1080 }, uiElements = []) {
  const config = getAIConfig();
  
  const userContent = buildUserMessage(goal, history, screenSize, uiElements);
  
  let response;
  switch (config.provider) {
    case 'anthropic':
      response = await callAnthropic(config, screenshotBase64, userContent);
      break;
    case 'openai':
      response = await callOpenAI(config, screenshotBase64, userContent);
      break;
    case 'google':
      response = await callGoogle(config, screenshotBase64, userContent);
      break;
    case 'ollama':
      response = await callOllama(config, screenshotBase64, userContent);
      break;
    case 'gateway':
      response = await callGateway(config, screenshotBase64, userContent);
      break;
    default:
      throw new Error(`Unsupported provider: ${config.provider}`);
  }
  
  return parseAction(response);
}

function buildUserMessage(goal, history, screenSize, uiElements) {
  let msg = `GOAL: ${goal}\nSCREEN: ${screenSize.width}x${screenSize.height} pixels`;
  if (history.length > 0) {
    const recent = history.slice(-5);
    const offset = history.length - recent.length;
    msg += `\n\nPREVIOUS STEPS (${history.length} total, showing last ${recent.length}):`;
    msg += `\n${recent.map((h, i) => `${offset + i + 1}. ${h}`).join('\n')}`;
  }
  if (uiElements && uiElements.length > 0) {
    msg += `\n\nUI ELEMENTS (type|centerX|centerY|name):`;
    // Show top 30 elements to keep prompt small
    const top = uiElements.slice(0, 30);
    msg += `\n${top.map(e => `${e.type}|${e.x}|${e.y}|${e.name}`).join('\n')}`;
    msg += `\n\nTip: Use find_and_click with the element name for reliable clicking.`;
  }
  msg += '\n\nLook at the screenshot. What is the next single action? Respond with JSON only.';
  return msg;
}

/**
 * Parse AI response into structured action.
 * Handles edge cases: markdown wrapping, extra text, etc.
 */
function parseAction(responseText) {
  // Strip markdown code blocks if present
  let text = responseText.trim();
  text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
  
  // Try to extract JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      thought: 'Failed to parse AI response',
      action: 'error',
      params: { message: `AI returned non-JSON: ${text.substring(0, 200)}` },
    };
  }
  
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate required fields
    if (!parsed.action) {
      return { thought: parsed.thought || 'No action', action: 'error', params: { message: 'AI response missing "action" field' } };
    }
    
    const validActions = ['click', 'drag', 'type', 'key', 'scroll', 'open_app', 'open_url', 'find_and_click', 'window', 'wait', 'done', 'error'];
    if (!validActions.includes(parsed.action)) {
      return { thought: parsed.thought || '', action: 'error', params: { message: `Unknown action: ${parsed.action}` } };
    }
    
    return {
      thought: parsed.thought || '',
      action: parsed.action,
      params: parsed.params || {},
    };
  } catch (e) {
    return {
      thought: 'JSON parse error',
      action: 'error',
      params: { message: `Failed to parse JSON: ${e.message}. Raw: ${text.substring(0, 200)}` },
    };
  }
}

// ─── Provider: Anthropic ─────────────────────────────
async function callAnthropic(config, screenshotBase64, userContent) {
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } },
        { type: 'text', text: userContent },
      ],
    }],
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
    if (json.error) throw new Error(`Anthropic error: ${json.error.message}`);
    return json.content?.[0]?.text || '';
  });
}

// ─── Provider: OpenAI ────────────────────────────────
async function callOpenAI(config, screenshotBase64, userContent) {
  const url = new URL(config.baseUrl || 'https://api.openai.com');
  
  const body = JSON.stringify({
    model: config.model,
    max_tokens: 500,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}`, detail: 'high' } },
          { type: 'text', text: userContent },
        ],
      },
    ],
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
    if (json.error) throw new Error(`OpenAI error: ${json.error.message}`);
    return json.choices?.[0]?.message?.content || '';
  }, url.protocol === 'http:');
}

// ─── Provider: Google (Gemini) ───────────────────────
async function callGoogle(config, screenshotBase64, userContent) {
  const body = JSON.stringify({
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/png', data: screenshotBase64 } },
        { text: `${SYSTEM_PROMPT}\n\n${userContent}` },
      ],
    }],
    generationConfig: { maxOutputTokens: 500 },
  });
  
  return httpRequest({
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body, (data) => {
    const json = JSON.parse(data);
    if (json.error) throw new Error(`Google error: ${json.error.message}`);
    return json.candidates?.[0]?.content?.parts?.[0]?.text || '';
  });
}

// ─── Provider: Ollama (Local) ────────────────────────
async function callOllama(config, screenshotBase64, userContent) {
  const url = new URL(config.baseUrl || 'http://localhost:11434');
  
  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: userContent,
        images: [screenshotBase64],
      },
    ],
    stream: false,
  });
  
  return httpRequest({
    hostname: url.hostname,
    port: url.port || 11434,
    path: '/api/chat',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  }, body, (data) => {
    const json = JSON.parse(data);
    return json.message?.content || '';
  }, true); // Ollama is http
}

// ─── Provider: Gateway (via gateway's HTTP API) ─────────────────────
async function callGateway(config, screenshotBase64, userContent) {
  const gatewayPort = findRunningGateway();
  const token = config.apiKey || getGatewayToken();
  
  // Try 1: Use gateway CLI agent (handles OAuth tokens properly)
  try {
    const result = await callGatewayCLI(gatewayPort, token, screenshotBase64, userContent);
    return result;
  } catch (e) {
    console.error('[Vision] Gateway CLI failed:', e.message);
  }
  
  // Try 3: Read API key from root.json env section and call provider directly
  try {
    const directConfig = getDirectAPIConfig();
    if (directConfig) {
      switch (directConfig.provider) {
        case 'anthropic':
          return await callAnthropic(directConfig, screenshotBase64, userContent);
        case 'openai':
          return await callOpenAI(directConfig, screenshotBase64, userContent);
        case 'google':
          return await callGoogle(directConfig, screenshotBase64, userContent);
      }
    }
  } catch (e) {
    console.error('[Vision] Direct API call failed:', e.message);
  }
  
  throw new Error('Computer Use needs an AI provider. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY in Korvus Config → Environment.');
}

/**
 * Read API keys from root.json env section (not auth profiles).
 */
function getDirectAPIConfig() {
  try {
    const raw = fs.readFileSync(ROOT_CONFIG, 'utf8');
    const config = JSON.parse(raw);
    const env = config.env || {};
    
    if (env.ANTHROPIC_API_KEY && !env.ANTHROPIC_API_KEY.startsWith('sk-ant-oat')) {
      return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514', baseUrl: 'https://api.anthropic.com' };
    }
    if (env.OPENAI_API_KEY) {
      return { provider: 'openai', apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4o', baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com' };
    }
    if (env.GOOGLE_API_KEY) {
      return { provider: 'google', apiKey: env.GOOGLE_API_KEY, model: env.GOOGLE_MODEL || 'gemini-2.0-flash', baseUrl: '' };
    }
  } catch (e) { /* no config */ }
  return null;
}

/**
 * Call gateway via WebSocket to analyze screenshot.
 * Uses the gateway's built-in AI provider (handles OAuth tokens properly).
 */
async function callGatewayWebSocket(port, token, screenshotBase64, userContent) {
  const WebSocket = require('ws');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error('Gateway WebSocket timeout (30s)'));
      }
    }, 30000);
    
    ws.on('error', (err) => {
      if (!resolved) { resolved = true; clearTimeout(timeout); reject(err); }
    });
    
    ws.on('open', () => {
      // Authenticate
      ws.send(JSON.stringify({
        type: 'connect',
        token: token,
        client: 'computer-use-vision',
        mode: 'api',
      }));
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        
        // After hello-ok, send image analysis request
        if (msg.type === 'hello-ok') {
          const requestId = 'cu-' + Date.now();
          ws.send(JSON.stringify({
            type: 'req',
            id: requestId,
            method: 'image.analyze',
            params: {
              image: `data:image/png;base64,${screenshotBase64}`,
              prompt: `${SYSTEM_PROMPT}\n\n${userContent}`,
              model: 'default',
            },
          }));
        }
        
        // Handle response
        if (msg.type === 'res' && !resolved) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          
          if (msg.error) {
            reject(new Error(`Gateway error: ${msg.error.message || JSON.stringify(msg.error)}`));
          } else {
            const result = msg.result?.text || msg.result?.content || msg.result || '';
            resolve(typeof result === 'string' ? result : JSON.stringify(result));
          }
        }
      } catch (e) {
        // Ignore parse errors for non-JSON messages
      }
    });
    
    ws.on('close', () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        reject(new Error('Gateway WebSocket closed unexpectedly'));
      }
    });
  });
}

/**
 * Call gateway via CLI `root.mjs agent` command.
 * Saves screenshot to temp, tells agent to use the `image` tool to analyze it.
 * This handles OAuth tokens since the gateway manages auth internally.
 */
async function callGatewayCLI(port, token, screenshotBase64, userContent) {
  const { execFile } = require('child_process');
  const os = require('os');
  
  // Find root.mjs
  const candidates = [
    path.join(__dirname, '..', '..', 'root.mjs'),
    path.join(os.homedir(), '.openclaw', 'workspace', 'korvus', 'root.mjs'),
    path.join(os.homedir(), 'korvus', 'root.mjs'),
  ];
  let rootMjs = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) { rootMjs = p; break; }
  }
  if (!rootMjs) throw new Error('root.mjs not found');
  
  // Find node binary
  const nodePaths = ['C:\\Program Files\\nodejs\\node.exe', '/usr/local/bin/node', '/usr/bin/node'];
  let nodeBin = 'node';
  for (const p of nodePaths) {
    if (fs.existsSync(p)) { nodeBin = p; break; }
  }
  
  // Save screenshot to temp file so agent can use `image` tool on it
  const tmpFile = path.join(os.tmpdir(), `rootai-cu-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from(screenshotBase64, 'base64'));
  
  // Build the message: tell agent to analyze the screenshot using the image tool
  // and respond with a specific JSON format
  const message = [
    'You are a Computer Use agent. Use the `image` tool to analyze the screenshot at:',
    tmpFile,
    '',
    'Then respond with EXACTLY ONE JSON object (no markdown, no extra text):',
    '{"thought":"what you see","action":"click|type|key|scroll|open_app|open_url|wait|done|error","params":{...}}',
    '',
    'ACTION PARAMS:',
    '- click: {"x":number,"y":number}',
    '- type: {"text":"string"}',
    '- key: {"combo":"ctrl+c"}',
    '- scroll: {"direction":"up|down","amount":3}',
    '- open_app: {"name":"notepad|chrome|code"}',
    '- open_url: {"url":"https://..."}',
    '- wait: {"ms":1000}',
    '- done: {"summary":"what was done"}',
    '- error: {"message":"why failed"}',
    '',
    userContent,
  ].join('\n');
  
  return new Promise((resolve, reject) => {
    const args = [
      '--disable-warning=ExperimentalWarning',
      rootMjs, 'agent', '--local',
      '--session-id', 'computer-use',
      '--json',
      '--message', message,
    ];
    
    const env = {
      ...process.env,
      Root_NO_RESPAWN: '1',
      Root_NODE_OPTIONS_READY: '1',
    };
    
    execFile(nodeBin, args, {
      cwd: path.dirname(rootMjs),
      env,
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      // Clean up temp file
      try { fs.unlinkSync(tmpFile); } catch (e) {}
      
      if (err && !stdout) {
        reject(new Error(`Gateway CLI error: ${err.message}`));
        return;
      }
      
      // Parse JSON output — look for payloads
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

// ─── HTTP Helper ─────────────────────────────────────
function httpRequest(options, body, parseResponse, useHttp = false) {
  return new Promise((resolve, reject) => {
    const lib = useHttp ? http : https;
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(parseResponse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('AI request timed out (30s)'));
    });
    
    req.write(body);
    req.end();
  });
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  analyzeScreen,
  getAIConfig,
  parseAction,
  SYSTEM_PROMPT,
};
