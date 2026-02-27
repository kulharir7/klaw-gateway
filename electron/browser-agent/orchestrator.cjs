/**
 * orchestrator.js — The Main Brain
 * 
 * Ties everything together into autonomous workflows.
 * User sets a goal → orchestrator breaks it down → executes each step.
 * 
 * Example: "Earn $5000/month from React development on Upwork"
 * → Login → Search jobs → Score → Write proposals → Submit → Chat → Code → Deliver
 */

const EventEmitter = require('events');
const browser = require('./browser');
const loginManager = require('./login-manager');
const analyzer = require('./page-analyzer');
const proposalWriter = require('./proposal-writer');
const messenger = require('./messenger');
const codeAgent = require('./code-agent');
const dashboard = require('./dashboard');
const { WebNavigator } = require('./navigator');
const { callGatewayForWebAgent } = require('./ai-bridge');

// Approval levels
const APPROVAL_LEVELS = {
  APPROVE_ALL: 1,      // User approves everything
  AUTO_APPLY: 2,       // Auto-apply, approve communication
  AUTO_COMMUNICATE: 3, // Auto-communicate, approve delivery
  FULL_AUTO: 4,        // Full autopilot
};

class Orchestrator extends EventEmitter {
  constructor(options = {}) {
    super();
    this.approvalLevel = options.approvalLevel || APPROVAL_LEVELS.APPROVE_ALL;
    this.running = false;
    this.currentTask = null;
    this.askAI = callGatewayForWebAgent;
  }

  /**
   * Run a full freelancing cycle.
   * @param {object} config
   * @param {string} config.platform - 'upwork', 'indeed', 'linkedin', etc.
   * @param {string} config.searchQuery - What to search for
   * @param {number} [config.maxProposals=5] - Max proposals per run
   * @param {object} [config.filters] - { minBudget, maxBudget, jobType }
   * @returns {Promise<object>} Run results
   */
  async runJobHunt(config) {
    if (this.running) throw new Error('Already running');
    this.running = true;
    this.emit('start', { task: 'job_hunt', config });

    const results = {
      jobsFound: 0,
      jobsScored: 0,
      proposalsSent: 0,
      errors: [],
    };

    try {
      // Step 1: Ensure logged in
      this.emit('step', { step: 'login', message: `Checking ${config.platform} session...` });
      if (!loginManager.hasSession(config.platform)) {
        this.emit('step', { step: 'login', message: `Need to login to ${config.platform}. Opening browser...` });
        const loginResult = await loginManager.login(config.platform);
        if (!loginResult.success) {
          throw new Error(`Login failed: ${loginResult.message}`);
        }
      } else {
        const valid = await loginManager.loadSession(config.platform);
        if (!valid) {
          this.emit('step', { step: 'login', message: 'Session expired. Need fresh login...' });
          loginManager.deleteSession(config.platform);
          const loginResult = await loginManager.login(config.platform);
          if (!loginResult.success) throw new Error(`Login failed: ${loginResult.message}`);
        }
      }
      this.emit('step', { step: 'login', message: '✅ Logged in' });

      // Step 2: Search jobs
      this.emit('step', { step: 'search', message: `Searching for "${config.searchQuery}"...` });
      
      const navigator = new WebNavigator({ askAI: this.askAI });
      const searchResult = await navigator.run(
        `Search for "${config.searchQuery}" jobs on ${config.platform}. List the job titles you find.`
      );

      // Step 3: Read page and extract jobs
      this.emit('step', { step: 'extract', message: 'Extracting job listings...' });
      const pageAnalysis = await analyzer.analyzePage();
      const pageText = await browser.getText();
      
      // Ask AI to parse jobs from page text
      const jobsResponse = await this.askAI(
        'Extract job listings from this page. Output JSON: {"jobs":[{"title":"","description":"","budget":"","skills":[],"link":""}]}',
        `Page content:\n${pageText.substring(0, 5000)}`
      );

      let jobs = [];
      try {
        const match = jobsResponse.match(/\{[\s\S]*\}/);
        if (match) jobs = JSON.parse(match[0]).jobs || [];
      } catch (e) { /* */ }

      results.jobsFound = jobs.length;
      this.emit('step', { step: 'extract', message: `Found ${jobs.length} jobs` });

      // Step 4: Score jobs
      this.emit('step', { step: 'score', message: 'Scoring jobs for fit...' });
      const scoredJobs = [];
      for (const job of jobs.slice(0, 10)) {
        try {
          const score = await proposalWriter.scoreJob(job);
          scoredJobs.push({ ...job, ...score });
          results.jobsScored++;
        } catch (e) {
          results.errors.push(`Score error: ${e.message}`);
        }
      }

      // Sort by score
      scoredJobs.sort((a, b) => (b.score || 0) - (a.score || 0));
      this.emit('step', { step: 'score', message: `Scored ${scoredJobs.length} jobs. Top: ${scoredJobs[0]?.title || 'none'}` });

      // Step 5: Generate proposals for top jobs
      const topJobs = scoredJobs
        .filter(j => j.recommendation !== 'skip')
        .slice(0, config.maxProposals || 5);

      this.emit('step', { step: 'proposals', message: `Writing ${topJobs.length} proposals...` });

      for (const job of topJobs) {
        try {
          const proposal = await proposalWriter.generateProposal(job);
          this.emit('proposal_ready', { job, proposal });

          // Auto-submit if approval level allows
          if (this.approvalLevel >= APPROVAL_LEVELS.AUTO_APPLY) {
            // Navigate to job and submit proposal via browser
            this.emit('step', { step: 'submit', message: `Submitting proposal for "${job.title}"...` });
            // TODO: actual submission via browser navigation
          }

          results.proposalsSent++;
        } catch (e) {
          results.errors.push(`Proposal error for "${job.title}": ${e.message}`);
        }
      }

      this.emit('done', results);
      return results;

    } catch (e) {
      results.errors.push(e.message);
      this.emit('error', { message: e.message, results });
      return results;
    } finally {
      this.running = false;
    }
  }

  /**
   * Check and respond to client messages.
   */
  async checkMessages(platform) {
    this.emit('step', { step: 'messages', message: `Checking ${platform} messages...` });

    if (!loginManager.hasSession(platform)) {
      return { error: 'Not logged in' };
    }

    await loginManager.loadSession(platform);
    const messages = await messenger.readMessages();
    const unread = await messenger.getUnreadCount();

    this.emit('step', { step: 'messages', message: `${unread} unread messages` });

    // Generate replies for unread
    const replies = [];
    if (messages.length > 0) {
      const lastClientMsg = [...messages].reverse().find(m => !m.isMe);
      if (lastClientMsg) {
        const analysis = await messenger.analyzeMessage(lastClientMsg.text);
        if (analysis.needsAction) {
          const reply = await messenger.generateReply(messages);
          replies.push({ to: lastClientMsg.sender, draft: reply, analysis });
          
          if (this.approvalLevel >= APPROVAL_LEVELS.AUTO_COMMUNICATE) {
            await messenger.sendMessage(reply);
            this.emit('step', { step: 'messages', message: `Auto-replied to ${lastClientMsg.sender}` });
          } else {
            this.emit('approval_needed', { type: 'message', draft: reply, analysis });
          }
        }
      }
    }

    return { unread, messages: messages.length, replies };
  }

  /**
   * Get daily summary.
   */
  getDailySummary() {
    return dashboard.getDailyReport();
  }

  /**
   * Full status.
   */
  getStatus() {
    return {
      running: this.running,
      currentTask: this.currentTask,
      approvalLevel: this.approvalLevel,
      stats: dashboard.getStats(),
    };
  }

  stop() {
    this.running = false;
  }
}

module.exports = { Orchestrator, APPROVAL_LEVELS };
