const { app, BrowserWindow, Tray, Menu, nativeImage, shell, globalShortcut, dialog, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
let autoUpdater;
try { autoUpdater = require('electron-updater').autoUpdater; } catch { autoUpdater = null; }

// ─── Squirrel.Windows install/uninstall handling ─────
if (require('os').platform() === 'win32') {
  const cmd = process.argv[1];
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    // Create desktop & start menu shortcuts
    const ChildProcess = require('child_process');
    const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    ChildProcess.spawnSync(updateDotExe, ['--createShortcut', path.basename(process.execPath)]);
    app.quit();
    process.exit(0);
  }
  if (cmd === '--squirrel-uninstall') {
    const ChildProcess = require('child_process');
    const updateDotExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
    ChildProcess.spawnSync(updateDotExe, ['--removeShortcut', path.basename(process.execPath)]);
    app.quit();
    process.exit(0);
  }
  if (cmd === '--squirrel-obsolete') {
    app.quit();
    process.exit(0);
  }
}

// Catch all errors
process.on('uncaughtException', (err) => {
  console.error('[FATAL]', err);
  fs.writeFileSync(path.join(require('os').tmpdir(), 'klaw-crash.log'), 
    `${new Date().toISOString()}\n${err.stack || err.message}\n`, 'utf8');
});

// ─── Config ──────────────────────────────────────────
const GATEWAY_PORT = 19789;
// Klaw has its own state dir — separate from OpenClaw CLI
const KLAW_STATE_DIR = path.join(app.getPath('home'), '.klaw');
const ROOT_CONFIG = path.join(KLAW_STATE_DIR, 'klaw.json');
// Find openclaw.mjs: check multiple locations
// 1. Bundled unpacked (packaged app) — most reliable in production
// 2. Bundled inside electron/gateway (dev after bundle)
// 3. Parent dir (dev without bundle)
function findRootMjs() {
  const candidates = [
    // 1. Packaged app (asar:false) — files in resources/app/gateway/
    path.join(__dirname, '..', 'openclaw.mjs'),
    path.join(__dirname, 'gateway', 'openclaw.mjs'),
    // 2. Dev source: electron/../openclaw.mjs
    path.join(__dirname, '..', 'openclaw.mjs'),
    // 3. Fallback: resources/gateway/ (extraResources, if ever used)
    path.join(process.resourcesPath || '', 'gateway', 'openclaw.mjs'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      console.log('[Klaw] Found gateway at:', p);
      return p;
    }
  }
  console.error('[Klaw] gateway NOT FOUND! Checked:', candidates);
  return candidates[0]; // fallback
}
const ROOT_MJS = findRootMjs();

// Find system Node.js binary. Electron's process.execPath is the Electron binary,
// which breaks when entry.js tries to respawn with Node-only CLI flags.
function findNodeBinary() {
  const { execSync } = require('child_process');
  // 1. Bundled portable node (shipped with installer)
  const bundledPaths = [
    path.join(__dirname, 'node', 'node.exe'),           // electron/node/node.exe
    path.join(__dirname, '..', 'node', 'node.exe'),     // klaw/node/node.exe
    path.join(process.resourcesPath || '', 'node', 'node.exe'), // resources/node/node.exe
  ];
  for (const p of bundledPaths) {
    if (fs.existsSync(p)) {
      console.log('[Klaw] Found bundled node at:', p);
      return p;
    }
  }
  // 2. Check common system paths (fast, no shell)
  const commonPaths = process.platform === 'win32'
    ? ['C:\\Program Files\\nodejs\\node.exe', 'C:\\Program Files (x86)\\nodejs\\node.exe']
    : ['/usr/local/bin/node', '/usr/bin/node'];
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      console.log('[Klaw] Found system node at:', p);
      return p;
    }
  }
  // 3. Try `where node` (Windows) or `which node` (Unix)
  try {
    const cmd = process.platform === 'win32' ? 'where.exe node' : 'which node';
    const result = execSync(cmd, { timeout: 5000, encoding: 'utf8' }).trim().split('\n')[0].trim();
    if (result && fs.existsSync(result)) {
      console.log('[Klaw] Found node via PATH:', result);
      return result;
    }
  } catch {}
  // 4. Fallback to Electron's execPath
  console.warn('[Klaw] Node.js not found! Gateway may not start.');
  console.warn('[Klaw] Install Node.js from https://nodejs.org or place node.exe in electron/node/');
  return process.execPath;
}

const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;

let mainWindow = null;
let tray = null;
let gatewayProcess = null;
let isQuitting = false;
let gatewayReady = false;
let gatewayStoppedByUser = false;
let gatewayRestartAttempts = [];
let gatewayHealthStatus = 'unknown'; // 'connected' | 'disconnected' | 'unknown'

// ─── Single Instance Lock ────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── Gateway Management ──────────────────────────────
function getGatewayToken() {
  try {
    const config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
    return config?.gateway?.auth?.token || '';
  } catch {
    return '';
  }
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => {
      resolve(err.code === 'EADDRINUSE');
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port, '127.0.0.1');
  });
}

async function waitForGateway(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortInUse(GATEWAY_PORT)) return true;
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function startGateway() {
  // Check if already running
  if (await isPortInUse(GATEWAY_PORT)) {
    console.log('[Klaw] Gateway already running on port', GATEWAY_PORT);
    gatewayReady = true;
    updateTrayIcon();
    return true;
  }

  gatewayStoppedByUser = false;
  console.log('[Klaw] Starting gateway...');
  console.log('[Klaw] ROOT_MJS:', ROOT_MJS);
  console.log('[Klaw] ROOT_MJS exists:', fs.existsSync(ROOT_MJS));
  console.log('[Klaw] ROOT_CONFIG:', ROOT_CONFIG);
  console.log('[Klaw] __dirname:', __dirname);
  
  // Ensure config dir exists
  if (!fs.existsSync(KLAW_STATE_DIR)) {
    fs.mkdirSync(KLAW_STATE_DIR, { recursive: true });
  }

  // Clean stale lock files
  const tmpDir = path.join(require('os').tmpdir(), 'Klaw');
  if (fs.existsSync(tmpDir)) {
    try {
      const files = fs.readdirSync(tmpDir);
      for (const f of files) {
        if (f.endsWith('.lock')) {
          fs.unlinkSync(path.join(tmpDir, f));
        }
      }
    } catch {}
  }

  // Remove invalid plugin entries from config (bundled gateway has no extra plugins)
  try {
    if (fs.existsSync(ROOT_CONFIG)) {
      const cfg = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
      let changed = false;
      if (cfg.plugins) { delete cfg.plugins; changed = true; }
      if (cfg.identity) { delete cfg.identity; changed = true; }
      if (changed) {
        fs.writeFileSync(ROOT_CONFIG, JSON.stringify(cfg, null, 2), 'utf8');
        console.log('[Klaw] Cleaned config: removed plugin entries + legacy keys');
      }
    }
  } catch (e) {
    console.warn('[Klaw] Config cleanup failed:', e.message);
  }

  const env = {
    ...process.env,
    OPENCLAW_STATE_DIR: KLAW_STATE_DIR,
    OPENCLAW_CONFIG_PATH: ROOT_CONFIG,
    OPENCLAW_NO_RESPAWN: '1',
    OPENCLAW_NODE_OPTIONS_READY: '1',
    NODE_OPTIONS: '--disable-warning=ExperimentalWarning',
  };

  // Find Node.js: 1) bundled portable node, 2) system node
  const nodeBin = findNodeBinary();
  console.log('[Klaw] Using node binary:', nodeBin);

  const spawnArgs = [
    ROOT_MJS, 'gateway', '--verbose', '--allow-unconfigured', '--port', String(GATEWAY_PORT)
  ];

  gatewayProcess = spawn(nodeBin, spawnArgs, {
    cwd: path.dirname(ROOT_MJS),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
    windowsHide: true,
  });

  gatewayProcess.stdout?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log('[Gateway]', msg);
  });

  gatewayProcess.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('Ollama')) console.error('[Gateway]', msg);
  });

  gatewayProcess.on('error', (err) => {
    console.error('[Klaw] Gateway spawn error:', err.message);
  });

  gatewayProcess.on('exit', (code, signal) => {
    console.log(`[Klaw] Gateway exited (code=${code}, signal=${signal})`);
    gatewayProcess = null;
    gatewayReady = false;
    gatewayHealthStatus = 'disconnected';
    updateTrayIcon();

    // Auto-restart on unexpected crash
    if (!gatewayStoppedByUser && !isQuitting && code !== 0) {
      const now = Date.now();
      // Keep only attempts within last 60 seconds
      gatewayRestartAttempts = gatewayRestartAttempts.filter(t => now - t < 60000);

      if (gatewayRestartAttempts.length < 3) {
        gatewayRestartAttempts.push(now);
        console.log(`[Klaw] Gateway crashed, auto-restarting in 2s (attempt ${gatewayRestartAttempts.length}/3)...`);
        if (tray) {
          tray.displayBalloon({ title: 'Klaw', content: `Gateway crashed (code ${code}). Restarting...`, iconType: 'warning' });
        }
        setTimeout(async () => {
          if (!isQuitting && !gatewayStoppedByUser) {
            await startGateway();
            if (mainWindow && gatewayReady) mainWindow.reload();
          }
        }, 2000);
      } else {
        console.error('[Klaw] Gateway crashed 3 times in 60s, giving up.');
        if (tray) {
          tray.displayBalloon({ title: 'Klaw', content: 'Gateway keeps crashing. Please check logs.', iconType: 'error' });
        }
        dialog.showErrorBox('Klaw — Gateway Error',
          'The gateway has crashed repeatedly (3 times in 60 seconds).\n\nPlease check the logs or restart manually.');
      }
    }
  });

  // Wait for gateway to be ready
  const ready = await waitForGateway(30000);
  if (ready) {
    console.log('[Klaw] Gateway is ready!');
    gatewayReady = true;
    updateTrayIcon();
    return true;
  } else {
    console.error('[Klaw] Gateway failed to start within 30s');
    return false;
  }
}

function stopGateway() {
  gatewayStoppedByUser = true;
  if (gatewayProcess) {
    console.log('[Klaw] Stopping gateway (PID:', gatewayProcess.pid, ')...');
    const pid = gatewayProcess.pid;
    try {
      // Windows: taskkill /T kills entire process tree (node + children)
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
      } else {
        gatewayProcess.kill('SIGTERM');
        setTimeout(() => {
          try { process.kill(pid, 'SIGKILL'); } catch {}
        }, 3000);
      }
    } catch (e) {
      console.log('[Klaw] Gateway kill error (may already be dead):', e.message);
    }
    gatewayProcess = null;
  }
  gatewayReady = false;
  updateTrayIcon();
}

// ─── Auto Updater ────────────────────────────────────
function setupAutoUpdater() {
  if (!autoUpdater) { console.log('[Klaw] Auto-updater not available, skipping'); return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    console.log('[Klaw] Update available:', info.version);
    if (tray) {
      tray.displayBalloon({ title: 'Klaw', content: `Update v${info.version} downloading...`, iconType: 'info' });
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[Klaw] Update downloaded:', info.version);
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Klaw Update',
      message: `Version ${info.version} is ready to install.`,
      detail: 'The update will be installed when you restart Klaw.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        stopGateway();
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('[Klaw] Auto-update error:', err.message);
  });

  // Check for updates after 10 seconds, then every 4 hours
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 4 * 60 * 60 * 1000);
}

// ─── Trial / License System ──────────────────────────
const TRIAL_DAYS = 180; // 6 months free

function getTrialInfo() {
  const trialFile = path.join(KLAW_STATE_DIR, '.trial.json');
  try {
    return JSON.parse(fs.readFileSync(trialFile, 'utf8'));
  } catch {
    // First install — save install date
    const info = {
      installedAt: new Date().toISOString(),
      licenseKey: null,
      activated: false,
    };
    fs.mkdirSync(KLAW_STATE_DIR, { recursive: true });
    fs.writeFileSync(trialFile, JSON.stringify(info, null, 2), 'utf8');
    return info;
  }
}

function isTrialExpired() {
  const info = getTrialInfo();
  if (info.activated && info.licenseKey) return false; // Paid user
  const installDate = new Date(info.installedAt);
  const now = new Date();
  const daysPassed = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
  return daysPassed > TRIAL_DAYS;
}

function getTrialDaysLeft() {
  const info = getTrialInfo();
  if (info.activated && info.licenseKey) return -1; // Paid = unlimited
  const installDate = new Date(info.installedAt);
  const now = new Date();
  const daysPassed = Math.floor((now - installDate) / (1000 * 60 * 60 * 24));
  return Math.max(0, TRIAL_DAYS - daysPassed);
}

function activateLicense(key) {
  const trialFile = path.join(KLAW_STATE_DIR, '.trial.json');
  const info = getTrialInfo();
  info.licenseKey = key;
  info.activated = true;
  info.activatedAt = new Date().toISOString();
  fs.writeFileSync(trialFile, JSON.stringify(info, null, 2), 'utf8');
  return true;
}

// IPC for trial info
ipcMain.handle('get-trial-info', () => ({
  daysLeft: getTrialDaysLeft(),
  expired: isTrialExpired(),
  trialDays: TRIAL_DAYS,
  info: getTrialInfo(),
}));

ipcMain.handle('activate-license', (event, key) => {
  // TODO: Validate key with server later. For now accept any non-empty key.
  if (!key || key.trim().length < 8) return { success: false, error: 'Invalid key' };
  activateLicense(key.trim());
  return { success: true };
});

// ─── Health Check & Memory Monitor ───────────────────
function startHealthCheck() {
  const http = require('http');

  // Gateway health ping every 30s
  setInterval(() => {
    if (!gatewayReady && !gatewayProcess) return;
    const req = http.get(`${GATEWAY_URL}/health`, { timeout: 5000 }, (res) => {
      if (gatewayHealthStatus !== 'connected') {
        gatewayHealthStatus = 'connected';
        console.log('[Klaw] Gateway health: connected');
        if (tray) tray.setToolTip('Klaw — Connected');
      }
    });
    req.on('error', () => {
      // Fallback: check port
      isPortInUse(GATEWAY_PORT).then(inUse => {
        if (inUse) {
          if (gatewayHealthStatus !== 'connected') {
            gatewayHealthStatus = 'connected';
            if (tray) tray.setToolTip('Klaw — Connected');
          }
        } else if (gatewayProcess) {
          gatewayHealthStatus = 'disconnected';
          console.warn('[Klaw] Gateway unreachable');
          if (tray) tray.setToolTip('Klaw — Reconnecting...');
        }
      });
    });
    req.on('timeout', () => req.destroy());
  }, 30000);

  // Memory monitoring every 60s
  setInterval(() => {
    const mem = process.memoryUsage();
    const heapGB = mem.heapUsed / (1024 * 1024 * 1024);
    if (heapGB > 2) {
      console.error(`[Klaw] Heap ${heapGB.toFixed(2)}GB > 2GB — restarting gateway for memory protection`);
      stopGateway();
      setTimeout(() => startGateway(), 2000);
    } else if (heapGB > 1.5) {
      console.warn(`[Klaw] Heap ${heapGB.toFixed(2)}GB > 1.5GB — warning`);
    }
  }, 60000);
}

// IPC: renderer can check gateway health
ipcMain.handle('get-gateway-health', () => ({
  status: gatewayHealthStatus,
  ready: gatewayReady,
}));

// ─── First Run Check ─────────────────────────────────
function isFirstRun() {
  try {
    const config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
    // Check if wizard was already run
    if (config?.wizard?.lastRunAt) return false;
    // Check if any AI provider key is set in env
    const envKeys = config?.env || {};
    const hasEnvKey = Object.keys(envKeys).some(k =>
      k.includes('API_KEY') || k.includes('TOKEN') || k === 'OLLAMA_API_KEY'
    );
    // Check if model is configured
    const hasModel = config?.agents?.defaults?.model?.primary;
    return !hasEnvKey && !hasModel;
  } catch {
    return true; // No config = first run
  }
}

// ─── Window ──────────────────────────────────────────
function createWindow() {
  const token = getGatewayToken();
  const firstRun = isFirstRun();
  
  mainWindow = new BrowserWindow({
    width: firstRun ? 660 : 1200,
    height: firstRun ? 850 : 800,
    minWidth: firstRun ? 600 : 600,
    minHeight: firstRun ? 700 : 400,
    title: 'Klaw',
    icon: getIconPath(),
    backgroundColor: '#0f0f13',
    show: false,
    resizable: !firstRun,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: false,
      nodeIntegration: true,
      webviewTag: true,
    },
    autoHideMenuBar: true,
    titleBarStyle: 'default',
  });

  if (firstRun) {
    console.log('[Klaw] Loading setup wizard');
    mainWindow.loadFile(path.join(__dirname, 'setup.html'));
  } else {
    // Show splash screen while gateway starts
    console.log('[Klaw] Loading splash screen');
    mainWindow.loadFile(path.join(__dirname, 'splash.html'));
    
    // Switch to gateway URL when ready (or after splash animation)
    const gatewayUrl = token 
      ? `${GATEWAY_URL}/?token=${token}` 
      : GATEWAY_URL;
    
    function loadGatewayWhenReady() {
      const minSplashTime = 4000; // Show splash for at least 4s
      const startTime = Date.now();
      
      function tryLoad() {
        const elapsed = Date.now() - startTime;
        if (gatewayReady && elapsed >= minSplashTime) {
          console.log('[Klaw] Loading gateway URL:', gatewayUrl);
          mainWindow.loadURL(gatewayUrl).catch(err => {
            console.error('[Klaw] Failed to load gateway URL:', err.message);
          });
        } else if (elapsed > 30000) {
          // Timeout — load anyway (might show error page)
          console.warn('[Klaw] Splash timeout, loading gateway URL anyway');
          mainWindow.loadURL(gatewayUrl).catch(() => {});
        } else {
          setTimeout(tryLoad, 500);
        }
      }
      tryLoad();
    }
    loadGatewayWhenReady();
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Klaw] Page load failed:', errorCode, errorDescription);
  });

  mainWindow.once('ready-to-show', () => {
    console.log('[Klaw] Window ready-to-show');
    mainWindow.show();
    mainWindow.focus();
  });

  // Fallback: force show after 5s if ready-to-show didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('[Klaw] Fallback: forcing window show');
      mainWindow.show();
      mainWindow.focus();
    }
  }, 5000);

  // Inject Plugin Store button into Gateway Dashboard sidebar
  // Load theme CSS once
  let rootThemeCss = '';
  try {
    const cssPath = path.join(__dirname, 'klaw-theme.css');
    rootThemeCss = fs.readFileSync(cssPath, 'utf8');
    console.log('[Klaw] Theme CSS loaded from:', cssPath, `(${rootThemeCss.length} bytes)`);
  } catch (err) {
    console.error('[Klaw] Failed to read theme CSS:', err.message);
  }

  function injectTheme() {
    if (!rootThemeCss || !mainWindow) return;
    mainWindow.webContents.insertCSS(rootThemeCss).then(() => {
      console.log('[Klaw] Theme CSS injected successfully');
    }).catch(err => console.error('[Klaw] CSS inject failed:', err.message));
  }

  // Inject on every navigation (SPA reloads, page changes)
  mainWindow.webContents.on('dom-ready', () => {
    const url = mainWindow.webContents.getURL();
    if (url.includes('localhost') || url.includes('127.0.0.1')) {
      injectTheme();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow.webContents.getURL();
    // Only inject on gateway dashboard pages (not setup wizard or plugin store)
    if (currentUrl.includes('localhost') || currentUrl.includes('127.0.0.1')) {
      injectTheme();
      mainWindow.webContents.executeJavaScript(`
        (function() {
          // Wait for sidebar to render
          function injectPluginStore() {
            const sidebar = document.querySelector('nav, [class*="sidebar"], [class*="Sidebar"], aside');
            if (!sidebar) { setTimeout(injectPluginStore, 1000); return; }
            
            // Don't inject twice
            if (document.getElementById('root-plugin-store-btn')) return;

            // Find the last section in sidebar
            const sections = sidebar.querySelectorAll('[class*="section"], [class*="group"], ul, div');
            
            // Create plugin store button
            const btn = document.createElement('div');
            btn.id = 'root-plugin-store-btn';
            btn.innerHTML = '<span style="margin-right:8px">🧩</span> Plugin Store';
            btn.style.cssText = 'padding:10px 16px;cursor:pointer;color:#999;font-size:14px;display:flex;align-items:center;border-top:1px solid #1e1e2e;margin-top:8px;transition:all 0.15s;';
            btn.onmouseover = function() { this.style.background='#1a1a25'; this.style.color='#e5e5e5'; };
            btn.onmouseout = function() { this.style.background=''; this.style.color='#999'; };
            btn.onclick = function() {
              try {
                require('electron').ipcRenderer.send('open-plugin-store');
              } catch(e) {
                console.error('Plugin store click failed:', e);
              }
            };
            
            sidebar.appendChild(btn);

            // Browser button
            if (!document.getElementById('root-browser-btn')) {
              const btn2 = document.createElement('div');
              btn2.id = 'root-browser-btn';
              btn2.innerHTML = '<span style="margin-right:8px">🌐</span> Browser';
              btn2.style.cssText = 'padding:10px 16px;cursor:pointer;color:#999;font-size:14px;display:flex;align-items:center;transition:all 0.15s;';
              btn2.onmouseover = function() { this.style.background='#1a1a25'; this.style.color='#e5e5e5'; };
              btn2.onmouseout = function() { this.style.background=''; this.style.color='#999'; };
              btn2.onclick = function() {
                try { require('electron').ipcRenderer.send('open-browser'); } catch(e) {}
              };
              sidebar.appendChild(btn2);
            }
          }
          
          // Try injection after short delay for SPA render
          setTimeout(injectPluginStore, 1500);
          setTimeout(injectPluginStore, 3000);

          // ── Klaw Branding Injection (Optimized - no DOM blocking) ──
          function rebrandUI() {
            // Skip if already branded (check flag)
            if (window._rootBranded) return;
            
            // Update document title
            if (document.title !== 'Klaw') document.title = 'Klaw';
            
            // Target ONLY specific elements, not all DOM
            // 1. Topbar subtitle
            const topbar = document.querySelector('.topbar, [class*="topbar"]');
            if (topbar) {
              const subtitle = topbar.querySelector('small, [class*="subtitle"]');
              if (subtitle && subtitle.textContent.includes('GATEWAY')) {
                subtitle.textContent = 'AI DESKTOP AGENT';
              }
              // Logo text
              const logoText = topbar.querySelector('span');
              if (logoText && logoText.textContent.trim() === 'Klaw') {
                logoText.textContent = 'Klaw';
              }
            }
            
            // 2. Page titles - only h1/h2 that say "Root Control"
            document.querySelectorAll('h1, h2').forEach(el => {
              if (el.textContent.trim() === 'Root Control') {
                el.textContent = 'Klaw';
              }
            });
            
            // 3. Chat description - only p/span near chat heading
            const chatDesc = document.querySelector('[class*="description"], [class*="subtitle"]');
            if (chatDesc && chatDesc.textContent.includes('Direct gateway chat')) {
              chatDesc.textContent = 'Chat with your AI assistant';
            }
            
            // Mark as done after first successful run
            if (topbar || document.querySelector('h1')) {
              window._rootBranded = true;
            }
          }
          
          // Run a few times on initial load only
          setTimeout(rebrandUI, 500);
          setTimeout(rebrandUI, 1500);
          setTimeout(rebrandUI, 3000);
          
          // Light observer - only watch for major navigation changes, not all mutations
          let lastPath = location.pathname;
          setInterval(() => {
            if (location.pathname !== lastPath) {
              lastPath = location.pathname;
              window._rootBranded = false; // Reset flag on navigation
              setTimeout(rebrandUI, 200);
            }
          }, 500);

          // ── Computer Use: /do command ──
          (function() {
            // Intercept /do commands in chat input
            document.addEventListener('keydown', function(e) {
              if (e.key !== 'Enter' || e.shiftKey) return;
              
              // Find the chat textarea
              const textarea = document.querySelector('textarea, [contenteditable="true"]');
              if (!textarea) return;
              
              const text = (textarea.value || textarea.textContent || '').trim();
              if (!text.startsWith('/do ')) return;
              
              // Extract goal
              const goal = text.slice(4).trim();
              if (!goal) return;
              
              // Prevent sending to gateway
              e.preventDefault();
              e.stopPropagation();
              
              // Clear input
              if (textarea.value !== undefined) {
                textarea.value = '';
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
              } else {
                textarea.textContent = '';
              }
              
              // Show status in chat area (inject a visual indicator)
              const chatArea = document.querySelector('[class*="messages"], [class*="chat-scroll"], [class*="message-list"]');
              if (chatArea) {
                const statusEl = document.createElement('div');
                statusEl.id = 'cu-status';
                statusEl.style.cssText = 'padding:12px 18px;margin:8px 0;background:linear-gradient(135deg,rgba(56,189,248,0.1),rgba(52,211,153,0.05));border:1px solid rgba(56,189,248,0.15);border-radius:12px;color:#38bdf8;font-size:13px;display:flex;align-items:center;gap:8px;';
                statusEl.innerHTML = '🖥️ <strong>Computer Use</strong> — Starting: ' + goal.substring(0, 80) + '...';
                chatArea.appendChild(statusEl);
                chatArea.scrollTop = chatArea.scrollHeight;
              }
              
              // Start Computer Use via IPC
              if (window.klawApp && window.klawApp.computerUse) {
                window.klawApp.computerUse.start(goal).then(result => {
                  console.log('[Computer Use] Started:', result);
                }).catch(err => {
                  console.error('[Computer Use] Failed:', err);
                  const el = document.getElementById('cu-status');
                  if (el) el.innerHTML = '❌ <strong>Computer Use Failed</strong> — ' + (err.message || err);
                });
                
                // Listen for events
                window.klawApp.computerUse.onEvent((data) => {
                  const el = document.getElementById('cu-status');
                  if (!el) return;
                  
                  if (data.type === 'step') {
                    el.innerHTML = '🖥️ <strong>Step ' + data.stepNum + '</strong> — ' + (data.thought || data.action || '...');
                    el.style.borderColor = 'rgba(56,189,248,0.15)';
                  } else if (data.type === 'done') {
                    el.innerHTML = '✅ <strong>Done!</strong> — ' + (data.summary || 'Task completed');
                    el.style.borderColor = 'rgba(52,211,153,0.3)';
                    el.style.background = 'linear-gradient(135deg,rgba(52,211,153,0.1),rgba(52,211,153,0.05))';
                    el.style.color = '#34d399';
                  } else if (data.type === 'error') {
                    el.innerHTML = '❌ <strong>Error</strong> — ' + (data.message || 'Something went wrong');
                    el.style.borderColor = 'rgba(248,113,113,0.3)';
                    el.style.color = '#f87171';
                  } else if (data.type === 'stopped') {
                    el.innerHTML = '⏹️ <strong>Stopped</strong> — ' + (data.reason || 'Agent stopped');
                    el.style.color = '#fbbf24';
                  }
                  
                  const chatArea2 = el.parentElement;
                  if (chatArea2) chatArea2.scrollTop = chatArea2.scrollHeight;
                });
              }
            }, true); // useCapture = true to intercept before chat sends
          })();

          // ── Login: /login command ──
          (function() {
            document.addEventListener('keydown', function(e) {
              if (e.key !== 'Enter' || e.shiftKey) return;
              const textarea = document.querySelector('textarea, [contenteditable="true"]');
              if (!textarea) return;
              const text = (textarea.value || textarea.textContent || '').trim();
              if (!text.startsWith('/login ')) return;
              
              const site = text.slice(7).trim();
              if (!site) return;
              
              e.preventDefault();
              e.stopPropagation();
              if (textarea.value !== undefined) { textarea.value = ''; textarea.dispatchEvent(new Event('input', { bubbles: true })); }
              else { textarea.textContent = ''; }
              
              const chatArea = document.querySelector('[class*="messages"], [class*="chat-scroll"], [class*="message-list"]');
              if (chatArea) {
                const el = document.createElement('div');
                el.id = 'login-status';
                el.style.cssText = 'padding:12px 18px;margin:8px 0;background:linear-gradient(135deg,rgba(251,191,36,0.1),rgba(251,191,36,0.05));border:1px solid rgba(251,191,36,0.15);border-radius:12px;color:#fbbf24;font-size:13px;';
                el.innerHTML = '🔐 <strong>Login</strong> — Opening ' + site + '... Log in manually in the browser window.';
                chatArea.appendChild(el);
                chatArea.scrollTop = chatArea.scrollHeight;
              }
              
              if (window.klawApp && window.klawApp.login) {
                window.klawApp.login.start(site).then(result => {
                  const el = document.getElementById('login-status');
                  if (!el) return;
                  if (result.success) {
                    el.innerHTML = '✅ <strong>Logged in!</strong> — ' + result.message;
                    el.style.borderColor = 'rgba(52,211,153,0.3)';
                    el.style.color = '#34d399';
                  } else {
                    el.innerHTML = '❌ <strong>Login failed</strong> — ' + result.message;
                    el.style.borderColor = 'rgba(248,113,113,0.3)';
                    el.style.color = '#f87171';
                  }
                });
                
                window.klawApp.login.onEvent((evt) => {
                  const el = document.getElementById('login-status');
                  if (!el) return;
                  if (evt.type === 'waiting') {
                    el.innerHTML = '🔐 <strong>Waiting...</strong> — Please log in to ' + site + ' (' + evt.data.elapsed + 's)';
                  } else if (evt.type === 'success') {
                    el.innerHTML = '✅ <strong>Logged in!</strong> — Session saved for ' + site;
                    el.style.borderColor = 'rgba(52,211,153,0.3)';
                    el.style.color = '#34d399';
                  }
                });
              }
            }, true);
          })();

          // ── Notification Sound on AI Reply ──
          (function() {
            // Create subtle notification sound using Web Audio API
            function playNotifSound() {
              try {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.setValueAtTime(800, ctx.currentTime);
                osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.1);
                gain.gain.setValueAtTime(0.08, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.15);
              } catch(e) {}
            }

            // Watch for new assistant messages
            let lastMsgCount = document.querySelectorAll('[data-role="assistant"], [class*="assistant"]').length;
            const msgObserver = new MutationObserver(() => {
              const msgs = document.querySelectorAll('[data-role="assistant"], [class*="assistant"]');
              if (msgs.length > lastMsgCount && !document.hasFocus()) {
                playNotifSound();
                // Also flash taskbar
                if (window.klawApp && window.klawApp.flashFrame) {
                  window.klawApp.flashFrame();
                }
              }
              lastMsgCount = msgs.length;
            });
            setTimeout(() => {
              msgObserver.observe(document.body, { childList: true, subtree: true });
            }, 3000);
          })();
        })();
      `).catch(() => {});
    }
  });

  // Quit app on window close
  mainWindow.on('close', () => {
    isQuitting = true;
    stopGateway();
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http') && !url.includes('localhost')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// ─── System Tray ─────────────────────────────────────
function getIconPath() {
  // Use the SVG favicon as base, or PNG if available
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const svgPath = path.join(__dirname, '..', 'dist', 'control-ui', 'favicon.svg');
  if (fs.existsSync(pngPath)) return pngPath;
  if (fs.existsSync(svgPath)) return svgPath;
  return null;
}

function createTray() {
  // Use file-based icon (buffer-based nativeImage can crash)
  const icoPath = path.join(__dirname, 'assets', 'icon.ico');
  const pngPath = path.join(__dirname, 'assets', 'icon.png');
  const iconPath = process.platform === 'win32' && fs.existsSync(icoPath) ? icoPath : pngPath;
  let trayIcon = nativeImage.createFromPath(iconPath);
  // Resize for tray (16x16 on Windows)
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Klaw');
  updateTrayMenu();

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: `Klaw — ${gatewayReady ? '● Running' : '○ Stopped'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Open Klaw',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    {
      label: 'Open in Browser',
      click: () => {
        const token = getGatewayToken();
        const url = token ? `${GATEWAY_URL}/?token=${token}` : GATEWAY_URL;
        shell.openExternal(url);
      },
    },
    { type: 'separator' },
    {
      label: gatewayReady ? 'Restart Gateway' : 'Start Gateway',
      click: async () => {
        if (gatewayReady) {
          stopGateway();
          await new Promise(r => setTimeout(r, 2000));
        }
        await startGateway();
        if (mainWindow) {
          mainWindow.reload();
        }
      },
    },
    {
      label: 'Stop Gateway',
      enabled: gatewayReady,
      click: () => stopGateway(),
    },
    { type: 'separator' },
    {
      label: '🧩 Plugin Store',
      click: () => {
        if (mainWindow) {
          mainWindow.setResizable(true);
          mainWindow.setMinimumSize(800, 500);
          mainWindow.setSize(1100, 750);
          mainWindow.center();
          mainWindow.loadFile(path.join(__dirname, 'plugin-store.html'));
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '🌐 Browser',
      click: () => {
        if (mainWindow) {
          mainWindow.setResizable(true);
          mainWindow.setMinimumSize(900, 500);
          mainWindow.setSize(1400, 850);
          mainWindow.center();
          mainWindow.loadFile(path.join(__dirname, 'browser.html'));
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Gateway Dashboard',
      click: () => {
        const token = getGatewayToken();
        const url = token ? `${GATEWAY_URL}/overview?token=${token}` : `${GATEWAY_URL}/overview`;
        shell.openExternal(url);
      },
    },
    {
      label: 'Config Folder',
      click: () => shell.openPath(KLAW_STATE_DIR),
    },
    { type: 'separator' },
    {
      label: 'Quit Klaw',
      click: () => {
        isQuitting = true;
        stopGateway();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function updateTrayIcon() {
  updateTrayMenu();
  if (tray) {
    tray.setToolTip(`Klaw — ${gatewayReady ? 'Running' : 'Stopped'}`);
  }
}

// ─── App Lifecycle ───────────────────────────────────
app.whenReady().then(async () => {
  // Clean stale lock files from previous crashes
  try {
    const lockDir = path.join(require('os').tmpdir(), 'Klaw');
    if (fs.existsSync(lockDir)) {
      fs.readdirSync(lockDir).filter(f => f.endsWith('.lock')).forEach(f => {
        try { fs.unlinkSync(path.join(lockDir, f)); } catch {}
      });
      console.log('[Klaw] Cleaned stale lock files');
    }
  } catch {}

  try {
    // Create tray first (shows immediately)
    createTray();
  } catch (e) {
    console.error('[Klaw] Tray creation failed:', e.message);
  }

  // Start gateway (skip on first run — wizard will start it after setup)
  const configExists = fs.existsSync(ROOT_CONFIG);
  let started = false;
  if (configExists) {
    started = await startGateway();
    startHealthCheck();
    setupAutoUpdater();
  } else {
    console.log('[Klaw] First run detected — skipping gateway, showing setup wizard');
  }

  // Trial check — save install date on first run
  const trialInfo = getTrialInfo();
  const daysLeft = getTrialDaysLeft();
  console.log(`[Klaw] Trial: ${daysLeft} days left (installed: ${trialInfo.installedAt})`);

  // Create window
  createWindow();

  // Show trial expiry warning if less than 30 days left
  if (daysLeft >= 0 && daysLeft <= 30 && !trialInfo.activated) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Klaw — Trial Ending Soon',
      message: `Your free trial expires in ${daysLeft} days.`,
      detail: 'Visit klaw.ai to purchase a license key.',
      buttons: ['OK', 'Enter License Key'],
    }).then((result) => {
      if (result.response === 1) {
        // TODO: Show license key input dialog
        shell.openExternal('https://kulharir7.github.io/root-ai/#pricing');
      }
    });
  }

  // Block if trial expired
  if (isTrialExpired()) {
    dialog.showMessageBox(mainWindow, {
      type: 'error',
      title: 'Klaw — Trial Expired',
      message: 'Your 6-month free trial has ended.',
      detail: 'Please purchase a license to continue using Klaw.',
      buttons: ['Buy License', 'Enter Key', 'Quit'],
    }).then((result) => {
      if (result.response === 0) {
        shell.openExternal('https://kulharir7.github.io/root-ai/#pricing');
        app.quit();
      } else if (result.response === 1) {
        // TODO: Show license key input dialog
      } else {
        app.quit();
      }
    });
  }

  // If gateway didn't start (and not first run), show error
  if (!started && configExists) {
    dialog.showErrorBox(
      'Klaw — Gateway Error',
      'Failed to start the Klaw gateway.\n\nMake sure no other process is using port ' + GATEWAY_PORT
    );
  }

  // Register global shortcuts
  try {
    // Ctrl+Space — Quick toggle Klaw from anywhere
    globalShortcut.register('CommandOrControl+Space', () => {
      if (mainWindow) {
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.restore();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });

    globalShortcut.register('CommandOrControl+Shift+R', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.focus();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      } else {
        createWindow();
      }
    });

    // Ctrl+Shift+P → Plugin Store
    globalShortcut.register('CommandOrControl+Shift+P', () => {
      if (!mainWindow) createWindow();
      mainWindow.setResizable(true);
      mainWindow.setMinimumSize(800, 500);
      mainWindow.setSize(1100, 750);
      mainWindow.center();
      mainWindow.loadFile(path.join(__dirname, 'plugin-store.html'));
      mainWindow.show();
      mainWindow.focus();
    });
    // Ctrl+K → Quick Actions Palette
    globalShortcut.register('CommandOrControl+K', () => {
      showQuickActions();
    });

    // Ctrl+Shift+S → Screen Vision (capture screenshot + send to AI)
    globalShortcut.register('CommandOrControl+Shift+S', async () => {
      try {
        await captureScreen();
      } catch (e) {
        console.error('[Klaw] Screen capture failed:', e);
      }
    });

  } catch (e) {
    console.error('[Klaw] Global shortcut failed:', e.message);
  }
});

// ─── Screen Vision ───────────────────────────────────
let captureWindow = null;

async function captureScreen() {
  const { desktopCapturer, screen: electronScreen } = require('electron');

  // Hide main window temporarily so it's not in screenshot
  const wasVisible = mainWindow?.isVisible();
  if (mainWindow) mainWindow.hide();
  await new Promise(r => setTimeout(r, 300));

  // Take screenshot of all displays
  const displays = electronScreen.getAllDisplays();
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;
  const scaleFactor = primaryDisplay.scaleFactor;

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: width * scaleFactor, height: height * scaleFactor },
    });

    if (sources.length === 0) {
      console.error('[Klaw] No screen sources found');
      if (wasVisible && mainWindow) mainWindow.show();
      return;
    }

    const screenshot = sources[0].thumbnail;
    const screenshotPath = path.join(KLAW_STATE_DIR, 'screenshots');
    if (!fs.existsSync(screenshotPath)) fs.mkdirSync(screenshotPath, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(screenshotPath, `screen-${timestamp}.png`);
    fs.writeFileSync(filePath, screenshot.toPNG());
    console.log('[Klaw] Screenshot saved:', filePath);

    // Show region selector overlay
    showCaptureOverlay(filePath, screenshot, width, height, scaleFactor);

  } catch (e) {
    console.error('[Klaw] Screen capture error:', e);
    if (wasVisible && mainWindow) mainWindow.show();
  }
}

function showCaptureOverlay(screenshotPath, screenshot, screenWidth, screenHeight, scaleFactor) {
  if (captureWindow) {
    captureWindow.close();
    captureWindow = null;
  }

  const { screen: electronScreen } = require('electron');
  const primaryDisplay = electronScreen.getPrimaryDisplay();

  captureWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x,
    y: primaryDisplay.bounds.y,
    width: screenWidth,
    height: screenHeight,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    fullscreen: true,
    skipTaskbar: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  const dataUrl = screenshot.toDataURL();

  captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; cursor: crosshair; }
  body { overflow: hidden; }
  #bg { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; }
  #overlay { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.3); }
  #selection { position: fixed; border: 2px solid #7c3aed; background: rgba(124,58,237,0.1); display: none; }
  #toolbar { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #111118; border: 1px solid #2a2a3a; border-radius: 12px; padding: 12px 20px; display: flex; gap: 12px; align-items: center; z-index: 10; }
  .tool-btn { background: #7c3aed; color: #fff; border: none; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
  .tool-btn:hover { background: #6d28d9; }
  .tool-btn.secondary { background: #2a2a3a; }
  .tool-btn.secondary:hover { background: #3a3a4a; }
  #hint { color: #999; font-size: 13px; font-family: -apple-system, sans-serif; }
  #prompt-bar { position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: #111118; border: 1px solid #2a2a3a; border-radius: 12px; padding: 12px 16px; display: none; z-index: 10; width: 500px; }
  #prompt-input { background: #0a0a0f; border: 1px solid #2a2a3a; color: #e5e5e5; padding: 10px 14px; border-radius: 8px; font-size: 14px; width: 100%; outline: none; font-family: -apple-system, sans-serif; }
  #prompt-input:focus { border-color: #7c3aed; }
  #prompt-label { color: #888; font-size: 12px; margin-bottom: 8px; display: block; font-family: -apple-system, sans-serif; }
</style>
</head>
<body>
  <img id="bg" src="${dataUrl}">
  <div id="overlay"></div>
  <div id="selection"></div>
  <div id="prompt-bar">
    <label id="prompt-label">Ask AI about this screenshot:</label>
    <input id="prompt-input" type="text" placeholder="What's this? / Fix this error / Summarize..." autofocus>
  </div>
  <div id="toolbar">
    <span id="hint">Drag to select region · Press Enter to capture full screen · Esc to cancel</span>
    <button class="tool-btn" id="btn-full" onclick="sendFull()">📸 Full Screen</button>
    <button class="tool-btn secondary" onclick="cancel()">✕ Cancel</button>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    const sel = document.getElementById('selection');
    const promptBar = document.getElementById('prompt-bar');
    const promptInput = document.getElementById('prompt-input');
    let startX, startY, isDrawing = false, hasSelection = false;
    let cropRect = null;

    document.getElementById('overlay').addEventListener('mousedown', (e) => {
      startX = e.clientX; startY = e.clientY;
      isDrawing = true; hasSelection = false;
      sel.style.display = 'block';
      sel.style.left = startX + 'px';
      sel.style.top = startY + 'px';
      sel.style.width = '0'; sel.style.height = '0';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      const x = Math.min(e.clientX, startX);
      const y = Math.min(e.clientY, startY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      sel.style.left = x + 'px'; sel.style.top = y + 'px';
      sel.style.width = w + 'px'; sel.style.height = h + 'px';
    });

    document.addEventListener('mouseup', (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      if (w > 10 && h > 10) {
        hasSelection = true;
        cropRect = {
          x: Math.min(e.clientX, startX),
          y: Math.min(e.clientY, startY),
          width: w, height: h
        };
        showPrompt();
      }
    });

    function showPrompt() {
      promptBar.style.display = 'block';
      promptInput.focus();
    }

    function sendFull() {
      cropRect = null;
      showPrompt();
    }

    function cancel() {
      ipcRenderer.send('screen-vision-cancel');
    }

    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const prompt = promptInput.value.trim() || 'What is shown in this screenshot? Describe and analyze it.';
        ipcRenderer.send('screen-vision-send', { crop: cropRect, prompt, scaleFactor: ${scaleFactor || 1} });
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cancel();
      if (e.key === 'Enter' && !promptBar.style.display.includes('block')) sendFull();
    });
  </script>
</body>
</html>
  `)}`);

  captureWindow.on('closed', () => { captureWindow = null; });
}

// ─── Quick Actions Palette ────────────────────────────
let quickWindow = null;

function showQuickActions() {
  if (quickWindow) {
    quickWindow.focus();
    return;
  }

  const { screen: electronScreen } = require('electron');
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width: screenW } = primaryDisplay.workAreaSize;

  const winW = 680;
  const winH = 480;
  const x = Math.round((screenW - winW) / 2);
  const y = 120; // Near top of screen like Spotlight

  quickWindow = new BrowserWindow({
    x, y,
    width: winW,
    height: winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  quickWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: transparent;
    overflow: hidden;
  }
  .container {
    background: #111118;
    border: 1px solid #2a2a3a;
    border-radius: 16px;
    box-shadow: 0 25px 60px rgba(0,0,0,0.6);
    overflow: hidden;
    max-height: 470px;
  }
  .search-box {
    display: flex;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid #1e1e2e;
    gap: 12px;
  }
  .search-icon { color: #7c3aed; font-size: 20px; }
  .search-box input {
    flex: 1;
    background: none;
    border: none;
    color: #fff;
    font-size: 18px;
    outline: none;
    font-family: inherit;
  }
  .search-box input::placeholder { color: #555; }
  .shortcut-hint { color: #444; font-size: 11px; background: #1a1a25; padding: 3px 8px; border-radius: 5px; }
  .results {
    max-height: 380px;
    overflow-y: auto;
    padding: 8px;
  }
  .results::-webkit-scrollbar { width: 4px; }
  .results::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 4px; }
  .section-label {
    padding: 8px 12px 4px;
    font-size: 11px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 1px;
  }
  .item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.1s;
  }
  .item:hover, .item.selected { background: #1e1e2e; }
  .item.selected { border-left: 3px solid #7c3aed; }
  .item-icon {
    width: 36px;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #1a1a25;
    border-radius: 10px;
    font-size: 18px;
    flex-shrink: 0;
  }
  .item-info { flex: 1; min-width: 0; }
  .item-name { font-size: 14px; color: #e5e5e5; font-weight: 500; }
  .item-desc { font-size: 12px; color: #666; margin-top: 1px; }
  .item-shortcut { font-size: 11px; color: #555; background: #1a1a25; padding: 2px 8px; border-radius: 5px; }
  .empty { padding: 40px; text-align: center; color: #555; font-size: 14px; }
  .ai-mode { padding: 12px 16px; border-top: 1px solid #1e1e2e; display: none; }
  .ai-mode.show { display: flex; align-items: center; gap: 10px; }
  .ai-badge { background: #7c3aed33; color: #a78bfa; padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; }
  .ai-hint { color: #888; font-size: 12px; }
</style>
</head>
<body>
<div class="container">
  <div class="search-box">
    <span class="search-icon">⚡</span>
    <input id="search" type="text" placeholder="Type a command, ask AI, or search..." autofocus>
    <span class="shortcut-hint">ESC to close</span>
  </div>
  <div class="results" id="results"></div>
  <div class="ai-mode" id="ai-mode">
    <span class="ai-badge">🤖 AI</span>
    <span class="ai-hint">Press Enter to ask Klaw</span>
  </div>
</div>
<script>
  const { ipcRenderer } = require('electron');
  const searchInput = document.getElementById('search');
  const resultsEl = document.getElementById('results');
  const aiMode = document.getElementById('ai-mode');
  let selectedIdx = 0;
  let filteredActions = [];

  const ACTIONS = [
    { icon: '💬', name: 'Open Chat', desc: 'Go to Klaw chat', action: 'open-chat', section: 'Navigation' },
    { icon: '🧩', name: 'Plugin Store', desc: 'Browse and install plugins', action: 'open-plugin-store', section: 'Navigation' },
    { icon: '🌐', name: 'Browser', desc: 'AI-powered browser with split chat view', action: 'open-browser', shortcut: 'Ctrl+Shift+B', section: 'Navigation' },
    { icon: '📸', name: 'Screen Vision', desc: 'Capture screenshot + AI analyze', action: 'screen-vision', shortcut: 'Ctrl+Shift+S', section: 'Tools' },
    { icon: '🔄', name: 'Restart Gateway', desc: 'Restart the AI gateway', action: 'restart-gateway', section: 'Tools' },
    { icon: '📁', name: 'Open Config', desc: 'Open Klaw config folder', action: 'open-config', section: 'Tools' },
    { icon: '🌐', name: 'Gateway Dashboard', desc: 'Open gateway admin panel', action: 'open-dashboard', section: 'Tools' },
    { icon: '⚙️', name: 'Setup Wizard', desc: 'Reconfigure Klaw', action: 'open-setup', section: 'Settings' },
    { icon: '🔑', name: 'Change API Key', desc: 'Update your AI provider key', action: 'open-setup', section: 'Settings' },
    { icon: '🧠', name: 'Ollama Cloud', desc: 'Free 700B+ AI models', action: 'open-ext:https://ollama.com', section: 'Links' },
    { icon: '📖', name: 'Documentation', desc: 'Klaw docs and guides', action: 'open-ext:https://github.com/kulharir7/klaw-gateway', section: 'Links' },
    { icon: '🐛', name: 'Report Bug', desc: 'Report an issue on GitHub', action: 'open-ext:https://github.com/kulharir7/klaw-gateway/issues', section: 'Links' },
    { icon: '❌', name: 'Quit Klaw', desc: 'Close the application', action: 'quit', section: 'System' },
  ];

  function render() {
    const query = searchInput.value.toLowerCase().trim();
    
    // Show AI mode hint when typing a question
    aiMode.classList.toggle('show', query.length > 3 && !filteredActions.length);

    if (!query) {
      filteredActions = ACTIONS;
    } else {
      filteredActions = ACTIONS.filter(a =>
        a.name.toLowerCase().includes(query) ||
        a.desc.toLowerCase().includes(query)
      );
    }

    if (selectedIdx >= filteredActions.length) selectedIdx = 0;

    // Group by section
    const sections = {};
    filteredActions.forEach(a => {
      if (!sections[a.section]) sections[a.section] = [];
      sections[a.section].push(a);
    });

    let html = '';
    let idx = 0;
    for (const [section, items] of Object.entries(sections)) {
      html += '<div class="section-label">' + section + '</div>';
      for (const item of items) {
        const selected = idx === selectedIdx ? 'selected' : '';
        html += '<div class="item ' + selected + '" data-idx="' + idx + '" onclick="execute(' + idx + ')">';
        html += '<div class="item-icon">' + item.icon + '</div>';
        html += '<div class="item-info"><div class="item-name">' + item.name + '</div>';
        html += '<div class="item-desc">' + item.desc + '</div></div>';
        if (item.shortcut) html += '<span class="item-shortcut">' + item.shortcut + '</span>';
        html += '</div>';
        idx++;
      }
    }

    if (!filteredActions.length && query) {
      html = '<div class="empty">No commands found — press Enter to ask AI</div>';
    }

    resultsEl.innerHTML = html;
  }

  function execute(idx) {
    const action = filteredActions[idx];
    if (!action) {
      // Send as AI question
      const q = searchInput.value.trim();
      if (q) ipcRenderer.send('quick-action', { type: 'ai-ask', query: q });
      return;
    }
    ipcRenderer.send('quick-action', { type: action.action, query: searchInput.value });
  }

  searchInput.addEventListener('input', () => { selectedIdx = 0; render(); });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') ipcRenderer.send('quick-action', { type: 'close' });
    if (e.key === 'ArrowDown') { e.preventDefault(); selectedIdx = Math.min(selectedIdx + 1, filteredActions.length - 1); render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); selectedIdx = Math.max(selectedIdx - 1, 0); render(); }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredActions.length) execute(selectedIdx);
      else execute(-1); // AI question
    }
  });

  render();
  searchInput.focus();
</script>
</body>
</html>
  `)}`);

  quickWindow.once('ready-to-show', () => quickWindow.show());
  quickWindow.show();
  quickWindow.on('blur', () => {
    if (quickWindow) { quickWindow.close(); quickWindow = null; }
  });
  quickWindow.on('closed', () => { quickWindow = null; });
}

// ─── Quick Action IPC Handler ────────────────────────
ipcMain.on('quick-action', (event, { type, query }) => {
  // Close palette first
  if (quickWindow) { quickWindow.close(); quickWindow = null; }

  switch (type) {
    case 'close':
      break;
    case 'open-chat':
      if (mainWindow) {
        const token = getGatewayToken();
        const url = token ? `${GATEWAY_URL}/?token=${token}` : GATEWAY_URL;
        mainWindow.loadURL(url);
        mainWindow.show();
        mainWindow.focus();
      }
      break;
    case 'open-plugin-store':
      if (mainWindow) {
        mainWindow.setResizable(true);
        mainWindow.setMinimumSize(800, 500);
        mainWindow.setSize(1100, 750);
        mainWindow.center();
        mainWindow.loadFile(path.join(__dirname, 'plugin-store.html'));
        mainWindow.show();
        mainWindow.focus();
      }
      break;
    case 'open-browser':
      if (mainWindow) {
        mainWindow.setResizable(true);
        mainWindow.setMinimumSize(900, 500);
        mainWindow.setSize(1400, 850);
        mainWindow.center();
        mainWindow.loadFile(path.join(__dirname, 'browser.html'));
        mainWindow.show();
        mainWindow.focus();
      }
      break;
    case 'screen-vision':
      captureScreen();
      break;
    case 'restart-gateway':
      stopGateway();
      setTimeout(() => startGateway(), 2000);
      break;
    case 'open-config':
      shell.openPath(KLAW_STATE_DIR);
      break;
    case 'open-dashboard':
      const token2 = getGatewayToken();
      shell.openExternal(token2 ? `${GATEWAY_URL}/overview?token=${token2}` : `${GATEWAY_URL}/overview`);
      break;
    case 'open-setup':
      if (mainWindow) {
        mainWindow.loadFile(path.join(__dirname, 'setup.html'));
        mainWindow.show();
        mainWindow.focus();
      }
      break;
    case 'quit':
      isQuitting = true;
      stopGateway();
      app.quit();
      break;
    case 'ai-ask':
      // Open chat, inject question, and auto-send
      if (mainWindow) {
        const tok = getGatewayToken();
        const chatUrl = tok ? `${GATEWAY_URL}/?token=${tok}` : GATEWAY_URL;
        const currentUrl2 = mainWindow.webContents.getURL();
        // Only reload if not already on chat
        if (!currentUrl2.includes('localhost') && !currentUrl2.includes('127.0.0.1')) {
          mainWindow.loadURL(chatUrl);
        }
        mainWindow.show();
        mainWindow.focus();
        setTimeout(() => {
          mainWindow.webContents.executeJavaScript(`
            (function() {
              function inject() {
                const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
                if (!input) { setTimeout(inject, 500); return; }
                // Set the value
                if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
                  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype || window.HTMLInputElement.prototype, 'value')?.set
                    || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                  if (nativeSetter) nativeSetter.call(input, ${JSON.stringify(query)});
                  else input.value = ${JSON.stringify(query)};
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                  input.textContent = ${JSON.stringify(query)};
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                }
                // Auto-send: find and click send button after short delay
                setTimeout(() => {
                  // Try multiple selectors for send button
                  const sendBtn = document.querySelector(
                    'button[class*="send" i], button[aria-label*="Send" i], ' +
                    'button[title*="Send" i], form button[type="submit"], ' +
                    'button:has(svg[class*="send"]), [data-action="send"]'
                  );
                  if (sendBtn) {
                    sendBtn.click();
                  } else {
                    // Fallback: simulate Enter key on input
                    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                  }
                }, 300);
              }
              inject();
            })();
          `).catch(() => {});
        }, currentUrl2.includes('localhost') ? 500 : 2500);
      }
      break;
    default:
      if (type.startsWith('open-ext:')) {
        shell.openExternal(type.replace('open-ext:', ''));
      }
  }
});

app.on('window-all-closed', () => {
  // Don't quit on window close (tray keeps running)
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  stopGateway();
  // Clean up lock files
  try {
    const lockDir = path.join(require('os').tmpdir(), 'Klaw');
    if (fs.existsSync(lockDir)) {
      fs.readdirSync(lockDir).filter(f => f.endsWith('.lock')).forEach(f => {
        try { fs.unlinkSync(path.join(lockDir, f)); } catch {}
      });
    }
  } catch {}
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

// ─── IPC Handlers ────────────────────────────────────
ipcMain.handle('get-gateway-status', () => ({
  running: gatewayReady,
  port: GATEWAY_PORT,
  url: GATEWAY_URL,
}));

ipcMain.handle('restart-gateway', async () => {
  stopGateway();
  await new Promise(r => setTimeout(r, 2000));
  return await startGateway();
});

// ─── Setup Wizard IPC ────────────────────────────────
ipcMain.handle('save-setup', async (event, setupConfig) => {
  const crypto = require('crypto');

  // Read existing config or create new
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
  } catch {}

  const { provider, apiKey, model, baseUrl, apiFormat, identity, timezone, channels, gatewayPort, features } = setupConfig;

  // ── ENV VARS (API keys) ──
  if (!config.env) config.env = {};

  // Map provider to env var name
  const envKeyMap = {
    anthropic: 'ANTHROPIC_API_KEY',
    'anthropic-token': 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    opencode: 'OPENCODE_API_KEY',
    google: 'GEMINI_API_KEY',
    'google-vertex': 'GOOGLE_CLOUD_PROJECT',
    openrouter: 'OPENROUTER_API_KEY',
    xai: 'XAI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
    groq: 'GROQ_API_KEY',
    together: 'TOGETHER_API_KEY',
    huggingface: 'HF_TOKEN',
    venice: 'VENICE_API_KEY',
    cerebras: 'CEREBRAS_API_KEY',
    nvidia: 'NVIDIA_API_KEY',
    zai: 'ZAI_API_KEY',
    moonshot: 'MOONSHOT_API_KEY',
    synthetic: 'SYNTHETIC_API_KEY',
    minimax: 'MINIMAX_API_KEY',
    'github-copilot': 'GITHUB_TOKEN',
    'vercel-ai': 'AI_GATEWAY_API_KEY',
    ollama: 'OLLAMA_API_KEY',
    'ollama-cloud': 'OLLAMA_API_KEY',
    vllm: 'VLLM_API_KEY',
  };

  if (apiKey && envKeyMap[provider]) {
    config.env[envKeyMap[provider]] = apiKey;
  }
  // Local Ollama needs a dummy key for auto-discovery
  if (provider === 'ollama') {
    config.env.OLLAMA_API_KEY = 'ollama-local';
  }
  // Ollama Cloud needs custom provider with cloud base URL
  if (provider === 'ollama-cloud') {
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    config.models.providers['ollama-cloud'] = {
      baseUrl: 'https://api.ollama.com/v1',
      apiKey: apiKey || '',
      api: 'openai-completions',
    };
  }

  // ── AUTH PROFILES (for token/OAuth providers) ──
  if (!config.auth) config.auth = {};
  if (!config.auth.profiles) config.auth.profiles = {};
  if (!config.auth.order) config.auth.order = {};

  if (provider === 'anthropic-token') {
    // Claude Code setup-token auth profile
    config.auth.profiles['anthropic:default'] = {
      provider: 'anthropic',
      mode: 'token',
    };
    config.auth.order.anthropic = ['anthropic:default'];
  } else if (provider === 'openai-codex') {
    // ChatGPT OAuth auth profile
    config.auth.profiles['openai-codex:default'] = {
      provider: 'openai-codex',
      mode: 'oauth',
    };
    config.auth.order['openai-codex'] = ['openai-codex:default'];
  } else if (provider === 'qwen') {
    // Qwen OAuth — needs plugin enabled
    if (!config.plugins) config.plugins = {};
    if (!config.plugins.entries) config.plugins.entries = {};
    config.plugins.entries['qwen-portal-auth'] = { enabled: true };
  }

  // ── AGENTS (model selection) ──
  if (!config.agents) config.agents = {};
  if (!config.agents.defaults) config.agents.defaults = {};

  if (model) {
    config.agents.defaults.model = { primary: model };
    // Add to models catalog
    if (!config.agents.defaults.models) config.agents.defaults.models = {};
    config.agents.defaults.models[model] = {};
  }

  // Workspace
  config.agents.defaults.workspace = path.join(KLAW_STATE_DIR, 'workspace');

  // Timezone
  if (timezone && timezone !== 'auto') {
    config.agents.defaults.userTimezone = timezone;
  }

  // ── CUSTOM PROVIDERS (LM Studio, vLLM, LiteLLM, custom, cloudflare) ──
  const customProviders = ['lmstudio', 'vllm', 'litellm', 'custom', 'cloudflare-ai', 'moonshot', 'synthetic', 'minimax'];
  if (customProviders.includes(provider) || (baseUrl && !['openrouter', 'ollama-cloud'].includes(provider))) {
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};

    const providerKey = provider === 'custom' ? 'custom-provider' : provider;
    config.models.providers[providerKey] = {
      baseUrl: baseUrl || '',
      apiKey: apiKey || 'none',
      api: apiFormat || 'openai-completions',
    };
    if (model) {
      const modelId = model.split('/').pop();
      config.models.providers[providerKey].models = [{
        id: modelId,
        name: modelId,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      }];
    }
  }

  // ── IDENTITY ──
  if (identity) {
    config.identity = {
      name: identity.name || 'Klaw',
      theme: identity.theme || 'helpful assistant',
      emoji: identity.emoji || '🤖',
    };
  }

  // ── CHANNELS ──
  if (!config.channels) config.channels = {};
  if (channels) {
    for (const [chName, chConfig] of Object.entries(channels)) {
      config.channels[chName] = chConfig;
    }
  }

  // ── FEATURES ──
  if (features) {
    // Brave Search
    if (features.braveSearch && features.braveKey) {
      if (!config.tools) config.tools = {};
      if (!config.tools.web) config.tools.web = {};
      if (!config.tools.web.search) config.tools.web.search = {};
      config.tools.web.search.apiKey = features.braveKey;
    }

    // Heartbeat
    if (features.heartbeat) {
      if (!config.agents.defaults.heartbeat) config.agents.defaults.heartbeat = {};
      config.agents.defaults.heartbeat.every = '30m';
      config.agents.defaults.heartbeat.target = 'last';
    }

    // Voice
    if (features.voice) {
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      config.plugins.entries['talk-voice'] = { enabled: true };
    }

    // Cron
    if (features.cron) {
      if (!config.cron) config.cron = {};
      config.cron.enabled = true;
    }

    // Sandbox
    if (features.sandbox) {
      if (!config.agents.defaults.sandbox) config.agents.defaults.sandbox = {};
      config.agents.defaults.sandbox.mode = 'non-main';
    }
  }

  // ── GATEWAY ──
  if (!config.gateway) config.gateway = {};
  config.gateway.port = gatewayPort || GATEWAY_PORT;
  config.gateway.mode = 'local';
  config.gateway.bind = 'loopback';

  // Auth token
  if (!config.gateway.auth) config.gateway.auth = {};
  if (!config.gateway.auth.mode) config.gateway.auth.mode = 'token';
  if (!config.gateway.auth.token) {
    config.gateway.auth.token = crypto.randomBytes(24).toString('hex');
  }

  // ── HOOKS (internal) ──
  if (!config.hooks) config.hooks = {};
  if (!config.hooks.internal) config.hooks.internal = {};
  config.hooks.internal.enabled = true;
  if (!config.hooks.internal.entries) config.hooks.internal.entries = {};
  config.hooks.internal.entries['boot-md'] = { enabled: true };
  config.hooks.internal.entries['bootstrap-extra-files'] = { enabled: true };
  config.hooks.internal.entries['command-logger'] = { enabled: true };
  config.hooks.internal.entries['session-memory'] = { enabled: true };

  // ── COMMANDS ──
  if (!config.commands) config.commands = {};
  config.commands.native = 'auto';
  config.commands.nativeSkills = 'auto';

  // ── PLUGINS ──
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};
  config.plugins.entries.whatsapp = { enabled: true };
  config.plugins.entries.telegram = { enabled: true };
  config.plugins.entries['device-pair'] = { enabled: true };

  // ── SKILLS ──
  if (!config.skills) config.skills = {};
  if (!config.skills.install) config.skills.install = {};
  config.skills.install.nodeManager = 'npm';

  // ── META ──
  config.meta = {
    lastTouchedVersion: '0.1.0',
    lastTouchedAt: new Date().toISOString(),
  };
  config.wizard = {
    lastRunAt: new Date().toISOString(),
    lastRunVersion: '0.1.0',
    lastRunCommand: 'setup-wizard',
    lastRunMode: 'local',
  };

  // ── WRITE CONFIG ──
  fs.mkdirSync(KLAW_STATE_DIR, { recursive: true });

  // Create workspace if needed
  const workspace = config.agents.defaults.workspace;
  if (workspace) {
    fs.mkdirSync(workspace, { recursive: true });
  }

  fs.writeFileSync(ROOT_CONFIG, JSON.stringify(config, null, 2), 'utf8');

  // Also write .env file for env vars
  if (config.env && Object.keys(config.env).length > 0) {
    const envLines = Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join('\n');
    fs.writeFileSync(path.join(KLAW_STATE_DIR, '.env'), envLines + '\n', 'utf8');
  }

  // Restart gateway with new config
  stopGateway();
  await new Promise(r => setTimeout(r, 2000));
  await startGateway();

  return { success: true };
});

ipcMain.on('open-chat', () => {
  const token = getGatewayToken();
  const url = token ? `${GATEWAY_URL}/?token=${token}` : GATEWAY_URL;

  // Resize window for chat
  if (mainWindow) {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(600, 400);
    mainWindow.setSize(1200, 800);
    mainWindow.center();
    mainWindow.loadURL(url);
  }
});

ipcMain.on('open-external', (event, url) => {
  shell.openExternal(url);
});

// ─── Plugin Store IPC ────────────────────────────────
ipcMain.handle('plugin-get-registry', async () => {
  // Load registry from multiple possible locations
  const searchPaths = [
    path.resolve(__dirname, '..', 'plugins', 'registry.json'),  // dev: root-ai/plugins/
    path.resolve(__dirname, 'gateway', 'plugins', 'registry.json'),  // packaged: gateway/plugins/
    path.resolve(__dirname, 'plugins', 'registry.json'),  // electron/plugins/
  ];

  for (const p of searchPaths) {
    try {
      console.log('[Klaw] Checking registry at:', p, 'exists:', fs.existsSync(p));
      if (fs.existsSync(p)) {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        console.log('[Klaw] Registry loaded:', data.plugins?.length, 'plugins from', p);
        return data;
      }
    } catch (e) {
      console.error('[Klaw] Registry load error:', e.message);
    }
  }
  console.warn('[Klaw] No registry found! Searched:', searchPaths);
  return { plugins: [], categories: [] };
});

ipcMain.handle('plugin-get-installed', async () => {
  // Read installed plugins from config
  try {
    const config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8'));
    return config._installedPlugins || {};
  } catch {
    return {};
  }
});

ipcMain.handle('plugin-install', async (event, pluginId, envValues) => {
  try {
  // Load registry to get plugin info
  const registryPath = path.join(__dirname, '..', 'plugins', 'registry.json');
  let registry = { plugins: [] };
  try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')); } catch {}

  const plugin = registry.plugins.find(p => p.id === pluginId);
  if (!plugin) throw new Error(`Plugin "${pluginId}" not found in registry`);

  // Read config
  let config = {};
  try { config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8')); } catch {}

  // Save env values
  if (envValues && Object.keys(envValues).length > 0) {
    if (!config.env) config.env = {};
    Object.assign(config.env, envValues);
  }

  // Add MCP server to config
  if (plugin.mcpServer) {
    if (!config.mcpServers) config.mcpServers = {};
    const serverConfig = { ...plugin.mcpServer };

    // Resolve env var placeholders in args
    if (serverConfig.args) {
      serverConfig.args = serverConfig.args.map(arg => {
        return arg.replace(/\$\{(\w+)\}/g, (_, key) => {
          if (key === 'HOME') return process.env.HOME || process.env.USERPROFILE || '';
          return envValues?.[key] || config.env?.[key] || process.env[key] || '';
        });
      });
    }

    // Resolve env var placeholders in env
    if (serverConfig.env) {
      const resolvedEnv = {};
      for (const [k, v] of Object.entries(serverConfig.env)) {
        resolvedEnv[k] = v.replace(/\$\{(\w+)\}/g, (_, key) => {
          return envValues?.[key] || config.env?.[key] || process.env[key] || '';
        });
      }
      serverConfig.env = resolvedEnv;
    }

    config.mcpServers[`root-plugin-${pluginId}`] = serverConfig;
  }

  // Track installed plugins
  if (!config._installedPlugins) config._installedPlugins = {};
  config._installedPlugins[pluginId] = {
    version: plugin.version,
    installedAt: new Date().toISOString(),
  };

  // Write config
  fs.writeFileSync(ROOT_CONFIG, JSON.stringify(config, null, 2), 'utf8');
  console.log(`[Klaw] Plugin installed: ${pluginId}`);

  return { success: true };
  } catch (e) {
    console.error(`[Klaw] Plugin install error (${pluginId}):`, e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('plugin-uninstall', async (event, pluginId) => {
  try {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(ROOT_CONFIG, 'utf8')); } catch {}

  // Remove MCP server
  if (config.mcpServers) {
    delete config.mcpServers[`root-plugin-${pluginId}`];
  }

  // Remove from installed tracking
  if (config._installedPlugins) {
    delete config._installedPlugins[pluginId];
  }

  fs.writeFileSync(ROOT_CONFIG, JSON.stringify(config, null, 2), 'utf8');
  console.log(`[Klaw] Plugin uninstalled: ${pluginId}`);

  return { success: true };
  } catch (e) {
    console.error(`[Klaw] Plugin uninstall error (${pluginId}):`, e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.on('open-plugin-store', () => {
  if (mainWindow) {
    mainWindow.loadFile(path.join(__dirname, 'plugin-store.html'));
    mainWindow.show();
    mainWindow.focus();
  }
});

ipcMain.on('flash-frame', () => {
  if (mainWindow && !mainWindow.isFocused()) {
    mainWindow.flashFrame(true);
  }
});

ipcMain.on('open-browser', () => {
  if (mainWindow) {
    mainWindow.setResizable(true);
    mainWindow.setMinimumSize(900, 500);
    mainWindow.setSize(1400, 850);
    mainWindow.center();
    mainWindow.loadFile(path.join(__dirname, 'browser.html'));
    mainWindow.show();
    mainWindow.focus();
  }
});

// Sync token getter for browser.html webview
ipcMain.on('get-gateway-token-sync', (event) => {
  event.returnValue = getGatewayToken();
});

// ─── Screen Vision IPC ───────────────────────────────
ipcMain.on('screen-vision-cancel', () => {
  if (captureWindow) { captureWindow.close(); captureWindow = null; }
  if (mainWindow) mainWindow.show();
});

// ─── Computer Use Agent ──────────────────────────────
const { ComputerUseAgent, vault: cuVault } = require('./computer-use/index.cjs');
let cuAgent = null; // singleton agent instance

ipcMain.handle('computer-use-start', async (event, goal) => {
  if (cuAgent && cuAgent.isRunning()) {
    return { error: 'Agent already running. Stop it first.' };
  }
  
  cuAgent = new ComputerUseAgent();
  
  // Forward events to renderer
  cuAgent.on('start', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('computer-use-event', { type: 'start', ...data });
    }
  });
  cuAgent.on('step', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('computer-use-event', { type: 'step', ...data });
    }
  });
  cuAgent.on('done', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('computer-use-event', { type: 'done', ...data });
    }
  });
  cuAgent.on('error', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('computer-use-event', { type: 'error', ...data });
    }
  });
  cuAgent.on('stopped', (data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('computer-use-event', { type: 'stopped', ...data });
    }
  });
  
  // Run in background (don't await — return immediately)
  cuAgent.run(goal).catch(err => {
    console.error('[Computer Use] Agent error:', err);
  });
  
  return { started: true, goal };
});

ipcMain.handle('computer-use-stop', () => {
  if (cuAgent && cuAgent.isRunning()) {
    cuAgent.stop();
    return { stopped: true };
  }
  return { stopped: false, reason: 'Agent not running' };
});

ipcMain.handle('computer-use-pause', () => {
  if (cuAgent && cuAgent.isRunning()) {
    cuAgent.pause();
    return { paused: true };
  }
  return { paused: false };
});

ipcMain.handle('computer-use-resume', () => {
  if (cuAgent && cuAgent.isRunning()) {
    cuAgent.resume();
    return { resumed: true };
  }
  return { resumed: false };
});

ipcMain.handle('computer-use-status', () => {
  return {
    running: cuAgent ? cuAgent.isRunning() : false,
    steps: cuAgent ? cuAgent.getStepCount() : 0,
    goal: cuAgent ? cuAgent.goal : '',
  };
});

ipcMain.handle('computer-use-vault-get', () => {
  return cuVault.loadVault();
});

ipcMain.handle('computer-use-vault-save', (event, config) => {
  cuVault.saveVault(config);
  return { saved: true };
});

ipcMain.on('screen-vision-send', async (event, { crop, prompt, scaleFactor }) => {
  if (captureWindow) { captureWindow.close(); captureWindow = null; }

  // Find the latest screenshot
  const screenshotDir = path.join(KLAW_STATE_DIR, 'screenshots');
  const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png')).sort().reverse();
  if (files.length === 0) { if (mainWindow) mainWindow.show(); return; }

  const screenshotPath = path.join(screenshotDir, files[0]);
  let imageBuffer = fs.readFileSync(screenshotPath);

  // Crop if region was selected
  if (crop) {
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(imageBuffer);
      const cropped = img.crop({
        x: Math.round(crop.x * scaleFactor),
        y: Math.round(crop.y * scaleFactor),
        width: Math.round(crop.width * scaleFactor),
        height: Math.round(crop.height * scaleFactor),
      });
      imageBuffer = cropped.toPNG();

      // Save cropped version
      const cropPath = screenshotPath.replace('.png', '-crop.png');
      fs.writeFileSync(cropPath, imageBuffer);
      console.log('[Klaw] Cropped screenshot saved:', cropPath);
    } catch (e) {
      console.error('[Klaw] Crop failed:', e);
    }
  }

  // Convert to base64 data URL
  const base64 = imageBuffer.toString('base64');
  const dataUrl = `data:image/png;base64,${base64}`;

  // Show main window with chat
  if (mainWindow) {
    const token = getGatewayToken();
    const chatUrl = token ? `${GATEWAY_URL}/?token=${token}` : GATEWAY_URL;

    // Load chat if not already there
    const currentUrl = mainWindow.webContents.getURL();
    if (!currentUrl.includes('localhost') && !currentUrl.includes('127.0.0.1')) {
      mainWindow.loadURL(chatUrl);
      await new Promise(r => setTimeout(r, 2000));
    }

    mainWindow.show();
    mainWindow.focus();

    // Inject the screenshot + prompt into chat
    await mainWindow.webContents.executeJavaScript(`
      (function() {
        // Wait for chat input to be ready
        function inject() {
          // Find the chat input (textarea or contenteditable)
          const input = document.querySelector('textarea, [contenteditable="true"], input[type="text"]');
          if (!input) { setTimeout(inject, 500); return; }

          // Set the prompt text
          const promptText = ${JSON.stringify(prompt)};
          
          // Try to paste image + text into chat
          // Method 1: Set value directly
          if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
            input.value = '📸 [Screen Vision] ' + promptText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          } else {
            input.innerHTML = '📸 [Screen Vision] ' + promptText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
          }

          // Try to find and click send button
          setTimeout(() => {
            const sendBtn = document.querySelector('button[type="submit"], button:has(svg), [class*="send"], [aria-label*="Send"]');
            // Don't auto-send — let user review and send manually
          }, 100);
        }
        inject();
      })();
    `).catch(e => console.error('[Klaw] Inject failed:', e));

    // Also save screenshot info for gateway to pick up
    const visionFile = path.join(KLAW_STATE_DIR, 'screen-vision-pending.json');
    fs.writeFileSync(visionFile, JSON.stringify({
      screenshot: screenshotPath,
      prompt: prompt,
      timestamp: new Date().toISOString(),
      dataUrl: dataUrl.substring(0, 100) + '...', // Don't save full base64
    }, null, 2));
  }
});







