/**
 * navigator.js — AI-driven Web Navigation Agent
 * 
 * Takes a high-level goal and navigates the web to accomplish it.
 * Uses browser.js for actions and page-analyzer.js for understanding.
 * 
 * Flow: Goal → Analyze page → AI decides action → Execute → Repeat
 */

const EventEmitter = require('events');
const browser = require('./browser');
const analyzer = require('./page-analyzer');

// ─── Constants ───────────────────────────────────────
const MAX_STEPS = 30;
const HUMAN_DELAY_MIN = 800;
const HUMAN_DELAY_MAX = 2500;

class WebNavigator extends EventEmitter {
  /**
   * @param {object} options
   * @param {function} options.askAI - Function(prompt, context) → string. AI decision maker.
   */
  constructor(options = {}) {
    super();
    this.askAI = options.askAI;
    this.running = false;
    this.steps = [];
    this.stepCount = 0;
  }

  /**
   * Execute a web navigation goal.
   * 
   * @param {string} goal - What to accomplish (e.g., "Search Upwork for React jobs")
   * @returns {Promise<{ success: boolean, result: any, steps: number }>}
   * 
   * Events: 'step', 'done', 'error', 'captcha', 'login_needed'
   */
  async run(goal) {
    if (!this.askAI) throw new Error('askAI function required');
    if (this.running) throw new Error('Navigator already running');

    this.running = true;
    this.steps = [];
    this.stepCount = 0;

    this.emit('start', { goal });

    try {
      // Ensure browser is running
      if (!browser.isRunning()) await browser.launch();

      while (this.running && this.stepCount < MAX_STEPS) {
        this.stepCount++;

        // 1. Analyze current page
        let pageInfo;
        try {
          pageInfo = await analyzer.getPageSummary(2000);
        } catch (e) {
          pageInfo = `ERROR reading page: ${e.message}`;
        }

        // 2. Check for blockers
        const captcha = await analyzer.hasCaptcha().catch(() => false);
        if (captcha) {
          this.emit('captcha', { url: await browser.currentUrl() });
          this.running = false;
          return { success: false, result: 'CAPTCHA detected — needs human intervention', steps: this.stepCount };
        }

        const loginNeeded = await analyzer.requiresLogin().catch(() => false);
        if (loginNeeded && this.stepCount > 2) {
          // Only flag if we didn't just navigate to a login page on purpose
          this.emit('login_needed', { url: await browser.currentUrl() });
        }

        // 3. Ask AI what to do
        const context = this.buildContext(goal, pageInfo);
        let decision;
        try {
          const aiResponse = await this.askAI(NAVIGATOR_PROMPT, context);
          decision = this.parseDecision(aiResponse);
        } catch (e) {
          this.emit('error', { message: `AI error: ${e.message}`, steps: this.stepCount });
          this.running = false;
          return { success: false, result: `AI error: ${e.message}`, steps: this.stepCount };
        }

        this.steps.push(decision);
        this.emit('step', { stepNum: this.stepCount, ...decision });

        // 4. Handle terminal actions
        if (decision.action === 'done') {
          this.running = false;
          this.emit('done', { result: decision.params.result, steps: this.stepCount });
          return { success: true, result: decision.params.result, steps: this.stepCount };
        }
        if (decision.action === 'error') {
          this.running = false;
          this.emit('error', { message: decision.params.message, steps: this.stepCount });
          return { success: false, result: decision.params.message, steps: this.stepCount };
        }

        // 5. Execute action
        try {
          await this.executeAction(decision.action, decision.params);
        } catch (e) {
          this.steps[this.steps.length - 1].thought += ` [FAILED: ${e.message}]`;
          this.emit('step', { stepNum: this.stepCount, thought: `Action failed: ${e.message}`, action: 'error_recovery', params: {} });
        }

        // 6. Human-like delay
        await browser.humanDelay(HUMAN_DELAY_MIN, HUMAN_DELAY_MAX);
      }

      this.running = false;
      return { success: false, result: `Max ${MAX_STEPS} steps reached`, steps: this.stepCount };

    } catch (e) {
      this.running = false;
      return { success: false, result: e.message, steps: this.stepCount };
    }
  }

  /**
   * Build context string for AI.
   */
  buildContext(goal, pageInfo) {
    let ctx = `GOAL: ${goal}\n\nCURRENT PAGE:\n${pageInfo}`;
    if (this.steps.length > 0) {
      const recent = this.steps.slice(-5);
      ctx += `\n\nPREVIOUS STEPS (last ${recent.length} of ${this.steps.length}):`;
      recent.forEach((s, i) => {
        ctx += `\n${this.steps.length - recent.length + i + 1}. [${s.action}] ${s.thought}`;
      });
    }
    return ctx;
  }

  /**
   * Parse AI response into action.
   */
  parseDecision(response) {
    let text = response.trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { thought: 'Failed to parse AI response', action: 'error', params: { message: text.substring(0, 200) } };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.action) return { thought: 'No action', action: 'error', params: { message: 'Missing action' } };
      return {
        thought: parsed.thought || '',
        action: parsed.action,
        params: parsed.params || {},
      };
    } catch (e) {
      return { thought: 'Parse error', action: 'error', params: { message: e.message } };
    }
  }

  /**
   * Execute a navigation action.
   */
  async executeAction(action, params) {
    switch (action) {
      case 'goto':
        await browser.goto(params.url);
        break;
      case 'click':
        await browser.click(params.selector || params.text);
        break;
      case 'type':
        await browser.type(params.selector || params.field, params.text);
        break;
      case 'press_key':
        await browser.pressKey(params.key);
        break;
      case 'scroll':
        await browser.scroll(params.direction || 'down', params.amount || 500);
        break;
      case 'back':
        await browser.goBack();
        break;
      case 'new_tab':
        await browser.newTab(params.url);
        break;
      case 'switch_tab':
        await browser.switchTab(params.index);
        break;
      case 'close_tab':
        await browser.closeTab();
        break;
      case 'wait':
        await new Promise(r => setTimeout(r, params.ms || 2000));
        break;
      case 'save_cookies':
        await browser.saveCookies(params.name || 'default');
        break;
      case 'load_cookies':
        await browser.loadCookies(params.name || 'default');
        break;
      case 'extract':
        // Extract data and store in result — AI will use 'done' with it
        const items = await analyzer.extractItems(params.selector, params.fields || {});
        this.lastExtractedData = items;
        break;
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  stop() { this.running = false; }
}

// ─── System Prompt ───────────────────────────────────
const NAVIGATOR_PROMPT = `You are Root AI's Web Navigator. You browse websites to accomplish goals.

You receive the current page analysis and must decide the NEXT action.

RESPOND WITH EXACTLY ONE JSON OBJECT:

{"thought":"what you see and plan","action":"<action>","params":{...}}

ACTIONS:
- goto:        {"url":"https://..."} — Navigate to URL
- click:       {"text":"button text"} or {"selector":"#id"} — Click element
- type:        {"field":"Search","text":"React developer"} — Type in input (field = label/placeholder/selector)
- press_key:   {"key":"Enter"} — Press keyboard key
- scroll:      {"direction":"down","amount":500} — Scroll page
- back:        {} — Go back
- new_tab:     {"url":"https://..."} — Open new tab
- switch_tab:  {"index":0} — Switch to tab
- close_tab:   {} — Close current tab
- wait:        {"ms":2000} — Wait for page load
- save_cookies: {"name":"upwork"} — Save session
- load_cookies: {"name":"upwork"} — Restore session
- extract:     {"selector":".job-card","fields":{"title":"h3","budget":".budget"}} — Extract data
- done:        {"result":"extracted data or summary"} — Goal accomplished!
- error:       {"message":"why failed"} — Cannot complete goal

STRATEGY:
- Read the page summary carefully before acting
- Use form labels/placeholders to identify input fields
- Click buttons by their visible text
- After typing in search, press Enter
- Wait after navigation for page to load
- If page has CAPTCHA, report error
- If login needed, try loading saved cookies first
- Extract structured data when goal asks for information
- Use "done" with the result when goal is accomplished`;

// ─── Exports ─────────────────────────────────────────
module.exports = { WebNavigator, NAVIGATOR_PROMPT };
