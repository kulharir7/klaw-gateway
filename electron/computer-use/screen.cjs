/**
 * screen.js — Screen control for Korvus Computer Use
 * 
 * Provides: screenshot, click, type, key, scroll, openApp, openUrl, etc.
 * All screenshot data stays in RAM — never written to disk.
 * 
 * Uses .ps1 script files for complex Win32 operations (here-strings 
 * don't work in inline PowerShell commands).
 */

const { execSync, exec, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ─── Constants ───────────────────────────────────────
const SCREENSHOT_TIMEOUT = 15000;
const ACTION_TIMEOUT = 8000;
const APP_OPEN_TIMEOUT = 10000;
// Write scripts to temp dir (can't write inside app.asar)
const SCRIPTS_DIR = path.join(os.tmpdir(), 'korvus-ps-scripts');

// ─── Init: Create PowerShell scripts on first load ──
function ensureScripts() {
  if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  }

  // screenshot.ps1 — capture screen to base64 PNG (RAM only)
  writeScript('screenshot.ps1', `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
$ms = New-Object System.IO.MemoryStream
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$b64 = [Convert]::ToBase64String($ms.ToArray())
$ms.Dispose()
$gfx.Dispose()
$bmp.Dispose()
Write-Output $b64
`);

  // screensize.ps1
  writeScript('screensize.ps1', `
Add-Type -AssemblyName System.Windows.Forms
$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Output "$($s.Width)x$($s.Height)"
`);

  // input.ps1 — Win32 mouse/keyboard (accepts action as param)
  writeScript('input.ps1', `
param([string]$Action, [string]$Arg1, [string]$Arg2)

Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public class RootAIInput {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, int dwExtraInfo);
    
    public const uint MOUSEEVENTF_LEFTDOWN = 0x02;
    public const uint MOUSEEVENTF_LEFTUP = 0x04;
    public const uint MOUSEEVENTF_RIGHTDOWN = 0x08;
    public const uint MOUSEEVENTF_RIGHTUP = 0x10;
    public const uint MOUSEEVENTF_WHEEL = 0x0800;
    
    public static void LeftClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        Thread.Sleep(30);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
    
    public static void RightClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
        Thread.Sleep(30);
        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
    }
    
    public static void DoubleClick(int x, int y) {
        SetCursorPos(x, y);
        Thread.Sleep(50);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        Thread.Sleep(80);
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
    }
    
    public static void ScrollWheel(int clicks) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)(clicks * 120), 0);
    }
    
    public static void MoveTo(int x, int y) {
        SetCursorPos(x, y);
    }
}
'@

switch ($Action) {
    "leftclick"   { [RootAIInput]::LeftClick([int]$Arg1, [int]$Arg2) }
    "rightclick"  { [RootAIInput]::RightClick([int]$Arg1, [int]$Arg2) }
    "doubleclick" { [RootAIInput]::DoubleClick([int]$Arg1, [int]$Arg2) }
    "scroll"      { [RootAIInput]::ScrollWheel([int]$Arg1) }
    "move"        { [RootAIInput]::MoveTo([int]$Arg1, [int]$Arg2) }
    default       { Write-Error "Unknown action: $Action" }
}
Write-Output "OK"
`);

  // activewindow.ps1
  writeScript('activewindow.ps1', `
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ActiveWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    public static string GetTitle() {
        IntPtr h = GetForegroundWindow();
        StringBuilder sb = new StringBuilder(256);
        GetWindowText(h, sb, 256);
        return sb.ToString();
    }
    public static uint GetPid() {
        IntPtr h = GetForegroundWindow();
        uint pid;
        GetWindowThreadProcessId(h, out pid);
        return pid;
    }
}
'@
$title = [ActiveWin]::GetTitle()
$pid = [ActiveWin]::GetPid()
$proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
Write-Output "$($proc.ProcessName)|$title"
`);

  // focuswindow.ps1
  writeScript('focuswindow.ps1', `
param([string]$ProcessName)

Add-Type @'
using System;
using System.Runtime.InteropServices;
public class FocusWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
'@

$proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($proc) {
    [FocusWin]::ShowWindow($proc.MainWindowHandle, 9) | Out-Null
    [FocusWin]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
    Write-Output "OK"
} else {
    Write-Output "NOT_FOUND"
}
`);
}

function writeScript(name, content) {
  const filePath = path.join(SCRIPTS_DIR, name);
  // Only write if content changed (avoid unnecessary disk writes)
  try {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.trim() === content.trim()) return;
  } catch (e) { /* file doesn't exist, write it */ }
  fs.writeFileSync(filePath, content.trim(), 'utf8');
}

// Initialize scripts on module load
ensureScripts();

// ─── Helper: Run a .ps1 script ──────────────────────
function runPS1(scriptName, args = [], timeout = ACTION_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(SCRIPTS_DIR, scriptName);
    if (!fs.existsSync(scriptPath)) {
      return reject(new Error(`Script not found: ${scriptPath}`));
    }

    const psArgs = [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath,
      ...args
    ];

    execFile('powershell', psArgs, { timeout, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${scriptName} failed: ${err.message}`));
      resolve(stdout.trim());
    });
  });
}

// ─── Helper: Run inline PowerShell (simple commands only) ──
function runPSInline(command, timeout = ACTION_TIMEOUT) {
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-Command', command], { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`PS command failed: ${err.message}`));
      resolve(stdout.trim());
    });
  });
}

// ─── Screenshot ──────────────────────────────────────
/**
 * Take a screenshot and return as base64 PNG string.
 * Image stays in RAM — never saved to disk.
 * @returns {Promise<string>} Base64 encoded PNG image
 */
async function screenshot() {
  const b64 = await runPS1('screenshot.ps1', [], SCREENSHOT_TIMEOUT);
  if (!b64 || b64.length < 100) throw new Error('Screenshot returned empty data');
  return b64;
}

/**
 * Get screen resolution.
 * @returns {{ width: number, height: number }}
 */
function getScreenSize() {
  try {
    const result = runPSInlineSync('screensize.ps1');
    const [w, h] = result.split('x').map(Number);
    return { width: w || 1920, height: h || 1080 };
  } catch (e) {
    return { width: 1920, height: 1080 };
  }
}

function runPSInlineSync(scriptName) {
  const scriptPath = path.join(SCRIPTS_DIR, scriptName);
  return execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`, 
    { timeout: ACTION_TIMEOUT }).toString().trim();
}

// ─── Mouse Actions ───────────────────────────────────

/**
 * Click at screen coordinates.
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {object} [options] - { button: 'left'|'right'|'double' }
 */
async function click(x, y, options = {}) {
  x = Math.round(x);
  y = Math.round(y);
  const { width, height } = getScreenSize();
  
  if (x < 0 || x > width || y < 0 || y > height) {
    throw new Error(`Click coordinates (${x}, ${y}) out of screen bounds (${width}x${height})`);
  }
  
  const button = (options.button || 'left').toLowerCase();
  const action = button === 'right' ? 'rightclick' : button === 'double' ? 'doubleclick' : 'leftclick';
  
  await runPS1('input.ps1', [action, String(x), String(y)]);
}

/**
 * Move mouse to coordinates without clicking.
 * @param {number} x 
 * @param {number} y 
 */
async function moveMouse(x, y) {
  await runPS1('input.ps1', ['move', String(Math.round(x)), String(Math.round(y))]);
}

/**
 * Drag from one point to another (click-hold, move, release).
 * @param {number} x1 - Start X
 * @param {number} y1 - Start Y
 * @param {number} x2 - End X
 * @param {number} y2 - End Y
 */
async function drag(x1, y1, x2, y2) {
  const { width, height } = getScreenSize();
  x1 = Math.round(x1); y1 = Math.round(y1);
  x2 = Math.round(x2); y2 = Math.round(y2);
  if (x1 < 0 || x1 > width || y1 < 0 || y1 > height) throw new Error(`Drag start (${x1},${y1}) out of bounds`);
  if (x2 < 0 || x2 > width || y2 < 0 || y2 > height) throw new Error(`Drag end (${x2},${y2}) out of bounds`);
  await runPS1('input.ps1', ['drag', `${x1},${y1},${x2},${y2}`]);
}

/**
 * Scroll the mouse wheel.
 * @param {string} direction - 'up' or 'down'
 * @param {number} [amount=3] - Number of scroll clicks
 */
async function scroll(direction, amount = 3) {
  const dir = direction.toLowerCase();
  if (dir !== 'up' && dir !== 'down') {
    throw new Error(`Invalid scroll direction: "${direction}" (use "up" or "down")`);
  }
  const clicks = dir === 'up' ? amount : -amount;
  await runPS1('input.ps1', ['scroll', String(clicks)]);
}

// ─── Keyboard Actions ────────────────────────────────

/**
 * Type text using SendKeys.
 * @param {string} text - Text to type
 * @param {object} [options] - { delayMs: number }
 */
async function type(text, options = {}) {
  if (!text || text.length === 0) throw new Error('Nothing to type — empty text');
  
  // SendKeys special chars need escaping: +^%~(){}[]
  const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}');
  // Escape single quotes for PowerShell
  const psStr = escaped.replace(/'/g, "''");
  
  const delayMs = options.delayMs || 0;
  let cmd;
  
  if (delayMs > 0) {
    // Type char by char
    const chars = [...psStr];
    const parts = chars.map(c => `[System.Windows.Forms.SendKeys]::SendWait('${c}'); Start-Sleep -Milliseconds ${delayMs}`);
    cmd = `Add-Type -AssemblyName System.Windows.Forms; ${parts.join('; ')}`;
  } else {
    cmd = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psStr}')`;
  }
  
  const timeout = ACTION_TIMEOUT + (delayMs > 0 ? delayMs * text.length : 0);
  await runPSInline(cmd, timeout);
}

/**
 * Press keyboard shortcut or special key.
 * @param {string} combo - e.g. "ctrl+c", "enter", "alt+tab"
 */
async function key(combo) {
  if (!combo) throw new Error('No key combo provided');
  
  const keyMap = {
    'enter': '{ENTER}', 'return': '{ENTER}',
    'tab': '{TAB}',
    'escape': '{ESC}', 'esc': '{ESC}',
    'backspace': '{BACKSPACE}', 'bs': '{BACKSPACE}',
    'delete': '{DELETE}', 'del': '{DELETE}',
    'space': ' ',
    'up': '{UP}', 'down': '{DOWN}', 'left': '{LEFT}', 'right': '{RIGHT}',
    'home': '{HOME}', 'end': '{END}',
    'pageup': '{PGUP}', 'pagedown': '{PGDN}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
    'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
    'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
  };
  
  const parts = combo.toLowerCase().split('+').map(s => s.trim());
  let sendKeysStr = '';
  let modifiers = '';
  
  for (const part of parts) {
    if (part === 'ctrl' || part === 'control') { modifiers += '^'; continue; }
    if (part === 'alt') { modifiers += '%'; continue; }
    if (part === 'shift') { modifiers += '+'; continue; }
    
    const mapped = keyMap[part];
    if (mapped) {
      sendKeysStr = modifiers + mapped;
    } else if (part.length === 1) {
      sendKeysStr = modifiers + part;
    } else {
      throw new Error(`Unknown key: "${part}" in combo "${combo}"`);
    }
  }
  
  if (!sendKeysStr) throw new Error(`Could not parse key combo: "${combo}"`);
  
  const psStr = sendKeysStr.replace(/'/g, "''");
  await runPSInline(`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${psStr}')`);
}

// ─── App/URL Launching ───────────────────────────────

/**
 * Open an application by name or path.
 * @param {string} appName - "notepad", "code", "chrome", or full path
 */
async function openApp(appName) {
  if (!appName) throw new Error('No app name provided');
  
  const aliases = {
    'notepad': 'notepad', 'calculator': 'calc', 'calc': 'calc',
    'paint': 'mspaint', 'explorer': 'explorer', 'files': 'explorer',
    'cmd': 'cmd', 'terminal': 'wt', 'powershell': 'powershell',
    'vscode': 'code', 'code': 'code',
    'chrome': 'chrome', 'firefox': 'firefox', 'edge': 'msedge',
    'word': 'winword', 'excel': 'excel', 'powerpoint': 'powerpnt',
    'outlook': 'outlook', 'teams': 'ms-teams',
    'spotify': 'spotify', 'discord': 'discord', 'slack': 'slack',
  };
  
  const resolved = aliases[appName.toLowerCase()] || appName;
  const psStr = resolved.replace(/'/g, "''");
  await runPSInline(`Start-Process '${psStr}'`, APP_OPEN_TIMEOUT);
}

/**
 * Open a URL in the default browser.
 * @param {string} url
 */
async function openUrl(url) {
  if (!url) throw new Error('No URL provided');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }
  const psStr = url.replace(/'/g, "''");
  await runPSInline(`Start-Process '${psStr}'`, APP_OPEN_TIMEOUT);
}

// ─── Window Management ───────────────────────────────

/**
 * Get info about the currently active window.
 * @returns {Promise<{ title: string, processName: string }>}
 */
async function getActiveWindow() {
  const result = await runPS1('activewindow.ps1');
  const [processName, ...titleParts] = result.split('|');
  return { processName: processName || 'unknown', title: titleParts.join('|') || 'unknown' };
}

/**
 * Bring a window to front by process name.
 * @param {string} processName - e.g. "chrome", "notepad"
 * @returns {Promise<boolean>}
 */
async function focusWindow(processName) {
  if (!processName) throw new Error('No process name provided');
  const result = await runPS1('focuswindow.ps1', [processName]);
  return result === 'OK';
}

/**
 * Wait for a specified time.
 * @param {number} ms
 * @returns {Promise<void>}
 */
// ─── UI Element Detection ────────────────────────────

/**
 * List interactive UI elements in the active window.
 * Returns array of { type, x, y, width, height, name }
 */
async function listElements() {
  const raw = await runPS1('ui-elements.ps1', ['list']);
  return parseElements(raw);
}

/**
 * Find UI elements by name (partial match).
 * @param {string} text - Text to search for
 * @returns {Promise<Array<{ type, x, y, width, height, name }>>}
 */
async function findElement(text) {
  if (!text) throw new Error('findElement requires search text');
  const raw = await runPS1('ui-elements.ps1', ['find', text]);
  return parseElements(raw);
}

/**
 * Get currently focused element info.
 */
async function getFocusedElement() {
  const raw = await runPS1('ui-elements.ps1', ['focused']);
  const els = parseElements(raw);
  return els[0] || null;
}

function parseElements(raw) {
  if (!raw || !raw.trim()) return [];
  return raw.trim().split('\n').map(line => {
    const [type, x, y, w, h, ...nameParts] = line.trim().split('|');
    return { type, x: parseInt(x), y: parseInt(y), width: parseInt(w), height: parseInt(h), name: nameParts.join('|') };
  }).filter(e => !isNaN(e.x));
}

// ─── Window Management ───────────────────────────────

/**
 * Manage the active window: minimize, maximize, restore, close, snap.
 * @param {string} action - minimize|maximize|restore|close|snap_left|snap_right|info
 * @returns {Promise<string>} - "OK" or window info for "info" action
 */
async function windowAction(action) {
  const valid = ['minimize', 'maximize', 'restore', 'close', 'snap_left', 'snap_right', 'info'];
  if (!valid.includes(action)) throw new Error(`Invalid window action: "${action}" (use ${valid.join('|')})`);
  return await runPS1('window.ps1', [action]);
}

// ─── Utility ─────────────────────────────────────────

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Exports ─────────────────────────────────────────
module.exports = {
  screenshot,
  getScreenSize,
  click,
  drag,
  moveMouse,
  type,
  key,
  scroll,
  openApp,
  openUrl,
  getActiveWindow,
  focusWindow,
  windowAction,
  listElements,
  findElement,
  getFocusedElement,
  wait,
};

