/**
 * proposal-writer.js — AI-powered Proposal Generator
 * 
 * Reads a job listing, understands requirements, and writes
 * a personalized proposal that stands out.
 * 
 * Uses the user's profile/skills to match with job requirements.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { callGatewayForWebAgent } = require('./ai-bridge');

const PROFILE_PATH = path.join(os.homedir(), '.root-ai', 'freelancer-profile.json');
const TEMPLATES_PATH = path.join(os.homedir(), '.root-ai', 'proposal-templates.json');
const PROPOSALS_LOG = path.join(os.homedir(), '.root-ai', 'proposals-log.json');

// ─── Profile Management ─────────────────────────────

/**
 * Get or create freelancer profile.
 * User sets this once, AI uses it for all proposals.
 */
function getProfile() {
  try {
    if (fs.existsSync(PROFILE_PATH)) {
      return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
    }
  } catch (e) { /* corrupted file */ }
  
  // Default profile
  return {
    name: '',
    title: '',
    skills: [],
    experience_years: 0,
    hourly_rate: 0,
    bio: '',
    portfolio: [],
    languages: ['English'],
    availability: 'Full-time',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

function saveProfile(profile) {
  const dir = path.dirname(PROFILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROFILE_PATH, JSON.stringify(profile, null, 2));
}

// ─── Proposal Generation ────────────────────────────

/**
 * Generate a proposal for a job listing.
 * 
 * @param {object} job - Job details { title, description, budget, skills, client_info }
 * @param {object} [options] - { tone: 'professional', length: 'medium', custom_points: [] }
 * @returns {Promise<{ proposal: string, coverLetter: string, bidAmount: string, estimatedHours: number }>}
 */
async function generateProposal(job, options = {}) {
  const profile = getProfile();
  const tone = options.tone || 'professional';
  const length = options.length || 'medium'; // short, medium, long
  
  const lengthGuide = {
    short: '100-150 words',
    medium: '200-300 words',
    long: '400-500 words',
  };

  const prompt = buildProposalPrompt(job, profile, tone, lengthGuide[length], options.custom_points);
  
  const response = await callGatewayForWebAgent(PROPOSAL_SYSTEM_PROMPT, prompt);
  
  // Parse AI response
  const result = parseProposalResponse(response, job);
  
  // Log proposal
  logProposal(job, result);
  
  return result;
}

/**
 * Score a job for fit with user's profile.
 * @param {object} job - Job details
 * @returns {Promise<{ score: number, reasons: string[], recommendation: string }>}
 */
async function scoreJob(job) {
  const profile = getProfile();
  
  const prompt = `Rate this job for the freelancer profile below.

JOB:
Title: ${job.title}
Description: ${job.description || ''}
Budget: ${job.budget || 'Not specified'}
Skills needed: ${(job.skills || []).join(', ')}
Client info: ${job.client_info || 'Unknown'}

FREELANCER PROFILE:
Name: ${profile.name || 'Not set'}
Skills: ${(profile.skills || []).join(', ')}
Experience: ${profile.experience_years || '?'} years
Rate: $${profile.hourly_rate || '?'}/hr
Bio: ${profile.bio || 'Not set'}

Respond as JSON:
{
  "score": <1-10>,
  "skill_match": <1-10>,
  "budget_match": <1-10>,
  "reasons": ["reason1", "reason2"],
  "recommendation": "apply" | "skip" | "maybe",
  "tips": "specific tip for this job"
}`;

  const response = await callGatewayForWebAgent(
    'You are a freelance career advisor. Rate job fit accurately. Output JSON only.',
    prompt
  );

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (e) { /* parse error */ }
  
  return { score: 5, skill_match: 5, budget_match: 5, reasons: ['Could not analyze'], recommendation: 'maybe', tips: '' };
}

/**
 * Improve an existing proposal draft.
 * @param {string} draft - Current proposal text
 * @param {string} feedback - What to improve
 * @returns {Promise<string>} Improved proposal
 */
async function improveProposal(draft, feedback) {
  const prompt = `Improve this freelance proposal based on the feedback:

CURRENT PROPOSAL:
${draft}

FEEDBACK:
${feedback}

Write the improved proposal. Keep it natural, not robotic. Output the proposal text only.`;

  return callGatewayForWebAgent(
    'You are an expert freelance proposal writer. Improve proposals while keeping them authentic.',
    prompt
  );
}

// ─── Templates ──────────────────────────────────────

/**
 * Get proposal templates.
 */
function getTemplates() {
  try {
    if (fs.existsSync(TEMPLATES_PATH)) {
      return JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    }
  } catch (e) { /* */ }
  
  return [
    {
      name: 'Standard',
      template: `Hi {client_name},

{opening_hook}

{experience_match}

{approach}

{call_to_action}

Best regards,
{freelancer_name}`,
    },
    {
      name: 'Quick & Direct',
      template: `{opening_hook}

Here's what I'll deliver:
{deliverables}

{availability}

{freelancer_name}`,
    },
    {
      name: 'Portfolio-focused',
      template: `Hi {client_name},

{opening_hook}

Here's relevant work I've done:
{portfolio_items}

{approach}

{call_to_action}`,
    },
  ];
}

function saveTemplates(templates) {
  fs.writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
}

// ─── Helpers ─────────────────────────────────────────

function buildProposalPrompt(job, profile, tone, lengthGuide, customPoints) {
  let prompt = `Write a freelance proposal for this job:

JOB:
Title: ${job.title}
Description: ${job.description || 'No description'}
Budget: ${job.budget || 'Not specified'}
Skills needed: ${(job.skills || []).join(', ') || 'Not specified'}
Client: ${job.client_info || 'Unknown'}

MY PROFILE:
Name: ${profile.name || 'Freelancer'}
Title: ${profile.title || 'Developer'}
Skills: ${(profile.skills || []).join(', ') || 'Various'}
Experience: ${profile.experience_years || 'Several'} years
Rate: $${profile.hourly_rate || '?'}/hr
Portfolio: ${(profile.portfolio || []).map(p => p.title || p).join(', ') || 'Available on request'}

REQUIREMENTS:
- Tone: ${tone}
- Length: ${lengthGuide}
- Be specific to THIS job (not generic)
- Show understanding of their needs
- Mention relevant experience
- Include a clear call to action
- Don't be sycophantic or overly formal`;

  if (customPoints && customPoints.length > 0) {
    prompt += `\n- Also mention: ${customPoints.join(', ')}`;
  }

  prompt += `

Respond as JSON:
{
  "proposal": "the full proposal text",
  "coverLetter": "shorter version for cover letter field",
  "bidAmount": "suggested bid amount with reasoning",
  "estimatedHours": estimated_hours_number,
  "keyPoints": ["point1", "point2", "point3"]
}`;

  return prompt;
}

function parseProposalResponse(response, job) {
  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return {
        proposal: parsed.proposal || response,
        coverLetter: parsed.coverLetter || parsed.proposal?.substring(0, 500) || '',
        bidAmount: parsed.bidAmount || job.budget || 'Negotiable',
        estimatedHours: parsed.estimatedHours || 0,
        keyPoints: parsed.keyPoints || [],
      };
    }
  } catch (e) { /* parse failed */ }
  
  return {
    proposal: response,
    coverLetter: response.substring(0, 500),
    bidAmount: job.budget || 'Negotiable',
    estimatedHours: 0,
    keyPoints: [],
  };
}

function logProposal(job, proposal) {
  try {
    let log = [];
    if (fs.existsSync(PROPOSALS_LOG)) {
      log = JSON.parse(fs.readFileSync(PROPOSALS_LOG, 'utf8'));
    }
    log.push({
      timestamp: new Date().toISOString(),
      job: { title: job.title, budget: job.budget, link: job.link },
      bidAmount: proposal.bidAmount,
      status: 'drafted', // drafted, sent, viewed, replied, hired
    });
    if (log.length > 200) log = log.slice(-200);
    fs.writeFileSync(PROPOSALS_LOG, JSON.stringify(log, null, 2));
  } catch (e) { /* logging non-critical */ }
}

/**
 * Get proposal history.
 */
function getProposalHistory() {
  try {
    if (fs.existsSync(PROPOSALS_LOG)) {
      return JSON.parse(fs.readFileSync(PROPOSALS_LOG, 'utf8'));
    }
  } catch (e) { /* */ }
  return [];
}

// ─── System Prompt ──────────────────────────────────
const PROPOSAL_SYSTEM_PROMPT = `You are an expert freelance proposal writer with a 90%+ hire rate.

Your proposals:
- Are specific to the job (never generic)
- Show you READ and UNDERSTOOD the requirements
- Highlight relevant experience naturally
- Have a clear, confident opening (no "I hope this finds you well")
- Include a specific approach/plan for the project
- End with a call to action
- Sound human, not AI-generated
- Are concise but thorough

AVOID:
- "I am writing to express my interest..."
- "I would be happy to..."
- "I am confident that..."
- Generic filler text
- Overuse of exclamation marks
- Listing every skill you have

Output JSON as requested.`;

// ─── Exports ─────────────────────────────────────────
module.exports = {
  // Profile
  getProfile,
  saveProfile,
  // Proposals
  generateProposal,
  scoreJob,
  improveProposal,
  // Templates
  getTemplates,
  saveTemplates,
  // History
  getProposalHistory,
};
