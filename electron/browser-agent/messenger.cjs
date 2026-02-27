/**
 * messenger.js — Client Communication Manager
 * 
 * Reads and sends messages on freelance platforms.
 * AI drafts replies, user approves (or auto-send mode).
 */

const browser = require('./browser');
const analyzer = require('./page-analyzer');
const { callGatewayForWebAgent } = require('./ai-bridge');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MESSAGES_LOG = path.join(os.homedir(), '.root-ai', 'messages-log.json');

// ─── Message Reading ─────────────────────────────────

/**
 * Read messages from current page (works on any messaging interface).
 * @returns {Promise<Array<{ sender, text, time, isMe }>>}
 */
async function readMessages() {
  const page = await browser.getPage();
  
  return page.evaluate(() => {
    const messages = [];
    
    // Generic message selectors (works on most platforms)
    const selectors = [
      // Upwork
      '[data-test="message"]',
      '.msg-body',
      // LinkedIn
      '.msg-s-event-listitem',
      '.message-body',
      // Generic
      '[class*="message"]',
      '[class*="chat-message"]',
      '[role="listitem"]',
    ];

    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach(el => {
          const text = el.innerText?.trim();
          if (!text || text.length < 2) return;
          
          // Try to detect sender
          const isMe = el.classList.toString().toLowerCase().includes('outgoing') ||
                       el.classList.toString().toLowerCase().includes('sent') ||
                       el.classList.toString().toLowerCase().includes('self') ||
                       el.getAttribute('data-sender') === 'me';
          
          messages.push({
            sender: isMe ? 'me' : 'client',
            text: text.substring(0, 1000),
            time: el.querySelector('time, [class*="time"], [class*="date"]')?.innerText?.trim() || '',
            isMe,
          });
        });
        break; // use first matching selector
      }
    }

    return messages;
  });
}

/**
 * Read unread message count from platform.
 */
async function getUnreadCount() {
  const page = await browser.getPage();
  return page.evaluate(() => {
    // Look for badge/notification counts
    const badges = document.querySelectorAll(
      '[class*="badge"], [class*="unread"], [class*="notification-count"], [data-test="unread"]'
    );
    for (const badge of badges) {
      const num = parseInt(badge.innerText);
      if (!isNaN(num) && num > 0) return num;
    }
    return 0;
  });
}

// ─── Message Sending ─────────────────────────────────

/**
 * Type and send a message in the current chat.
 * @param {string} text - Message to send
 * @returns {Promise<boolean>}
 */
async function sendMessage(text) {
  const page = await browser.getPage();
  
  // Find message input
  const inputSelectors = [
    'textarea[class*="message"]',
    '[contenteditable="true"][class*="message"]',
    'textarea[placeholder*="message"]',
    'textarea[placeholder*="reply"]',
    '[contenteditable="true"][data-placeholder]',
    'textarea',
  ];

  let inputFound = false;
  for (const sel of inputSelectors) {
    try {
      const el = await page.$(sel);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.width > 50) {
          const humanMouse = require('./human-mouse');
          await humanMouse.humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
          await new Promise(r => setTimeout(r, 200));
          await humanMouse.humanType(page, text);
          inputFound = true;
          break;
        }
      }
    } catch (e) { continue; }
  }

  if (!inputFound) throw new Error('Message input not found');

  // Send (Enter or click send button)
  await new Promise(r => setTimeout(r, 300));
  
  // Try send button first
  try {
    const sendBtn = await page.$('button[type="submit"], button[class*="send"], [data-test="send"], [aria-label*="Send"]');
    if (sendBtn) {
      const box = await sendBtn.boundingBox();
      if (box) {
        const humanMouse = require('./human-mouse');
        await humanMouse.humanClick(page, box.x + box.width / 2, box.y + box.height / 2);
        return true;
      }
    }
  } catch (e) { /* try Enter */ }

  // Fallback: press Enter
  await page.keyboard.press('Enter');
  return true;
}

// ─── AI Reply Generation ─────────────────────────────

/**
 * Generate a reply to client messages.
 * @param {Array} messages - Recent message history
 * @param {object} context - { jobTitle, jobDescription, myProfile }
 * @param {object} [options] - { tone, maxLength }
 * @returns {Promise<string>} Generated reply
 */
async function generateReply(messages, context = {}, options = {}) {
  const recentMessages = messages.slice(-10).map(m => 
    `${m.isMe ? 'ME' : 'CLIENT'}: ${m.text}`
  ).join('\n');

  const prompt = `Generate a reply to the client's latest message.

CONVERSATION:
${recentMessages}

CONTEXT:
Job: ${context.jobTitle || 'Unknown'}
Description: ${context.jobDescription || ''}

REQUIREMENTS:
- Tone: ${options.tone || 'professional but friendly'}
- Max length: ${options.maxLength || '200 words'}
- Be helpful and specific
- If they ask about timeline, give realistic estimate
- If they ask about price, be confident but flexible
- Don't be pushy

Reply with JUST the message text (no JSON, no quotes).`;

  return callGatewayForWebAgent(
    'You are a freelancer replying to a client. Be professional, helpful, and concise.',
    prompt
  );
}

/**
 * Analyze client message for intent.
 * @param {string} message
 * @returns {Promise<{ intent, urgency, needsAction, suggestedAction }>}
 */
async function analyzeMessage(message) {
  const prompt = `Analyze this client message:

"${message}"

Respond as JSON:
{
  "intent": "question|negotiation|feedback|approval|rejection|smalltalk|urgent",
  "urgency": "low|medium|high",
  "needsAction": true/false,
  "suggestedAction": "what the freelancer should do",
  "sentiment": "positive|neutral|negative"
}`;

  const response = await callGatewayForWebAgent(
    'Analyze freelance client messages. Output JSON only.',
    prompt
  );

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { /* */ }

  return { intent: 'unknown', urgency: 'medium', needsAction: true, suggestedAction: 'Review and respond', sentiment: 'neutral' };
}

// ─── Message Logging ─────────────────────────────────

function logMessage(platform, clientName, message, direction) {
  try {
    let log = [];
    if (fs.existsSync(MESSAGES_LOG)) {
      log = JSON.parse(fs.readFileSync(MESSAGES_LOG, 'utf8'));
    }
    log.push({
      timestamp: new Date().toISOString(),
      platform,
      client: clientName,
      message: message.substring(0, 500),
      direction, // 'sent' or 'received'
    });
    if (log.length > 500) log = log.slice(-500);
    fs.writeFileSync(MESSAGES_LOG, JSON.stringify(log, null, 2));
  } catch (e) { /* non-critical */ }
}

function getMessageHistory() {
  try {
    if (fs.existsSync(MESSAGES_LOG)) {
      return JSON.parse(fs.readFileSync(MESSAGES_LOG, 'utf8'));
    }
  } catch (e) { /* */ }
  return [];
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  readMessages,
  getUnreadCount,
  sendMessage,
  generateReply,
  analyzeMessage,
  logMessage,
  getMessageHistory,
};
