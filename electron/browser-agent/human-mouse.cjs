/**
 * human-mouse.js — Human-like mouse movements and clicks
 * 
 * Simulates real human mouse behavior:
 * - Bezier curve mouse movement (not straight lines)
 * - Random speed variations
 * - Micro-jitter (hand shake)
 * - Natural click timing (press + hold + release)
 * - Hover before click
 * 
 * This fools bot detection systems that track mouse patterns.
 */

/**
 * Move mouse to target with human-like Bezier curve.
 * @param {Page} page - Puppeteer page
 * @param {number} toX - Target X
 * @param {number} toY - Target Y
 * @param {object} [options] - { steps: 25, jitter: true }
 */
async function humanMove(page, toX, toY, options = {}) {
  const steps = options.steps || randomInt(20, 35);
  const jitter = options.jitter !== false;

  // Get current mouse position (or start from random edge)
  const from = await getCurrentMouse(page);
  const fromX = from.x;
  const fromY = from.y;

  // Generate Bezier curve control points (random curve, not straight)
  const cp1x = fromX + (toX - fromX) * randomFloat(0.2, 0.5) + randomInt(-50, 50);
  const cp1y = fromY + (toY - fromY) * randomFloat(0.1, 0.4) + randomInt(-50, 50);
  const cp2x = fromX + (toX - fromX) * randomFloat(0.5, 0.8) + randomInt(-30, 30);
  const cp2y = fromY + (toY - fromY) * randomFloat(0.6, 0.9) + randomInt(-30, 30);

  // Move along Bezier curve
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    
    // Cubic Bezier formula
    const x = bezier(t, fromX, cp1x, cp2x, toX);
    const y = bezier(t, fromY, cp1y, cp2y, toY);

    // Add micro-jitter (hand shake)
    const jx = jitter ? randomInt(-2, 2) : 0;
    const jy = jitter ? randomInt(-2, 2) : 0;

    await page.mouse.move(x + jx, y + jy);

    // Variable speed — slower at start and end (ease in/out)
    const speed = easeInOut(t);
    const delay = Math.max(2, Math.round((1 - speed) * 15 + randomInt(1, 5)));
    await sleep(delay);
  }

  // Final precise move to exact target (no jitter)
  await page.mouse.move(toX, toY);
}

/**
 * Human-like click at coordinates.
 * Moves to target, hovers briefly, then clicks with natural timing.
 * 
 * @param {Page} page - Puppeteer page
 * @param {number} x - Target X
 * @param {number} y - Target Y
 * @param {object} [options] - { button: 'left', double: false }
 */
async function humanClick(page, x, y, options = {}) {
  const button = options.button || 'left';

  // Move to target with human curve
  await humanMove(page, x, y);

  // Brief hover (humans don't click instantly after arriving)
  await sleep(randomInt(50, 200));

  // Click with natural press duration
  await page.mouse.down({ button });
  await sleep(randomInt(30, 100)); // humans hold click for 30-100ms
  await page.mouse.up({ button });

  // Double click if requested
  if (options.double) {
    await sleep(randomInt(60, 120));
    await page.mouse.down({ button });
    await sleep(randomInt(30, 80));
    await page.mouse.up({ button });
  }

  // Small post-click pause (humans don't immediately do next action)
  await sleep(randomInt(100, 300));
}

/**
 * Human-like click on an element (finds center, moves, clicks).
 * 
 * @param {Page} page - Puppeteer page
 * @param {string} selector - CSS selector
 * @param {object} [options]
 */
async function humanClickElement(page, selector, options = {}) {
  const element = await page.$(selector);
  if (!element) throw new Error(`Element not found: ${selector}`);

  const box = await element.boundingBox();
  if (!box) throw new Error(`Element not visible: ${selector}`);

  // Click slightly off-center (humans don't click exact center)
  const x = box.x + box.width * randomFloat(0.3, 0.7);
  const y = box.y + box.height * randomFloat(0.3, 0.7);

  await humanClick(page, x, y, options);
}

/**
 * Human-like typing with variable speed.
 * 
 * @param {Page} page
 * @param {string} text
 * @param {object} [options] - { minDelay: 30, maxDelay: 120, mistakes: true }
 */
async function humanType(page, text, options = {}) {
  const minDelay = options.minDelay || 30;
  const maxDelay = options.maxDelay || 120;
  const mistakes = options.mistakes !== false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    // Occasional typo + backspace (2% chance)
    if (mistakes && Math.random() < 0.02 && i > 0) {
      const wrongChar = String.fromCharCode(char.charCodeAt(0) + randomInt(-2, 2));
      await page.keyboard.type(wrongChar, { delay: 0 });
      await sleep(randomInt(100, 300));
      await page.keyboard.press('Backspace');
      await sleep(randomInt(50, 150));
    }

    await page.keyboard.type(char, { delay: 0 });

    // Variable typing speed
    let delay = randomInt(minDelay, maxDelay);
    
    // Longer pause after space, comma, period
    if (char === ' ' || char === ',' || char === '.') {
      delay += randomInt(20, 80);
    }
    
    // Occasional thinking pause (5% chance)
    if (Math.random() < 0.05) {
      delay += randomInt(200, 500);
    }

    await sleep(delay);
  }
}

/**
 * Human-like scroll.
 * @param {Page} page
 * @param {number} amount - Pixels to scroll (positive = down)
 * @param {object} [options]
 */
async function humanScroll(page, amount, options = {}) {
  const steps = randomInt(3, 8);
  const perStep = amount / steps;

  for (let i = 0; i < steps; i++) {
    const delta = perStep + randomInt(-20, 20);
    await page.mouse.wheel({ deltaY: delta });
    await sleep(randomInt(50, 200));
  }
}

// ─── Helpers ─────────────────────────────────────────

function bezier(t, p0, p1, p2, p3) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCurrentMouse(page) {
  try {
    const pos = await page.evaluate(() => ({
      x: window._mouseX || Math.random() * window.innerWidth * 0.3,
      y: window._mouseY || Math.random() * window.innerHeight * 0.3,
    }));
    return pos;
  } catch (e) {
    return { x: randomInt(100, 400), y: randomInt(100, 300) };
  }
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  humanMove,
  humanClick,
  humanClickElement,
  humanType,
  humanScroll,
};
