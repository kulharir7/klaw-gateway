/**
 * page-analyzer.js — AI-powered Page Understanding for Root AI
 * 
 * Reads a webpage and extracts structured information:
 * - Page type (search results, job listing, form, article, etc.)
 * - Interactive elements (buttons, links, inputs)
 * - Key content (titles, descriptions, prices, dates)
 * - Available actions (what can the user do on this page?)
 */

const browser = require('./browser');

// ─── Page Structure Extraction ───────────────────────

/**
 * Analyze current page and return structured summary.
 * This gives the AI everything it needs to understand the page.
 * @returns {Promise<object>} Page analysis result
 */
async function analyzePage() {
  const page = await browser.getPage();

  const analysis = await page.evaluate(() => {
    const result = {
      url: window.location.href,
      title: document.title,
      type: 'unknown',
      content: {},
      forms: [],
      buttons: [],
      links: [],
      inputs: [],
      images: [],
      meta: {},
    };

    // ─── Detect page type ───
    const url = window.location.href.toLowerCase();
    const text = document.body.innerText.toLowerCase();

    if (url.includes('search') || document.querySelector('[role="search"]') || 
        document.querySelector('input[type="search"]')) {
      result.type = 'search';
    } else if (url.includes('login') || url.includes('signin') || 
               text.includes('sign in') || text.includes('log in')) {
      result.type = 'login';
    } else if (url.includes('signup') || url.includes('register')) {
      result.type = 'signup';
    } else if (document.querySelectorAll('form').length > 0 && 
               document.querySelectorAll('input').length > 3) {
      result.type = 'form';
    } else if (url.includes('job') || url.includes('career') || 
               text.includes('apply now') || text.includes('job description')) {
      result.type = 'job_listing';
    } else if (url.includes('checkout') || url.includes('cart') || text.includes('add to cart')) {
      result.type = 'ecommerce';
    } else if (document.querySelector('article') || document.querySelector('[role="article"]')) {
      result.type = 'article';
    } else if (document.querySelectorAll('table').length > 0) {
      result.type = 'data_table';
    } else {
      result.type = 'general';
    }

    // ─── Extract main content ───
    // Headings
    const headings = [];
    document.querySelectorAll('h1, h2, h3').forEach(h => {
      const t = h.innerText.trim();
      if (t && t.length < 200) headings.push({ level: h.tagName, text: t });
    });
    result.content.headings = headings.slice(0, 20);

    // Main text (first 2000 chars)
    const mainEl = document.querySelector('main, article, [role="main"], .content, #content');
    const mainText = (mainEl || document.body).innerText.trim();
    result.content.text = mainText.substring(0, 2000);

    // ─── Forms ───
    document.querySelectorAll('form').forEach((form, i) => {
      if (i >= 5) return; // max 5 forms
      const formData = {
        id: form.id || `form_${i}`,
        action: form.action || '',
        method: form.method || 'GET',
        inputs: [],
      };
      form.querySelectorAll('input, textarea, select').forEach(inp => {
        const type = inp.type || inp.tagName.toLowerCase();
        if (type === 'hidden') return;
        formData.inputs.push({
          type,
          name: inp.name || '',
          placeholder: inp.placeholder || '',
          label: findLabel(inp),
          value: inp.value || '',
          required: inp.required,
        });
      });
      if (formData.inputs.length > 0) result.forms.push(formData);
    });

    // ─── Buttons ───
    document.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]').forEach(btn => {
      const text = btn.innerText?.trim() || btn.value || btn.getAttribute('aria-label') || '';
      if (!text || text.length > 100) return;
      const rect = btn.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      result.buttons.push({
        text,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
        selector: getUniqueSelector(btn),
      });
    });
    result.buttons = result.buttons.slice(0, 30);

    // ─── Links (top 30 visible) ───
    document.querySelectorAll('a[href]').forEach(a => {
      const text = a.innerText?.trim();
      if (!text || text.length > 200) return;
      const rect = a.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      result.links.push({
        text,
        href: a.href,
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      });
    });
    result.links = result.links.slice(0, 30);

    // ─── Input fields (standalone, outside forms) ───
    document.querySelectorAll('input, textarea, select').forEach(inp => {
      if (inp.closest('form')) return; // skip form inputs (already captured)
      if (inp.type === 'hidden') return;
      const rect = inp.getBoundingClientRect();
      if (rect.width <= 0) return;
      result.inputs.push({
        type: inp.type || inp.tagName.toLowerCase(),
        name: inp.name || '',
        placeholder: inp.placeholder || '',
        label: findLabel(inp),
        selector: getUniqueSelector(inp),
        x: Math.round(rect.x + rect.width / 2),
        y: Math.round(rect.y + rect.height / 2),
      });
    });
    result.inputs = result.inputs.slice(0, 20);

    // ─── Meta info ───
    result.meta.language = document.documentElement.lang || '';
    result.meta.description = document.querySelector('meta[name="description"]')?.content || '';
    result.meta.canonical = document.querySelector('link[rel="canonical"]')?.href || '';

    // ─── Helper functions ───
    function findLabel(input) {
      // Check for associated label
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) return label.innerText.trim();
      }
      // Check parent label
      const parentLabel = input.closest('label');
      if (parentLabel) return parentLabel.innerText.trim();
      // Check aria-label
      return input.getAttribute('aria-label') || '';
    }

    function getUniqueSelector(el) {
      if (el.id) return `#${el.id}`;
      if (el.name) return `[name="${el.name}"]`;
      // Build a simple path
      const tag = el.tagName.toLowerCase();
      const cls = el.className ? '.' + el.className.split(' ').filter(c => c).join('.') : '';
      const idx = Array.from(el.parentNode?.children || []).indexOf(el);
      return `${tag}${cls}:nth-child(${idx + 1})`;
    }

    return result;
  });

  return analysis;
}

/**
 * Get a concise text summary of the page (for AI context).
 * Keeps it under maxChars to save tokens.
 * @param {number} [maxChars=3000]
 * @returns {Promise<string>}
 */
async function getPageSummary(maxChars = 3000) {
  const a = await analyzePage();
  
  let summary = `PAGE: ${a.title}\nURL: ${a.url}\nTYPE: ${a.type}\n`;
  
  if (a.content.headings.length > 0) {
    summary += `\nHEADINGS:\n`;
    a.content.headings.forEach(h => {
      summary += `  ${h.level}: ${h.text}\n`;
    });
  }

  if (a.forms.length > 0) {
    summary += `\nFORMS:\n`;
    a.forms.forEach(f => {
      summary += `  Form "${f.id}": ${f.inputs.map(i => `${i.label || i.name || i.placeholder}(${i.type})`).join(', ')}\n`;
    });
  }

  if (a.buttons.length > 0) {
    summary += `\nBUTTONS: ${a.buttons.map(b => `"${b.text}"`).join(', ')}\n`;
  }

  if (a.inputs.length > 0) {
    summary += `\nINPUTS: ${a.inputs.map(i => `${i.label || i.placeholder || i.name}(${i.type})`).join(', ')}\n`;
  }

  if (a.links.length > 0) {
    summary += `\nLINKS (${a.links.length}): ${a.links.slice(0, 15).map(l => `"${l.text}"`).join(', ')}`;
    if (a.links.length > 15) summary += ` ... +${a.links.length - 15} more`;
    summary += '\n';
  }

  // Add main text if space remains
  const remaining = maxChars - summary.length;
  if (remaining > 200 && a.content.text) {
    summary += `\nCONTENT:\n${a.content.text.substring(0, remaining - 20)}\n`;
  }

  return summary.substring(0, maxChars);
}

/**
 * Extract data from page as structured list items.
 * AI-friendly: returns array of objects with consistent keys.
 * Good for job listings, search results, product lists, etc.
 * 
 * @param {string} itemSelector - CSS selector for each item container
 * @param {object} fieldMap - { fieldName: 'cssSelector' } mapping
 * @returns {Promise<Array<object>>}
 */
async function extractItems(itemSelector, fieldMap) {
  const page = await browser.getPage();
  
  return page.$$eval(itemSelector, (items, fields) => {
    return items.map(item => {
      const result = {};
      for (const [key, selector] of Object.entries(fields)) {
        const el = item.querySelector(selector);
        if (el) {
          result[key] = el.innerText?.trim() || el.getAttribute('href') || el.getAttribute('src') || '';
        } else {
          result[key] = '';
        }
      }
      // Add link if item is or contains a link
      const link = item.querySelector('a[href]') || (item.tagName === 'A' ? item : null);
      if (link && !result.link) result.link = link.href;
      return result;
    });
  }, fieldMap);
}

/**
 * Detect if page has a CAPTCHA.
 * @returns {Promise<boolean>}
 */
async function hasCaptcha() {
  const page = await browser.getPage();
  return page.evaluate(() => {
    const html = document.documentElement.innerHTML.toLowerCase();
    return html.includes('captcha') || 
           html.includes('recaptcha') || 
           html.includes('hcaptcha') ||
           html.includes('cf-challenge') || // Cloudflare
           html.includes('challenge-form') ||
           !!document.querySelector('iframe[src*="captcha"]') ||
           !!document.querySelector('iframe[src*="challenge"]') ||
           !!document.querySelector('.g-recaptcha') ||
           !!document.querySelector('.h-captcha');
  });
}

/**
 * Detect if page requires login.
 * @returns {Promise<boolean>}
 */
async function requiresLogin() {
  const page = await browser.getPage();
  return page.evaluate(() => {
    const url = window.location.href.toLowerCase();
    const text = document.body.innerText.toLowerCase();
    return url.includes('login') || url.includes('signin') || url.includes('auth') ||
           (text.includes('sign in') && text.includes('password')) ||
           (text.includes('log in') && text.includes('password')) ||
           !!document.querySelector('input[type="password"]');
  });
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  analyzePage,
  getPageSummary,
  extractItems,
  hasCaptcha,
  requiresLogin,
};
