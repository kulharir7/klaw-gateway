/**
 * agent.js — Computer Use Agent Loop for Korvus
 * 
 * Takes a user goal, then runs the loop:
 *   Screenshot → AI Vision → Execute Action → Repeat → Done
 * 
 * Emits events for UI updates (step progress, errors, completion).
 */

const EventEmitter = require('events');
const screen = require('./screen.cjs');
const vision = require('./vision.cjs');

// ─── Constants ───────────────────────────────────────
const MAX_STEPS = 25;           // Safety: max actions before force-stop
const WAIT_AFTER_ACTION = 800;  // ms to wait after each action for screen to settle
const WAIT_AFTER_OPEN = 2000;   // ms to wait after opening app/url
const WAIT_AFTER_CLICK = 500;   // ms to wait after click
const MAX_ACTION_RETRIES = 2;   // Retry failed actions
const MAX_AI_RETRIES = 2;       // Retry failed AI calls
const MAX_SCREENSHOT_RETRIES = 2; // Retry failed screenshots

class ComputerUseAgent extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this.paused = false;
    this.goal = '';
    this.steps = [];     // history of { thought, action, params }
    this.stepCount = 0;
    this.lastScreenshotHash = '';
    this.sameScreenCount = 0;
  }

  /**
   * Run the agent loop for a given goal.
   * 
   * @param {string} goal - What the user wants to accomplish
   * @returns {Promise<{ success: boolean, summary: string, steps: number }>}
   * 
   * Events emitted:
   *   'step'    - { stepNum, thought, action, params }
   *   'done'    - { summary, steps }
   *   'error'   - { message, steps }
   *   'stopped' - { reason, steps }
   */
  async run(goal) {
    if (this.running) throw new Error('Agent already running');
    if (!goal || goal.trim().length === 0) throw new Error('No goal provided');
    
    this.running = true;
    this.paused = false;
    this.goal = goal.trim();
    this.steps = [];
    this.stepCount = 0;
    this.lastScreenshotHash = '';
    this.sameScreenCount = 0;

    this.emit('start', { goal: this.goal });

    try {
      const screenSize = screen.getScreenSize();
      
      while (this.running && this.stepCount < MAX_STEPS) {
        // Check pause
        while (this.paused && this.running) {
          await screen.wait(200);
        }
        if (!this.running) break;
        
        // Step 1: Take screenshot (with retry)
        let screenshotB64;
        for (let attempt = 0; attempt <= MAX_SCREENSHOT_RETRIES; attempt++) {
          try {
            screenshotB64 = await screen.screenshot();
            break;
          } catch (e) {
            if (attempt === MAX_SCREENSHOT_RETRIES) {
              this.emit('error', { message: `Screenshot failed after ${attempt + 1} attempts: ${e.message}`, steps: this.stepCount });
              return { success: false, summary: `Screenshot failed: ${e.message}`, steps: this.stepCount };
            }
            await screen.wait(500); // brief pause before retry
          }
        }

        // Stuck detection: simple hash of screenshot length + first/last bytes
        const ssHash = screenshotB64.length + ':' + screenshotB64.substring(0, 100) + screenshotB64.substring(screenshotB64.length - 100);
        if (ssHash === this.lastScreenshotHash) {
          this.sameScreenCount++;
          if (this.sameScreenCount >= 3) {
            const msg = 'Stuck: screen unchanged after 3 attempts. Stopping.';
            this.emit('error', { message: msg, steps: this.stepCount });
            this.running = false;
            return { success: false, summary: msg, steps: this.stepCount };
          }
        } else {
          this.sameScreenCount = 0;
        }
        this.lastScreenshotHash = ssHash;

        // Step 1.5: Get UI elements (best-effort, don't fail if unavailable)
        let uiElements = [];
        try {
          uiElements = await screen.listElements();
        } catch (e) { /* UI Automation may fail on some apps — that's OK */ }

        // Step 2: Send to AI (with retry)
        const history = this.steps.map(s => s.thought);
        let decision;
        for (let attempt = 0; attempt <= MAX_AI_RETRIES; attempt++) {
          try {
            decision = await vision.analyzeScreen(screenshotB64, this.goal, history, screenSize, uiElements);
            break;
          } catch (e) {
            if (attempt === MAX_AI_RETRIES) {
              this.emit('error', { message: `AI analysis failed after ${attempt + 1} attempts: ${e.message}`, steps: this.stepCount });
              return { success: false, summary: `AI analysis failed: ${e.message}`, steps: this.stepCount };
            }
            this.emit('step', { stepNum: this.stepCount, thought: `AI call failed (retry ${attempt + 1}): ${e.message}`, action: 'retry', params: {} });
            await screen.wait(1000); // wait before retry
          }
        }

        // Free screenshot from memory immediately
        screenshotB64 = null;

        this.stepCount++;
        this.steps.push(decision);
        this.emit('step', { stepNum: this.stepCount, ...decision });

        // Step 3: Check terminal actions
        if (decision.action === 'done') {
          const summary = decision.params?.summary || 'Goal completed';
          this.emit('done', { summary, steps: this.stepCount });
          this.running = false;
          return { success: true, summary, steps: this.stepCount };
        }

        if (decision.action === 'error') {
          const message = decision.params?.message || 'Unknown error';
          this.emit('error', { message, steps: this.stepCount });
          this.running = false;
          return { success: false, summary: message, steps: this.stepCount };
        }

        // Step 4: Execute the action (with retry)
        let actionSuccess = false;
        for (let attempt = 0; attempt <= MAX_ACTION_RETRIES; attempt++) {
          try {
            await this.executeAction(decision.action, decision.params);
            actionSuccess = true;
            break;
          } catch (e) {
            if (attempt === MAX_ACTION_RETRIES) {
              // All retries failed — let AI see next screenshot and adapt
              this.emit('step', {
                stepNum: this.stepCount,
                thought: `Action "${decision.action}" failed after ${attempt + 1} attempts: ${e.message}`,
                action: 'error_recovery',
                params: {}
              });
              // Add failure info to history so AI knows
              this.steps[this.steps.length - 1].thought += ` [FAILED: ${e.message}]`;
            } else {
              await screen.wait(300);
            }
          }
        }

        // Step 5: Wait for screen to settle
        const waitTime = this.getWaitTime(decision.action);
        await screen.wait(waitTime);
      }

      // Max steps reached
      if (this.stepCount >= MAX_STEPS) {
        const msg = `Stopped: reached maximum ${MAX_STEPS} steps without completing goal`;
        this.emit('error', { message: msg, steps: this.stepCount });
        this.running = false;
        return { success: false, summary: msg, steps: this.stepCount };
      }

      // Manually stopped
      const msg = 'Agent stopped by user';
      this.emit('stopped', { reason: msg, steps: this.stepCount });
      this.running = false;
      return { success: false, summary: msg, steps: this.stepCount };

    } catch (e) {
      this.running = false;
      this.emit('error', { message: e.message, steps: this.stepCount });
      return { success: false, summary: e.message, steps: this.stepCount };
    }
  }

  /**
   * Execute a single action from the AI.
   */
  async executeAction(action, params) {
    switch (action) {
      case 'click':
        if (typeof params.x !== 'number' || typeof params.y !== 'number') {
          throw new Error('Click requires x, y coordinates');
        }
        await screen.click(params.x, params.y, { button: params.button || 'left' });
        break;

      case 'type':
        if (!params.text) throw new Error('Type requires text');
        await screen.type(params.text, { delayMs: params.delayMs || 0 });
        break;

      case 'key':
        if (!params.combo) throw new Error('Key requires combo');
        await screen.key(params.combo);
        break;

      case 'drag':
        if (typeof params.x1 !== 'number' || typeof params.y1 !== 'number' ||
            typeof params.x2 !== 'number' || typeof params.y2 !== 'number') {
          throw new Error('Drag requires x1, y1, x2, y2 coordinates');
        }
        await screen.drag(params.x1, params.y1, params.x2, params.y2);
        break;

      case 'scroll':
        await screen.scroll(params.direction || 'down', params.amount || 3);
        break;

      case 'open_app':
        if (!params.name) throw new Error('open_app requires name');
        await screen.openApp(params.name);
        break;

      case 'open_url':
        if (!params.url) throw new Error('open_url requires url');
        await screen.openUrl(params.url);
        break;

      case 'find_and_click':
        if (!params.text) throw new Error('find_and_click requires text param');
        const elements = await screen.findElement(params.text);
        if (elements.length === 0) throw new Error(`Element "${params.text}" not found`);
        const el = elements[0];
        await screen.click(el.x, el.y, { button: params.button || 'left' });
        break;

      case 'window':
        if (!params.action) throw new Error('window requires action param');
        await screen.windowAction(params.action);
        break;

      case 'wait':
        await screen.wait(params.ms || 1000);
        break;

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * How long to wait after each action type.
   */
  getWaitTime(action) {
    switch (action) {
      case 'open_app':
      case 'open_url':
      case 'window':
        return WAIT_AFTER_OPEN;
      case 'click':
      case 'drag':
        return WAIT_AFTER_CLICK;
      case 'wait':
        return 0; // wait action handles its own timing
      default:
        return WAIT_AFTER_ACTION;
    }
  }

  /**
   * Stop the agent.
   */
  stop() {
    this.running = false;
    this.paused = false;
  }

  /**
   * Pause/resume the agent.
   */
  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  /**
   * Check if agent is running.
   */
  isRunning() {
    return this.running;
  }

  /**
   * Get current step count.
   */
  getStepCount() {
    return this.stepCount;
  }

  /**
   * Get step history.
   */
  getHistory() {
    return [...this.steps];
  }
}

// ─── Exports ─────────────────────────────────────────
module.exports = { ComputerUseAgent };

