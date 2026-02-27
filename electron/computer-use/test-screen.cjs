/**
 * Test script for screen.js — run with: node test-screen.js
 * Tests each function one by one.
 */
const screen = require('./screen.cjs');

async function runTests() {
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (e) {
      console.log(`  ❌ ${name}: ${e.message}`);
      failed++;
    }
  }

  console.log('\n🧪 Testing screen.js\n');

  // Test 1: getScreenSize
  await test('getScreenSize', async () => {
    const size = screen.getScreenSize();
    if (!size.width || !size.height) throw new Error('No size returned');
    if (size.width < 800 || size.height < 600) throw new Error(`Unexpected size: ${size.width}x${size.height}`);
    console.log(`     Screen: ${size.width}x${size.height}`);
  });

  // Test 2: screenshot
  await test('screenshot (base64 PNG)', async () => {
    const b64 = await screen.screenshot();
    if (!b64 || b64.length < 1000) throw new Error('Screenshot too small');
    // Verify it's valid base64 PNG (PNG header in base64 starts with iVBOR)
    if (!b64.startsWith('iVBOR')) throw new Error('Not a valid PNG base64');
    console.log(`     Size: ${Math.round(b64.length / 1024)}KB`);
  });

  // Test 3: getActiveWindow
  await test('getActiveWindow', async () => {
    const win = await screen.getActiveWindow();
    if (!win.processName) throw new Error('No process name');
    console.log(`     Active: ${win.processName} — "${win.title}"`);
  });

  // Test 4: openApp (notepad)
  await test('openApp("notepad")', async () => {
    await screen.openApp('notepad');
    await screen.wait(1500);
  });

  // Test 5: focusWindow
  await test('focusWindow("notepad")', async () => {
    const ok = await screen.focusWindow('notepad');
    if (!ok) throw new Error('Could not focus notepad');
    await screen.wait(500);
  });

  // Test 6: type
  await test('type("Hello Korvus!")', async () => {
    await screen.type('Hello Korvus!');
    await screen.wait(300);
  });

  // Test 7: key (Enter)
  await test('key("enter")', async () => {
    await screen.key('enter');
    await screen.wait(200);
  });

  // Test 8: type more
  await test('type("Testing keyboard shortcuts...")', async () => {
    await screen.type('Testing keyboard shortcuts...');
    await screen.wait(300);
  });

  // Test 9: key combo (select all)
  await test('key("ctrl+a") — select all', async () => {
    await screen.key('ctrl+a');
    await screen.wait(300);
  });

  // Test 10: scroll
  await test('scroll("down", 3)', async () => {
    await screen.scroll('down', 3);
    await screen.wait(300);
  });

  await test('scroll("up", 3)', async () => {
    await screen.scroll('up', 3);
    await screen.wait(300);
  });

  // Test 11: click (click somewhere safe in notepad)
  await test('click(400, 400)', async () => {
    await screen.click(400, 400);
    await screen.wait(300);
  });

  // Test 12: moveMouse
  await test('moveMouse(500, 500)', async () => {
    await screen.moveMouse(500, 500);
    await screen.wait(200);
  });

  // Test 13: openUrl
  await test('openUrl("https://example.com")', async () => {
    await screen.openUrl('https://example.com');
    await screen.wait(1000);
  });

  // Test 14: invalid inputs
  await test('click out of bounds throws', async () => {
    try {
      await screen.click(-1, -1);
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('out of screen bounds')) throw e;
    }
  });

  await test('type empty throws', async () => {
    try {
      await screen.type('');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('empty text')) throw e;
    }
  });

  await test('key invalid throws', async () => {
    try {
      await screen.key('invalidkey123');
      throw new Error('Should have thrown');
    } catch (e) {
      if (!e.message.includes('Unknown key')) throw e;
    }
  });

  // Cleanup: close notepad without saving
  try {
    const { execSync } = require('child_process');
    execSync('taskkill /IM notepad.exe /F', { stdio: 'ignore' });
  } catch (e) { /* ignore */ }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed}\n`);
  return failed === 0;
}

runTests().then(ok => {
  process.exit(ok ? 0 : 1);
});

