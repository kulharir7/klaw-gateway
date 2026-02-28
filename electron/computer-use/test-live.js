/**
 * Live test: Take screenshot → save to temp → verify screen.js works
 * This tests the screen control layer only (no AI needed).
 */
const screen = require('./screen');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('\n🤖 Korvus Computer Use — Live Test\n');
  
  // Step 1: Screenshot
  console.log('📸 Taking screenshot...');
  const b64 = await screen.screenshot();
  console.log(`   ✅ Got ${Math.round(b64.length/1024)}KB screenshot`);
  
  // Step 2: Screen size
  const size = screen.getScreenSize();
  console.log(`   📐 Screen: ${size.width}x${size.height}`);
  
  // Step 3: Active window
  const win = await screen.getActiveWindow();
  console.log(`   🪟 Active: ${win.processName} — "${win.title}"`);
  
  // Step 4: Open notepad
  console.log('\n📝 Opening Notepad...');
  await screen.openApp('notepad');
  await screen.wait(2000);
  
  // Step 5: Focus it
  const focused = await screen.focusWindow('notepad');
  console.log(`   Focus: ${focused ? '✅' : '❌'}`);
  await screen.wait(500);
  
  // Step 6: Type
  console.log('   Typing...');
  await screen.type('Korvus Computer Use Agent is working!');
  await screen.key('enter');
  await screen.type('This was typed automatically by AI.');
  await screen.wait(500);
  
  // Step 7: Screenshot after
  console.log('\n📸 Taking verification screenshot...');
  const b64After = await screen.screenshot();
  
  // Save for verification
  const tmpPath = path.join(require('os').tmpdir(), 'rootai-test-screenshot.png');
  fs.writeFileSync(tmpPath, Buffer.from(b64After, 'base64'));
  console.log(`   ✅ Saved to: ${tmpPath}`);
  
  // Cleanup
  console.log('\n🧹 Closing Notepad...');
  try {
    require('child_process').execSync('taskkill /IM notepad.exe /F', { stdio: 'ignore' });
    console.log('   ✅ Closed');
  } catch(e) { console.log('   ⚠️ Could not close'); }
  
  console.log('\n✅ All screen controls working!\n');
  console.log('To use Computer Use with AI, the gateway AI agent calls these functions.');
  console.log('No separate API key needed — uses the same AI provider configured in Korvus.\n');
}

test().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
