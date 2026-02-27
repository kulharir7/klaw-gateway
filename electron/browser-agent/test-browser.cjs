/**
 * Quick test for browser.js
 * Run: node test-browser.js
 */
const browser = require('./browser');

async function test() {
  console.log('1. Launching browser...');
  await browser.launch();
  console.log('   ✅ Browser launched');

  console.log('2. Navigating to example.com...');
  await browser.goto('https://example.com');
  console.log('   ✅ Navigated');

  console.log('3. Getting title...');
  const title = await browser.getTitle();
  console.log(`   ✅ Title: "${title}"`);

  console.log('4. Getting page text...');
  const text = await browser.getText();
  console.log(`   ✅ Text (first 200 chars): "${text.substring(0, 200)}"`);

  console.log('5. Getting links...');
  const links = await browser.getLinks();
  console.log(`   ✅ Links found: ${links.length}`);
  links.forEach(l => console.log(`      - ${l.text?.trim() || '(no text)'} → ${l.href}`));

  console.log('6. Taking screenshot...');
  const ss = await browser.screenshot();
  console.log(`   ✅ Screenshot: ${ss.length} chars base64`);

  console.log('7. Listing tabs...');
  const tabs = await browser.listTabs();
  console.log(`   ✅ Tabs: ${tabs.length}`);
  tabs.forEach(t => console.log(`      - [${t.index}] ${t.title} (${t.url})`));

  console.log('8. Closing browser...');
  await browser.close();
  console.log('   ✅ Closed');

  console.log('\n🎉 All tests passed!');
}

test().catch(e => {
  console.error('❌ Test failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
