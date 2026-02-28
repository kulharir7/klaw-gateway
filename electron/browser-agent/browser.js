/**
 * browser.js — Core Browser Control for Root AI
 * 
 * Uses puppeteer-core with user's installed Chrome/Edge.
 * Provides: launch, navigate, click, type, read, screenshot, cookies.
 * 
 * Design: ONE browser instance, multiple pages (tabs).
 * All methods are async and throw on failure.
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const path = require('path');
const fs = require('fs');
const os = require('os');
const humanMouse = require('./human-mouse');

// ─── State ───────────────────────────────────────────
let browser = null;
let activePage = null;
const COOKIES_DIR = path.join(os.homedir(), '.root-ai', 'browser-cookies');
const USER_DATA_DIR = path.join(os.homedir(), '.root-ai', 'browser-data');

// ─── Browser Lifecycle ───────────────────────────────

/**
 * Find Chrome or Edge executable on Windows.
 * @returns {string} Path to browser executable
 */
function findBrowserPath() {
  const candidates = [
    // Chrome
    path.join(process.env['PROGRAMFILES'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    // Edge
    path.join(process.env['PROGRAMFILES'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];

  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  throw new Error('Chrome or Edge not found. Please install Google Chrome.');
}

/**
 * Launch browser (or reuse existing).
 * @param {object} [options] - { headless: false, visible: true }
 * @returns {Promise<void>}
 */
async function launch(options = {}) {
  if (browser && browser.connected) return; // already running

  const execPath = findBrowserPath();
  const headless = options.headless === true;

  // Use real Chrome profile if available (bypasses Cloudflare)
  // Otherwise use our own data dir
  const useRealProfile = options.useRealProfile !== false;
  let dataDir = USER_DATA_DIR;
  
  if (useRealProfile) {
    const chromeProfile = path.join(process.env['LOCALAPPDATA'] || '', 'Google', 'Chrome', 'User Data');
    if (fs.existsSync(chromeProfile)) {
      dataDir = chromeProfile;
    }
  }

  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Try to connect to existing Chrome first (if running with --remote-debugging-port)
  if (options.connectExisting) {
    try {
      browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9222',
        defaultViewport: null,
      });
      const pages = await browser.pages();
      activePage = pages[0] || await browser.newPage();
      browser.on('disconnected', () => { browser = null; activePage = null; });
      return;
    } catch (e) { /* not running, launch new */ }
  }

  browser = await puppeteer.launch({
    executablePath: execPath,
    headless: headless ? 'new' : false,
    userDataDir: dataDir,
    defaultViewport: null,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--start-maximized',
      '--disable-features=IsolateOrigins,site-per-process',
      '--flag-switches-begin',
      '--flag-switches-end',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  // Get first page or create one
  const pages = await browser.pages();
  activePage = pages[0] || await browser.newPage();

  // Stealth: hide automation signals
  await applyStealthPatches(activePage);

  // Handle unexpected close
  browser.on('disconnected', () => {
    browser = null;
    activePage = null;
  });
}

/**
 * Close browser.
 */
async function close() {
  if (browser) {
    try { await browser.close(); } catch (e) { /* ignore */ }
    browser = null;
    activePage = null;
  }
}

/**
 * Check if browser is running.
 */
function isRunning() {
  return browser !== null && browser.connected;
}

/**
 * Get active page (launches browser if needed).
 */
async function getPage() {
  if (!browser || !browser.connected) await launch();
  if (!activePage || activePage.isClosed()) {
    const pages = await browser.pages();
    activePage = pages[0] || await browser.newPage();
  }
  return activePage;
}

// ─── Navigation ──────────────────────────────────────

/**
 * Navigate to a URL.
 * @param {string} url - Full URL (https://...)
 * @param {object} [options] - { waitUntil: 'networkidle2', timeout: 30000 }
 */
async function goto(url, options = {}) {
  if (!url) throw new Error('URL is required');
  if (!url.startsWith('http')) url = 'https://' + url;

  const page = await getPage();
  await page.goto(url, {
    waitUntil: options.waitUntil || 'networkidle2',
    timeout: options.timeout || 30000,
  });
}

/**
 * Get current page URL.
 */
async function currentUrl() {
  const page = await getPage();
  return page.url();
}

/**
 * Get page title.
 */
async function getTitle() {
  const page = await getPage();
  return page.title();
}

/**
 * Go back.
 */
async function goBack() {
  const page = await getPage();
  await page.goBack({ waitUntil: 'networkidle2' });
}

/**
 * Go forward.
 */
async function goForward() {
  const page = await getPage();
  await page.goForward({ waitUntil: 'networkidle2' });
}

/**
 * Reload page.
 */
async function reload() {
  const page = await getPage();
  await page.reload({ waitUntil: 'networkidle2' });
}

// ─── Reading Page Content ────────────────────────────

/**
 * Get all visible text from the page.
 * @returns {Promise<string>}
 */
async function getText() {
  const page = await getPage();
  return page.evaluate(() => document.body.innerText);
}

/**
 * Get page HTML.
 * @returns {Promise<string>}
 */
async function getHTML() {
  const page = await getPage();
  return page.content();
}

/**
 * Extract structured data from page using a CSS selector.
 * @param {string} selector - CSS selector
 * @param {string[]} [attrs] - Attributes to extract (default: ['innerText'])
 * @returns {Promise<Array<object>>}
 */
async function extractAll(selector, attrs = ['innerText']) {
  const page = await getPage();
  return page.$$eval(selector, (elements, attributes) => {
    return elements.map(el => {
      const result = {};
      for (const attr of attributes) {
        if (attr === 'innerText') result.text = el.innerText;
        else if (attr === 'innerHTML') result.html = el.innerHTML;
        else if (attr === 'href') result.href = el.href;
        else if (attr === 'src') result.src = el.src;
        else if (attr === 'value') result.value = el.value;
        else result[attr] = el.getAttribute(attr);
      }
      // Always include bounding box for click targets
      const rect = el.getBoundingClientRect();
      result.x = Math.round(rect.x + rect.width / 2);
      result.y = Math.round(rect.y + rect.height / 2);
      return result;
    });
  }, attrs);
}

/**
 * Get all links on the page.
 * @returns {Promise<Array<{ text, href }>>}
 */
async function getLinks() {
  return extractAll('a[href]', ['innerText', 'href']);
}

// ─── Interactions ────────────────────────────────────

/**
 * Click an element.
 * @param {string} selector - CSS selector, or text to find
 * @param {object} [options] - { timeout: 5000 }
 */
async function click(selector, options = {}) {
  const page = await getPage();
  const timeout = options.timeout || 5000;

  // Try CSS selector first — use human-like click
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    await humanMouse.humanClickElement(page, selector, { button: options.button, double: options.double });
    return;
  } catch (e) {
    // If humanClick failed on selector, try text-based
    if (e.message.includes('not found') || e.message.includes('not visible')) {
      // fall through to text search
    } else {
      // Selector found but humanClick had issue — try direct click as fallback
      try {
        await page.click(selector);
        return;
      } catch (e2) { /* fall through */ }
    }
  }

  // Fallback: find by visible text and human-click
  const element = await findByText(selector);
  if (element) {
    const box = await element.boundingBox();
    if (box) {
      await humanMouse.humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
      return;
    }
    await element.click(); // last resort: direct click
    return;
  }

  throw new Error(`Element not found: "${selector}"`);
}

/**
 * Type text into an element.
 * @param {string} selector - CSS selector or text label
 * @param {string} text - Text to type
 * @param {object} [options] - { clear: true, delay: 50 }
 */
async function type(selector, text, options = {}) {
  const page = await getPage();
  const timeout = options.timeout || 5000;

  // Find and click the input field first (human-like)
  let found = false;
  try {
    await page.waitForSelector(selector, { timeout, visible: true });
    await humanMouse.humanClickElement(page, selector);
    found = true;
  } catch (e) {
    // Try by label
    const input = await findInputByLabel(selector);
    if (input) {
      const box = await input.boundingBox();
      if (box) {
        await humanMouse.humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
        found = true;
      }
    }
  }

  if (!found) throw new Error(`Input not found: "${selector}"`);

  // Clear existing text
  if (options.clear !== false) {
    await page.keyboard.down('Control');
    await page.keyboard.press('a');
    await page.keyboard.up('Control');
    await new Promise(r => setTimeout(r, 50));
    await page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 100));
  }

  // Type with human-like speed
  await humanMouse.humanType(page, text, {
    minDelay: options.delay || 30,
    maxDelay: (options.delay || 30) * 3,
    mistakes: options.mistakes !== false,
  });
}

/**
 * Select from dropdown.
 * @param {string} selector - CSS selector of <select>
 * @param {string} value - Value or visible text to select
 */
async function select(selector, value) {
  const page = await getPage();
  try {
    await page.waitForSelector(selector, { timeout: 5000, visible: true });
    await page.select(selector, value);
  } catch (e) {
    throw new Error(`Dropdown not found: "${selector}"`);
  }
}

/**
 * Press a keyboard key or shortcut.
 * @param {string} key - Key name: 'Enter', 'Tab', 'Escape', etc.
 */
async function pressKey(key) {
  const page = await getPage();
  await page.keyboard.press(key);
}

/**
 * Scroll the page.
 * @param {string} [direction='down'] - 'up' or 'down'
 * @param {number} [amount=500] - Pixels to scroll
 */
async function scroll(direction = 'down', amount = 500) {
  const page = await getPage();
  const delta = direction === 'up' ? -amount : amount;
  await humanMouse.humanScroll(page, delta);
}

// ─── Element Finders ─────────────────────────────────

/**
 * Find element by visible text content.
 * @param {string} text - Text to search for
 * @returns {Promise<ElementHandle|null>}
 */
async function findByText(text) {
  const page = await getPage();
  // Try XPath text search
  const escapedText = text.replace(/'/g, "\\'");
  const xpaths = [
    `//*[normalize-space(text())='${escapedText}']`,
    `//*[contains(normalize-space(text()), '${escapedText}')]`,
    `//button[contains(., '${escapedText}')]`,
    `//a[contains(., '${escapedText}')]`,
    `//input[@value='${escapedText}']`,
  ];

  for (const xpath of xpaths) {
    try {
      const [element] = await page.$x(xpath);
      if (element) return element;
    } catch (e) { /* continue */ }
  }
  return null;
}

/**
 * Find input field by its label text.
 * @param {string} labelText - Label text
 * @returns {Promise<ElementHandle|null>}
 */
async function findInputByLabel(labelText) {
  const page = await getPage();
  // Try label[for] → input
  const input = await page.evaluateHandle((text) => {
    const labels = document.querySelectorAll('label');
    for (const label of labels) {
      if (label.innerText.toLowerCase().includes(text.toLowerCase())) {
        if (label.htmlFor) {
          return document.getElementById(label.htmlFor);
        }
        // Label wraps input
        return label.querySelector('input, textarea, select');
      }
    }
    // Try placeholder
    const inputs = document.querySelectorAll('input, textarea');
    for (const inp of inputs) {
      if (inp.placeholder && inp.placeholder.toLowerCase().includes(text.toLowerCase())) {
        return inp;
      }
      if (inp.getAttribute('aria-label')?.toLowerCase().includes(text.toLowerCase())) {
        return inp;
      }
    }
    return null;
  }, labelText);

  const element = input.asElement();
  return element || null;
}

/**
 * Wait for an element to appear.
 * @param {string} selector - CSS selector
 * @param {number} [timeout=10000] - Max wait ms
 */
async function waitFor(selector, timeout = 10000) {
  const page = await getPage();
  await page.waitForSelector(selector, { timeout, visible: true });
}

/**
 * Wait for text to appear on page.
 * @param {string} text - Text to wait for
 * @param {number} [timeout=10000]
 */
async function waitForText(text, timeout = 10000) {
  const page = await getPage();
  await page.waitForFunction(
    (t) => document.body.innerText.includes(t),
    { timeout },
    text
  );
}

// ─── Tabs ────────────────────────────────────────────

/**
 * Open a new tab.
 * @param {string} [url] - Optional URL to navigate to
 * @returns {Promise<void>}
 */
async function newTab(url) {
  if (!browser || !browser.connected) await launch();
  activePage = await browser.newPage();
  await applyStealthPatches(activePage);
  if (url) await goto(url);
}

/**
 * List all open tabs.
 * @returns {Promise<Array<{ index, url, title }>>}
 */
async function listTabs() {
  if (!browser || !browser.connected) return [];
  const pages = await browser.pages();
  const tabs = [];
  for (let i = 0; i < pages.length; i++) {
    tabs.push({
      index: i,
      url: pages[i].url(),
      title: await pages[i].title(),
    });
  }
  return tabs;
}

/**
 * Switch to a tab by index.
 * @param {number} index - Tab index (0-based)
 */
async function switchTab(index) {
  if (!browser || !browser.connected) throw new Error('Browser not running');
  const pages = await browser.pages();
  if (index < 0 || index >= pages.length) throw new Error(`Tab ${index} doesn't exist (${pages.length} tabs open)`);
  activePage = pages[index];
  await activePage.bringToFront();
}

/**
 * Close current tab.
 */
async function closeTab() {
  if (!activePage) return;
  await activePage.close();
  const pages = await browser.pages();
  activePage = pages[pages.length - 1] || null;
  if (activePage) await activePage.bringToFront();
}

// ─── Screenshot ──────────────────────────────────────

/**
 * Take screenshot of current page.
 * @param {object} [options] - { fullPage: false }
 * @returns {Promise<string>} Base64 PNG
 */
async function screenshot(options = {}) {
  const page = await getPage();
  const buffer = await page.screenshot({
    type: 'png',
    fullPage: options.fullPage || false,
    encoding: 'base64',
  });
  return buffer;
}

// ─── Cookies / Session ───────────────────────────────

/**
 * Save cookies for a domain.
 * @param {string} name - Session name (e.g., 'upwork')
 */
async function saveCookies(name) {
  const page = await getPage();
  const cookies = await page.cookies();
  if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });
  const filePath = path.join(COOKIES_DIR, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(cookies, null, 2));
}

/**
 * Load cookies for a domain.
 * @param {string} name - Session name
 * @returns {Promise<boolean>} true if cookies loaded
 */
async function loadCookies(name) {
  const filePath = path.join(COOKIES_DIR, `${name}.json`);
  if (!fs.existsSync(filePath)) return false;

  try {
    const cookies = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const page = await getPage();
    await page.setCookie(...cookies);
    return true;
  } catch (e) {
    return false;
  }
}

// ─── Human-like Delays ──────────────────────────────

/**
 * Wait with random human-like delay.
 * @param {number} min - Minimum ms
 * @param {number} max - Maximum ms
 */
async function humanDelay(min = 500, max = 2000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Stealth Patches ─────────────────────────────────

/**
 * Apply anti-detection patches to a page.
 * Makes puppeteer-controlled browser look like a real user.
 */
async function applyStealthPatches(page) {
  // Realistic user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );

  // Override navigator.webdriver
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  // Override chrome.runtime (present in real Chrome)
  await page.evaluateOnNewDocument(() => {
    window.chrome = { runtime: {}, loadTimes: () => {}, csi: () => {} };
  });

  // Override navigator.plugins (empty = headless detection)
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
        { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
        { name: 'Native Client', filename: 'internal-nacl-plugin' },
      ],
    });
  });

  // Override navigator.languages
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  });

  // Override permissions
  await page.evaluateOnNewDocument(() => {
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === 'notifications'
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters);
  });

  // Set extra HTTP headers
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
  });
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  // Lifecycle
  launch,
  close,
  isRunning,
  getPage,
  // Navigation
  goto,
  currentUrl,
  getTitle,
  goBack,
  goForward,
  reload,
  // Reading
  getText,
  getHTML,
  extractAll,
  getLinks,
  // Interactions
  click,
  type,
  select,
  pressKey,
  scroll,
  // Finders
  findByText,
  findInputByLabel,
  waitFor,
  waitForText,
  // Tabs
  newTab,
  listTabs,
  switchTab,
  closeTab,
  // Screenshot
  screenshot,
  // Cookies
  saveCookies,
  loadCookies,
  // Utility
  humanDelay,
};
