/**
 * dashboard.js — Freelancer Dashboard / Analytics
 * 
 * Tracks: jobs applied, proposals sent, replies, hires, earnings.
 * Provides daily/weekly/monthly reports.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(os.homedir(), '.root-ai');
const PROPOSALS_LOG = path.join(DATA_DIR, 'proposals-log.json');
const MESSAGES_LOG = path.join(DATA_DIR, 'messages-log.json');
const EARNINGS_LOG = path.join(DATA_DIR, 'earnings.json');

// ─── Stats ───────────────────────────────────────────

/**
 * Get overall dashboard stats.
 */
function getStats() {
  const proposals = loadJSON(PROPOSALS_LOG);
  const messages = loadJSON(MESSAGES_LOG);
  const earnings = loadJSON(EARNINGS_LOG);

  const today = new Date().toISOString().split('T')[0];
  const thisWeek = getWeekStart();
  const thisMonth = new Date().toISOString().slice(0, 7);

  return {
    proposals: {
      total: proposals.length,
      today: proposals.filter(p => p.timestamp?.startsWith(today)).length,
      thisWeek: proposals.filter(p => p.timestamp >= thisWeek).length,
      thisMonth: proposals.filter(p => p.timestamp?.startsWith(thisMonth)).length,
      byStatus: countBy(proposals, 'status'),
    },
    messages: {
      total: messages.length,
      sent: messages.filter(m => m.direction === 'sent').length,
      received: messages.filter(m => m.direction === 'received').length,
    },
    earnings: {
      total: earnings.reduce((s, e) => s + (e.amount || 0), 0),
      thisMonth: earnings.filter(e => e.date?.startsWith(thisMonth)).reduce((s, e) => s + (e.amount || 0), 0),
      byPlatform: groupSum(earnings, 'platform', 'amount'),
    },
    activeSessions: listSessions(),
  };
}

/**
 * Generate a daily report.
 */
function getDailyReport() {
  const today = new Date().toISOString().split('T')[0];
  const proposals = loadJSON(PROPOSALS_LOG).filter(p => p.timestamp?.startsWith(today));
  const messages = loadJSON(MESSAGES_LOG).filter(m => m.timestamp?.startsWith(today));

  return {
    date: today,
    proposalsSent: proposals.length,
    proposalJobs: proposals.map(p => p.job?.title || 'Unknown'),
    messagesSent: messages.filter(m => m.direction === 'sent').length,
    messagesReceived: messages.filter(m => m.direction === 'received').length,
    summary: `Sent ${proposals.length} proposals, ${messages.filter(m => m.direction === 'sent').length} messages today.`,
  };
}

/**
 * Add earnings entry.
 */
function addEarning(entry) {
  let earnings = loadJSON(EARNINGS_LOG);
  earnings.push({
    ...entry,
    date: entry.date || new Date().toISOString(),
  });
  saveJSON(EARNINGS_LOG, earnings);
}

/**
 * Get active login sessions.
 */
function listSessions() {
  const sessDir = path.join(DATA_DIR, 'browser-sessions');
  if (!fs.existsSync(sessDir)) return [];
  return fs.readdirSync(sessDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessDir, f), 'utf8'));
        return { name: data.name, domain: data.domain, savedAt: data.savedAt };
      } catch (e) { return { name: f.replace('.json', '') }; }
    });
}

// ─── Helpers ─────────────────────────────────────────

function loadJSON(filePath) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { /* */ }
  return [];
}

function saveJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function countBy(arr, key) {
  const counts = {};
  arr.forEach(item => {
    const val = item[key] || 'unknown';
    counts[val] = (counts[val] || 0) + 1;
  });
  return counts;
}

function groupSum(arr, groupKey, sumKey) {
  const sums = {};
  arr.forEach(item => {
    const group = item[groupKey] || 'unknown';
    sums[group] = (sums[group] || 0) + (item[sumKey] || 0);
  });
  return sums;
}

function getWeekStart() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(now.setDate(diff)).toISOString().split('T')[0];
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  getStats,
  getDailyReport,
  addEarning,
  listSessions,
};
