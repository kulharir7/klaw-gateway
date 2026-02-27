/**
 * login-manager.js — Universal Login/Session Manager
 * 
 * Flow:
 * 1. User says "login to upwork" or "login to linkedin"
 * 2. Browser opens login page, user logs in manually
 * 3. We detect login success, save cookies
 * 4. Next time: auto-load cookies, skip login
 * 
 * Supports any website. Stores sessions per domain.
 */

const browser = require('./browser');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const SESSIONS_DIR = path.join(os.homedir(), '.root-ai', 'browser-sessions');

// Known website login URLs and success indicators
const KNOWN_SITES = {
  upwork: {
    loginUrl: 'https://www.upwork.com/ab/account-security/login',
    successIndicators: ['My Jobs', 'Find Work', 'My Stats', '/nx/', '/feed'],
    domain: 'upwork.com',
  },
  linkedin: {
    loginUrl: 'https://www.linkedin.com/login',
    successIndicators: ['Feed', 'My Network', 'messaging', '/feed/'],
    domain: 'linkedin.com',
  },
  indeed: {
    loginUrl: 'https://secure.indeed.com/auth',
    successIndicators: ['My Jobs', 'My Indeed', '/myjobs/'],
    domain: 'indeed.com',
  },
  fiverr: {
    loginUrl: 'https://www.fiverr.com/login',
    successIndicators: ['Dashboard', 'My Business', '/seller_dashboard'],
    domain: 'fiverr.com',
  },
  freelancer: {
    loginUrl: 'https://www.freelancer.com/login',
    successIndicators: ['Dashboard', 'My Projects', '/dashboard'],
    domain: 'freelancer.com',
  },
  github: {
    loginUrl: 'https://github.com/login',
    successIndicators: ['Dashboard', 'Repositories', '/dashboard'],
    domain: 'github.com',
  },
  gmail: {
    loginUrl: 'https://accounts.google.com/signin',
    successIndicators: ['Inbox', 'Compose', 'mail.google.com'],
    domain: 'google.com',
  },
};

class LoginManager extends EventEmitter {
  constructor() {
    super();
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Get list of all saved sessions.
   * @returns {Array<{ name, domain, savedAt, expired }>}
   */
  listSessions() {
    try {
      const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
      return files.map(f => {
        const name = f.replace('.json', '');
        try {
          const data = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8'));
          return {
            name,
            domain: data.domain || name,
            savedAt: data.savedAt || 'unknown',
            cookieCount: data.cookies?.length || 0,
          };
        } catch (e) {
          return { name, domain: name, savedAt: 'error', cookieCount: 0 };
        }
      });
    } catch (e) {
      return [];
    }
  }

  /**
   * Check if a session exists for a site.
   * @param {string} siteName - Site name or domain
   */
  hasSession(siteName) {
    const name = this.normalizeName(siteName);
    return fs.existsSync(path.join(SESSIONS_DIR, `${name}.json`));
  }

  /**
   * Start login flow — opens browser for user to log in manually.
   * Polls for login success automatically.
   * 
   * @param {string} siteName - 'upwork', 'linkedin', or any URL
   * @param {object} [options] - { timeout: 120000, pollInterval: 3000 }
   * @returns {Promise<{ success: boolean, message: string }>}
   * 
   * Events: 'login_page_opened', 'waiting_for_login', 'login_detected', 'login_timeout'
   */
  async login(siteName, options = {}) {
    const timeout = options.timeout || 120000; // 2 minutes
    const pollInterval = options.pollInterval || 3000;
    const name = this.normalizeName(siteName);

    // Get login URL
    let loginUrl;
    let successIndicators;
    const known = KNOWN_SITES[name];
    if (known) {
      loginUrl = known.loginUrl;
      successIndicators = known.successIndicators;
    } else if (siteName.startsWith('http')) {
      loginUrl = siteName;
      successIndicators = []; // will detect by URL change
    } else {
      loginUrl = `https://www.${siteName}/login`;
      successIndicators = [];
    }

    // Launch browser and go to login page
    if (!browser.isRunning()) {
      await browser.launch({ useRealProfile: false });
    }

    await browser.goto(loginUrl, { timeout: 60000, waitUntil: 'domcontentloaded' });
    
    // Wait for Cloudflare if needed
    await this.waitForCloudflare();

    this.emit('login_page_opened', { site: name, url: loginUrl });

    // Poll for login success
    const startTime = Date.now();
    let lastUrl = await browser.currentUrl();

    while (Date.now() - startTime < timeout) {
      await new Promise(r => setTimeout(r, pollInterval));

      try {
        const currentUrl = await browser.currentUrl();
        const text = await browser.getText();

        // Check success indicators
        let loggedIn = false;
        
        if (successIndicators.length > 0) {
          for (const indicator of successIndicators) {
            if (text.includes(indicator) || currentUrl.includes(indicator)) {
              loggedIn = true;
              break;
            }
          }
        } else {
          // Generic detection: URL changed from login page + no password field
          const hasPassword = text.toLowerCase().includes('password') && 
                             (currentUrl.includes('login') || currentUrl.includes('signin'));
          loggedIn = currentUrl !== lastUrl && !hasPassword;
        }

        if (loggedIn) {
          // Save session
          await this.saveSession(name, known?.domain || new URL(loginUrl).hostname);
          this.emit('login_detected', { site: name });
          return { success: true, message: `Logged in to ${name} successfully` };
        }

        this.emit('waiting_for_login', { 
          site: name, 
          elapsed: Math.round((Date.now() - startTime) / 1000),
          url: currentUrl,
        });

      } catch (e) {
        // Page might be loading, continue polling
      }
    }

    this.emit('login_timeout', { site: name });
    return { success: false, message: `Login timeout after ${timeout / 1000}s. Try again.` };
  }

  /**
   * Save current browser session for a site.
   */
  async saveSession(name, domain) {
    const page = await browser.getPage();
    const cookies = await page.cookies();
    
    const sessionData = {
      name,
      domain,
      savedAt: new Date().toISOString(),
      cookies,
      url: await browser.currentUrl(),
    };

    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2));
  }

  /**
   * Load saved session and navigate to site.
   * @param {string} siteName
   * @param {string} [startUrl] - URL to navigate after loading cookies
   * @returns {Promise<boolean>} true if session loaded and still valid
   */
  async loadSession(siteName, startUrl) {
    const name = this.normalizeName(siteName);
    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    
    if (!fs.existsSync(filePath)) return false;

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      if (!browser.isRunning()) {
        await browser.launch({ useRealProfile: false });
      }

      const page = await browser.getPage();
      await page.setCookie(...data.cookies);

      // Navigate to site
      const url = startUrl || data.url || `https://www.${data.domain || name}`;
      await browser.goto(url, { timeout: 30000, waitUntil: 'domcontentloaded' });
      await this.waitForCloudflare();

      // Verify still logged in
      const known = KNOWN_SITES[name];
      if (known) {
        const text = await browser.getText();
        const currentUrl = await browser.currentUrl();
        for (const indicator of known.successIndicators) {
          if (text.includes(indicator) || currentUrl.includes(indicator)) {
            return true;
          }
        }
        // Session might be expired
        return false;
      }

      return true; // assume OK for unknown sites
    } catch (e) {
      return false;
    }
  }

  /**
   * Delete saved session.
   */
  deleteSession(siteName) {
    const name = this.normalizeName(siteName);
    const filePath = path.join(SESSIONS_DIR, `${name}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  /**
   * Auto-login: load session if exists, otherwise start fresh login.
   */
  async autoLogin(siteName, options = {}) {
    const name = this.normalizeName(siteName);
    
    // Try saved session first
    if (this.hasSession(name)) {
      const valid = await this.loadSession(name);
      if (valid) return { success: true, message: `Restored ${name} session` };
      // Session expired, delete and re-login
      this.deleteSession(name);
    }

    // Fresh login
    return this.login(siteName, options);
  }

  /**
   * Wait for Cloudflare challenge.
   */
  async waitForCloudflare(maxWait = 30000) {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const text = await browser.getText();
        if (!text.toLowerCase().includes('cloudflare') && 
            !text.toLowerCase().includes('just a moment') && 
            text.length > 200) {
          return true;
        }
      } catch (e) { /* page loading */ }
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  }

  normalizeName(siteName) {
    return siteName.toLowerCase()
      .replace('https://', '').replace('http://', '').replace('www.', '')
      .replace('.com', '').replace('.org', '').replace('.io', '')
      .split('/')[0].split('.')[0]
      .trim();
  }
}

// Singleton
const loginManager = new LoginManager();

module.exports = loginManager;
