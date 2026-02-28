/**
 * upwork.js — Upwork-specific automation module
 * 
 * Strategy:
 * 1. User logs in manually once (browser opens, they login)
 * 2. We save cookies after login
 * 3. All subsequent visits use saved cookies (bypasses Cloudflare)
 * 4. Job search, proposals, messaging — all via real browser with cookies
 * 
 * Also supports Upwork RSS feeds for job search (no login needed).
 */

const browser = require('./browser');
const analyzer = require('./page-analyzer');
const fs = require('fs');
const path = require('path');
const https = require('https');

const UPWORK_BASE = 'https://www.upwork.com';
const COOKIE_NAME = 'upwork';

// ─── Login Flow ──────────────────────────────────────

/**
 * Check if we have saved Upwork cookies.
 */
function hasSavedSession() {
  const cookiePath = path.join(require('os').homedir(), '.root-ai', 'browser-cookies', `${COOKIE_NAME}.json`);
  return fs.existsSync(cookiePath);
}

/**
 * Open Upwork login page for user to manually log in.
 * After login, saves cookies automatically.
 * 
 * @returns {Promise<boolean>} true if login successful
 */
async function startLogin() {
  await browser.launch({ useRealProfile: false });
  await browser.goto(`${UPWORK_BASE}/ab/account-security/login`, { timeout: 60000, waitUntil: 'domcontentloaded' });
  
  // Wait for Cloudflare
  await waitForCloudflare();

  // Return — user will manually log in
  // The calling code should poll isLoggedIn() to detect completion
  return true;
}

/**
 * Check if user is currently logged in on the open page.
 */
async function isLoggedIn() {
  try {
    const text = await browser.getText();
    const url = await browser.currentUrl();
    // After login, Upwork redirects to dashboard or feed
    return url.includes('/nx/') || url.includes('/ab/find-work') || 
           url.includes('/feed') || url.includes('/home') ||
           text.includes('My Jobs') || text.includes('Find Work') ||
           text.includes('My Stats');
  } catch (e) {
    return false;
  }
}

/**
 * Save current session cookies.
 */
async function saveSession() {
  await browser.saveCookies(COOKIE_NAME);
}

/**
 * Load saved session and verify it works.
 * @returns {Promise<boolean>}
 */
async function loadSession() {
  if (!hasSavedSession()) return false;
  
  await browser.launch({ useRealProfile: false });
  const loaded = await browser.loadCookies(COOKIE_NAME);
  if (!loaded) return false;

  // Navigate to Upwork to test cookies
  await browser.goto(UPWORK_BASE, { timeout: 60000, waitUntil: 'domcontentloaded' });
  await waitForCloudflare();

  return await isLoggedIn();
}

// ─── Job Search ──────────────────────────────────────

/**
 * Search for jobs using Indeed (public, no login needed).
 * Fallback when Upwork blocks direct access.
 * 
 * @param {string} query - Search query
 * @param {string} [location='remote'] - Location filter
 * @returns {Promise<Array<{ title, company, location, description, link }>>}
 */
async function searchJobsPublic(query, location = 'remote') {
  if (!browser.isRunning()) await browser.launch({ useRealProfile: false });
  
  const url = `https://www.indeed.com/jobs?q=${encodeURIComponent(query)}&l=${encodeURIComponent(location)}`;
  await browser.goto(url, { timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const page = await browser.getPage();
  const jobs = await page.evaluate(() => {
    const cards = document.querySelectorAll('.job_seen_beacon, .resultContent, [data-testid="slider_item"]');
    return Array.from(cards).slice(0, 20).map(card => {
      const titleEl = card.querySelector('h2 a, .jobTitle a, [data-testid="jobTitle"]');
      const companyEl = card.querySelector('[data-testid="company-name"], .companyName, .company');
      const locEl = card.querySelector('[data-testid="text-location"], .companyLocation');
      const descEl = card.querySelector('.job-snippet, [data-testid="jobDescriptionText"], .underShelfFooter');
      const linkEl = card.querySelector('a[href*="/viewjob"], a[href*="/rc/"]');
      
      return {
        title: titleEl?.innerText?.trim() || '',
        company: companyEl?.innerText?.trim() || '',
        location: locEl?.innerText?.trim() || '',
        description: descEl?.innerText?.trim()?.substring(0, 300) || '',
        link: linkEl ? 'https://www.indeed.com' + (linkEl.getAttribute('href') || '') : '',
      };
    }).filter(j => j.title);
  });

  // Deduplicate by title
  const seen = new Set();
  return jobs.filter(j => {
    if (seen.has(j.title)) return false;
    seen.add(j.title);
    return true;
  });
}

/**
 * Search jobs via browser (requires login/cookies).
 * More detailed results than RSS.
 * 
 * @param {string} query
 * @returns {Promise<Array<object>>}
 */
async function searchJobsBrowser(query) {
  if (!browser.isRunning()) {
    const sessionOk = await loadSession();
    if (!sessionOk) throw new Error('Not logged in. Call startLogin() first.');
  }

  const url = `${UPWORK_BASE}/nx/search/jobs/?q=${encodeURIComponent(query)}&sort=recency`;
  await browser.goto(url, { timeout: 30000 });
  await waitForCloudflare();
  
  // Extract job cards
  const page = await browser.getPage();
  const jobs = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-test="job-tile-list"] > div, article, .job-tile');
    return Array.from(cards).map(card => {
      const title = card.querySelector('h2, h3, [data-test="job-tile-title"]')?.innerText?.trim() || '';
      const desc = card.querySelector('[data-test="UpCLineClamp JobDescription"], .job-description, p')?.innerText?.trim() || '';
      const budget = card.querySelector('[data-test="budget"], .budget, [data-test="is-fixed-price"]')?.innerText?.trim() || '';
      const skills = Array.from(card.querySelectorAll('[data-test="token"], .skill-tag, .air3-token')).map(s => s.innerText.trim());
      const link = card.querySelector('a[href*="/jobs/"]')?.href || '';
      const posted = card.querySelector('[data-test="posted-on"], .posted-on, time')?.innerText?.trim() || '';
      
      return { title, description: desc.substring(0, 300), budget, skills, link, posted };
    }).filter(j => j.title);
  });

  return jobs;
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Wait for Cloudflare challenge to pass (poll every 3s, max 30s).
 */
async function waitForCloudflare(maxWaitMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const text = await browser.getText();
    if (!text.toLowerCase().includes('cloudflare') && !text.toLowerCase().includes('just a moment') && text.length > 200) {
      return true;
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  return false; // timeout
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  // Session
  hasSavedSession,
  startLogin,
  isLoggedIn,
  saveSession,
  loadSession,
  // Job search
  searchJobsPublic,
  searchJobsBrowser,
  // Helpers
  waitForCloudflare,
};
