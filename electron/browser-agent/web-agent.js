/**
 * web-agent.js — Universal Web Automation Agent for Root AI
 * 
 * Takes ANY web task from user and executes it autonomously.
 * Works on any website — Upwork, LinkedIn, Amazon, Gmail, anything.
 * 
 * Integrates: browser.js + page-analyzer.js + navigator.js + AI
 * 
 * Usage:
 *   const agent = new WebAgent({ aiProvider: 'gateway' });
 *   const result = await agent.execute("Search Upwork for React jobs and list top 10");
 */

const EventEmitter = require('events');
const browser = require('./browser');
const analyzer = require('./page-analyzer');
const { WebNavigator } = require('./navigator');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Config ──────────────────────────────────────────
const STATE_DIR = path.join(os.homedir(), '.root-ai', 'web-agent');
const TASKS_LOG = path.join(STATE_DIR, 'tasks.json');

class WebAgent extends EventEmitter {
  /**
   * @param {object} options
   * @param {function} [options.askAI] - Custom AI function(systemPrompt, userMessage) → string
   * @param {boolean} [options.headless=false] - Run browser in headless mode
   * @param {string} [options.approvalMode='auto'] - 'auto' | 'ask' — should agent ask before sensitive actions?
   */
  constructor(options = {}) {
    super();
    this.askAI = options.askAI || null;
    this.headless = options.headless || false;
    this.approvalMode = options.approvalMode || 'auto';
    this.navigator = null;
    this.taskHistory = [];
    this.running = false;

    // Ensure state dir
    if (!fs.existsSync(STATE_DIR)) fs.mkdirSync(STATE_DIR, { recursive: true });
  }

  /**
   * Set the AI function. Called by Electron IPC when gateway is ready.
   * @param {function} fn - async (systemPrompt, userMessage) => string
   */
  setAI(fn) {
    this.askAI = fn;
  }

  /**
   * Execute a web task.
   * 
   * @param {string} task - Natural language task description
   * @returns {Promise<{ success: boolean, result: any, steps: number, duration: number }>}
   * 
   * Events: 'start', 'step', 'done', 'error', 'need_login', 'need_captcha'
   */
  async execute(task) {
    if (!this.askAI) throw new Error('AI not configured. Call setAI() first.');
    if (this.running) throw new Error('Agent already running a task');
    if (!task || !task.trim()) throw new Error('Task description is required');

    this.running = true;
    const startTime = Date.now();
    this.emit('start', { task });

    try {
      // 1. Launch browser if needed
      if (!browser.isRunning()) {
        await browser.launch({ headless: this.headless });
      }

      // 2. Plan the task — ask AI to break it down
      const plan = await this.planTask(task);
      this.emit('step', { stepNum: 0, thought: `Plan: ${plan.summary}`, action: 'plan', params: { steps: plan.steps } });

      // 3. Execute via navigator
      this.navigator = new WebNavigator({
        askAI: (systemPrompt, context) => this.askAI(systemPrompt, context),
      });

      // Forward navigator events
      this.navigator.on('step', (data) => this.emit('step', data));
      this.navigator.on('captcha', (data) => this.emit('need_captcha', data));
      this.navigator.on('login_needed', (data) => this.emit('need_login', data));

      const result = await this.navigator.run(task);

      // 4. Log task
      const duration = Date.now() - startTime;
      this.logTask(task, result, duration);

      this.running = false;
      this.emit(result.success ? 'done' : 'error', { ...result, duration });
      return { ...result, duration };

    } catch (e) {
      this.running = false;
      const duration = Date.now() - startTime;
      this.emit('error', { message: e.message, steps: 0, duration });
      return { success: false, result: e.message, steps: 0, duration };
    }
  }

  /**
   * Ask AI to plan the task before executing.
   */
  async planTask(task) {
    const prompt = `Break this web task into a brief plan (2-5 steps max):
Task: "${task}"

Respond as JSON: {"summary":"one-line summary","steps":["step1","step2",...]}`;

    try {
      const response = await this.askAI(PLANNER_PROMPT, prompt);
      const match = response.match(/\{[\s\S]*\}/);
      if (match) return JSON.parse(match[0]);
    } catch (e) { /* planning failed, continue anyway */ }

    return { summary: task, steps: [task] };
  }

  /**
   * Execute a quick one-shot action (no planning, just do it).
   * Good for simple tasks like "go to google.com"
   * 
   * @param {string} action - Action name
   * @param {object} params - Action parameters
   */
  async quickAction(action, params = {}) {
    if (!browser.isRunning()) await browser.launch({ headless: this.headless });

    switch (action) {
      case 'goto':
        await browser.goto(params.url);
        return { success: true, result: `Navigated to ${params.url}` };
      case 'search':
        await browser.goto(`https://www.google.com/search?q=${encodeURIComponent(params.query)}`);
        const text = await browser.getText();
        return { success: true, result: text.substring(0, 2000) };
      case 'screenshot':
        const ss = await browser.screenshot();
        return { success: true, result: ss };
      case 'read':
        const pageText = await browser.getText();
        return { success: true, result: pageText.substring(0, 3000) };
      case 'analyze':
        const analysis = await analyzer.getPageSummary();
        return { success: true, result: analysis };
      case 'tabs':
        const tabs = await browser.listTabs();
        return { success: true, result: tabs };
      case 'close':
        await browser.close();
        return { success: true, result: 'Browser closed' };
      default:
        throw new Error(`Unknown quick action: ${action}`);
    }
  }

  /**
   * Log completed task for history/analytics.
   */
  logTask(task, result, duration) {
    const entry = {
      task,
      success: result.success,
      steps: result.steps,
      duration,
      timestamp: new Date().toISOString(),
    };
    this.taskHistory.push(entry);

    // Persist to file (append)
    try {
      let tasks = [];
      if (fs.existsSync(TASKS_LOG)) {
        tasks = JSON.parse(fs.readFileSync(TASKS_LOG, 'utf8'));
      }
      tasks.push(entry);
      // Keep last 100 tasks
      if (tasks.length > 100) tasks = tasks.slice(-100);
      fs.writeFileSync(TASKS_LOG, JSON.stringify(tasks, null, 2));
    } catch (e) { /* logging failure is non-critical */ }
  }

  /**
   * Get task history.
   */
  getHistory() {
    try {
      if (fs.existsSync(TASKS_LOG)) {
        return JSON.parse(fs.readFileSync(TASKS_LOG, 'utf8'));
      }
    } catch (e) { /* ignore */ }
    return [];
  }

  /**
   * Stop current task.
   */
  stop() {
    this.running = false;
    if (this.navigator) this.navigator.stop();
  }

  /**
   * Check if agent is busy.
   */
  isBusy() {
    return this.running;
  }
}

// ─── Planner Prompt ──────────────────────────────────
const PLANNER_PROMPT = `You are a web task planner. Given a task, break it into 2-5 clear browser steps.
Be concise. Output JSON only.`;

// ─── Exports ─────────────────────────────────────────
module.exports = { WebAgent };
