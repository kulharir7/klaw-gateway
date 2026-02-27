/**
 * vault.js — Security Vault for Korvus Computer Use
 * 
 * Protects user's sensitive data:
 * - Blocks specific apps from AI control
 * - Blocks sensitive websites
 * - Detects and blocks sensitive text input (passwords, card numbers)
 * - Safety modes: full-auto, ask-before, watch-only
 * 
 * Config stored in ~/.korvus/vault.json
 */

const fs = require('fs');
const path = require('path');

const ROOT_STATE_DIR = path.join(require('os').homedir(), '.korvus');
const VAULT_FILE = path.join(ROOT_STATE_DIR, 'vault.json');

// ─── Default Config ──────────────────────────────────
const DEFAULT_VAULT = {
  // Apps that AI cannot see or control
  blockedApps: [
    'KeePass', 'KeePassXC', '1Password', 'Bitwarden', 'LastPass',
    'keepass', 'keepassxc', '1password', 'bitwarden', 'lastpass',
  ],
  
  // Websites AI cannot navigate to
  blockedSites: [
    '*.bank.*', '*.banking.*', 'paypal.com', 'razorpay.com',
    'stripe.com', 'pay.google.com', 'wallet.google.com',
    'onlinebanking.*', 'netbanking.*',
    // Indian banks
    'onlinesbi.sbi', 'hdfcbank.com', 'icicibank.com', 'axisbank.com',
    'kotak.com', 'pnbindia.in', 'bankofindia.co.in',
  ],
  
  // Keywords AI must NEVER type
  blockedKeywords: [
    'password', 'passwd', 'secret', 'cvv', 'pin', 'otp',
    'credit card', 'debit card', 'card number', 'expiry',
    'ssn', 'social security', 'aadhaar', 'pan card',
  ],
  
  // Safety mode: 'full-auto' | 'ask-before' | 'watch-only'
  safetyMode: 'ask-before',
  
  // Auto-protections
  neverSaveScreenshots: true,   // Screenshots stay in RAM only
  maxStepsPerTask: 25,          // Force stop after N steps
  
  // Confirmation required for these actions
  requireConfirmation: [
    'send', 'submit', 'post', 'publish', 'delet', 'remov',
    'pay', 'purchase', 'buy', 'checkout', 'transfer',
  ],
};

// ─── Load/Save ───────────────────────────────────────

/**
 * Load vault config. Creates default if doesn't exist.
 * @returns {object} Vault config
 */
function loadVault() {
  try {
    const raw = fs.readFileSync(VAULT_FILE, 'utf8');
    const saved = JSON.parse(raw);
    // Merge with defaults (saved overrides defaults)
    return { ...DEFAULT_VAULT, ...saved };
  } catch (e) {
    // First run — create default vault
    saveVault(DEFAULT_VAULT);
    return { ...DEFAULT_VAULT };
  }
}

/**
 * Save vault config to disk.
 * @param {object} config
 */
function saveVault(config) {
  if (!fs.existsSync(ROOT_STATE_DIR)) {
    fs.mkdirSync(ROOT_STATE_DIR, { recursive: true });
  }
  fs.writeFileSync(VAULT_FILE, JSON.stringify(config, null, 2), 'utf8');
}

// ─── Checks ──────────────────────────────────────────

/**
 * Check if an app is blocked.
 * @param {string} processName - Active window process name
 * @returns {{ blocked: boolean, reason: string }}
 */
function checkApp(processName) {
  if (!processName) return { blocked: false, reason: '' };
  
  const vault = loadVault();
  const lower = processName.toLowerCase();
  
  for (const blocked of vault.blockedApps) {
    if (lower === blocked.toLowerCase() || lower.includes(blocked.toLowerCase())) {
      return { 
        blocked: true, 
        reason: `App "${processName}" is blocked by Security Vault (password manager / sensitive app)` 
      };
    }
  }
  
  return { blocked: false, reason: '' };
}

/**
 * Check if a URL is blocked.
 * @param {string} url - URL to check
 * @returns {{ blocked: boolean, reason: string }}
 */
function checkUrl(url) {
  if (!url) return { blocked: false, reason: '' };
  
  const vault = loadVault();
  const lower = url.toLowerCase();
  
  for (const pattern of vault.blockedSites) {
    const regex = patternToRegex(pattern);
    if (regex.test(lower)) {
      return { 
        blocked: true, 
        reason: `Website "${url}" is blocked by Security Vault (banking / payment site)` 
      };
    }
  }
  
  return { blocked: false, reason: '' };
}

/**
 * Check if text contains blocked keywords (password, card number, etc.)
 * @param {string} text - Text AI wants to type
 * @returns {{ blocked: boolean, reason: string }}
 */
function checkText(text) {
  if (!text) return { blocked: false, reason: '' };
  
  const vault = loadVault();
  const lower = text.toLowerCase();
  
  // Check blocked keywords
  for (const keyword of vault.blockedKeywords) {
    if (lower.includes(keyword.toLowerCase())) {
      return { 
        blocked: true, 
        reason: `Text contains sensitive keyword "${keyword}" — AI cannot type this` 
      };
    }
  }
  
  // Check for credit card number pattern (13-19 digits)
  if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{1,7}\b/.test(text)) {
    return { blocked: true, reason: 'Text appears to contain a credit/debit card number' };
  }
  
  // Check for Aadhaar pattern (12 digits)
  if (/\b\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) {
    return { blocked: true, reason: 'Text appears to contain an Aadhaar number' };
  }
  
  return { blocked: false, reason: '' };
}

/**
 * Check if an action needs user confirmation.
 * @param {string} thought - AI's thought about what it's doing
 * @param {string} action - Action type
 * @param {object} params - Action params
 * @returns {{ needsConfirmation: boolean, reason: string }}
 */
function checkConfirmation(thought, action, params) {
  const vault = loadVault();
  
  if (vault.safetyMode === 'full-auto') {
    return { needsConfirmation: false, reason: '' };
  }
  
  if (vault.safetyMode === 'watch-only') {
    return { needsConfirmation: true, reason: 'Watch-only mode: all actions need confirmation' };
  }
  
  // ask-before mode: check if action matches confirmation keywords
  const thoughtLower = (thought || '').toLowerCase();
  
  for (const keyword of vault.requireConfirmation) {
    if (thoughtLower.includes(keyword)) {
      return { 
        needsConfirmation: true, 
        reason: `Action involves "${keyword}" — confirmation required` 
      };
    }
  }
  
  // Always confirm clicks on buttons with destructive text
  if (action === 'click' && thought) {
    const destructive = ['delete', 'remove', 'send', 'submit', 'post', 'publish', 'pay', 'confirm order'];
    for (const d of destructive) {
      if (thoughtLower.includes(d)) {
        return { needsConfirmation: true, reason: `Clicking "${d}" button — confirmation required` };
      }
    }
  }
  
  return { needsConfirmation: false, reason: '' };
}

/**
 * Run all security checks before an action.
 * @param {object} decision - { thought, action, params }
 * @param {string} activeWindowProcess - Current active window process
 * @returns {{ allowed: boolean, reason: string, needsConfirmation: boolean, confirmReason: string }}
 */
function checkAction(decision, activeWindowProcess = '') {
  const { thought, action, params } = decision;
  
  // Check blocked app
  const appCheck = checkApp(activeWindowProcess);
  if (appCheck.blocked) {
    return { allowed: false, reason: appCheck.reason, needsConfirmation: false, confirmReason: '' };
  }
  
  // Check blocked URL
  if (action === 'open_url' && params.url) {
    const urlCheck = checkUrl(params.url);
    if (urlCheck.blocked) {
      return { allowed: false, reason: urlCheck.reason, needsConfirmation: false, confirmReason: '' };
    }
  }
  
  // Check blocked text
  if (action === 'type' && params.text) {
    const textCheck = checkText(params.text);
    if (textCheck.blocked) {
      return { allowed: false, reason: textCheck.reason, needsConfirmation: false, confirmReason: '' };
    }
  }
  
  // Check confirmation needed
  const confirmCheck = checkConfirmation(thought, action, params);
  
  return { 
    allowed: true, 
    reason: '', 
    needsConfirmation: confirmCheck.needsConfirmation, 
    confirmReason: confirmCheck.reason 
  };
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Convert glob-like pattern to regex.
 * Supports * as wildcard.
 */
function patternToRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const withWildcard = escaped.replace(/\*/g, '.*');
  return new RegExp(withWildcard, 'i');
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  loadVault,
  saveVault,
  checkApp,
  checkUrl,
  checkText,
  checkConfirmation,
  checkAction,
  DEFAULT_VAULT,
};

