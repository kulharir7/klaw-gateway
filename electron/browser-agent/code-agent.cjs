/**
 * code-agent.js — AI Code Generator & Project Manager
 * 
 * Takes project requirements and generates code, manages files,
 * runs tests, and prepares deliverables.
 */

const { callGatewayForWebAgent } = require('./ai-bridge');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, exec } = require('child_process');

const PROJECTS_DIR = path.join(os.homedir(), '.root-ai', 'projects');

// ─── Project Management ──────────────────────────────

/**
 * Create a new project from job requirements.
 * @param {string} name - Project name
 * @param {string} requirements - Job description/requirements
 * @returns {Promise<{ projectDir, taskList, estimatedHours }>}
 */
async function createProject(name, requirements) {
  const safeName = name.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const projectDir = path.join(PROJECTS_DIR, safeName);
  
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  // AI creates task breakdown
  const prompt = `Break down this project into specific coding tasks:

PROJECT: ${name}
REQUIREMENTS: ${requirements}

Respond as JSON:
{
  "tasks": [
    { "id": 1, "title": "task title", "description": "what to do", "files": ["file1.js"], "estimatedMinutes": 30 }
  ],
  "techStack": ["React", "Node.js", ...],
  "estimatedHours": total_hours,
  "projectStructure": {
    "folders": ["src", "public", ...],
    "mainFiles": ["src/App.js", "package.json", ...]
  }
}`;

  const response = await callGatewayForWebAgent(
    'You are a senior developer planning a project. Be specific and realistic.',
    prompt
  );

  let plan;
  try {
    const match = response.match(/\{[\s\S]*\}/);
    plan = match ? JSON.parse(match[0]) : { tasks: [], techStack: [], estimatedHours: 0, projectStructure: {} };
  } catch (e) {
    plan = { tasks: [], techStack: [], estimatedHours: 0, projectStructure: {} };
  }

  // Save project plan
  fs.writeFileSync(path.join(projectDir, 'plan.json'), JSON.stringify({
    name,
    requirements,
    ...plan,
    createdAt: new Date().toISOString(),
    status: 'planned',
  }, null, 2));

  // Create folder structure
  if (plan.projectStructure?.folders) {
    for (const folder of plan.projectStructure.folders) {
      const folderPath = path.join(projectDir, folder);
      if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    }
  }

  return { projectDir, taskList: plan.tasks, estimatedHours: plan.estimatedHours };
}

/**
 * Generate code for a specific task.
 * @param {string} projectDir - Project directory
 * @param {object} task - Task from plan { title, description, files }
 * @returns {Promise<Array<{ file, content }>>}
 */
async function generateCode(projectDir, task) {
  // Read existing files for context
  let existingCode = '';
  try {
    const files = getAllFiles(projectDir).slice(0, 10);
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.length < 5000) {
        existingCode += `\n--- ${path.relative(projectDir, file)} ---\n${content}\n`;
      }
    }
  } catch (e) { /* */ }

  const prompt = `Generate code for this task:

TASK: ${task.title}
DESCRIPTION: ${task.description}
FILES TO CREATE/EDIT: ${(task.files || []).join(', ')}

EXISTING CODE IN PROJECT:
${existingCode.substring(0, 3000) || '(empty project)'}

For EACH file, respond as JSON:
{
  "files": [
    { "path": "relative/path/to/file.js", "content": "full file content" }
  ],
  "explanation": "what this code does"
}

Write production-quality code. No placeholders. No TODOs.`;

  const response = await callGatewayForWebAgent(
    'You are a senior developer writing production code. Write complete, working code. No shortcuts.',
    prompt
  );

  let result;
  try {
    const match = response.match(/\{[\s\S]*\}/);
    result = match ? JSON.parse(match[0]) : { files: [] };
  } catch (e) {
    result = { files: [] };
  }

  // Write files
  const written = [];
  for (const file of (result.files || [])) {
    if (!file.path || !file.content) continue;
    const filePath = path.join(projectDir, file.path);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, file.content);
    written.push({ file: file.path, content: file.content });
  }

  return written;
}

/**
 * Run a command in project directory.
 * @param {string} projectDir
 * @param {string} command
 * @param {number} [timeout=30000]
 * @returns {Promise<{ stdout, stderr, exitCode }>}
 */
function runCommand(projectDir, command, timeout = 30000) {
  return new Promise((resolve) => {
    exec(command, { cwd: projectDir, timeout, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        exitCode: err ? err.code || 1 : 0,
      });
    });
  });
}

/**
 * Package project as ZIP for delivery.
 * @param {string} projectDir
 * @returns {string} Path to ZIP file
 */
function packageProject(projectDir) {
  const zipPath = projectDir + '.zip';
  // Use PowerShell to create zip
  try {
    execSync(
      `powershell -NoProfile -Command "Compress-Archive -Path '${projectDir}\\*' -DestinationPath '${zipPath}' -Force"`,
      { timeout: 30000 }
    );
    return zipPath;
  } catch (e) {
    throw new Error(`Failed to create ZIP: ${e.message}`);
  }
}

/**
 * List all projects.
 */
function listProjects() {
  if (!fs.existsSync(PROJECTS_DIR)) return [];
  return fs.readdirSync(PROJECTS_DIR)
    .filter(f => fs.statSync(path.join(PROJECTS_DIR, f)).isDirectory())
    .map(name => {
      const planPath = path.join(PROJECTS_DIR, name, 'plan.json');
      try {
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        return { name, status: plan.status, tasks: plan.tasks?.length || 0, createdAt: plan.createdAt };
      } catch (e) {
        return { name, status: 'unknown', tasks: 0, createdAt: '' };
      }
    });
}

// ─── Helpers ─────────────────────────────────────────

function getAllFiles(dir, files = []) {
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const full = path.join(dir, entry);
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    if (fs.statSync(full).isDirectory()) {
      getAllFiles(full, files);
    } else {
      files.push(full);
    }
  }
  return files;
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  createProject,
  generateCode,
  runCommand,
  packageProject,
  listProjects,
  PROJECTS_DIR,
};
