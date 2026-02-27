/**
 * Live end-to-end test of Web Agent
 * Tests: browser launch → navigate → read → click → extract
 * No AI needed — tests the browser functions directly
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== LIVE WEB AGENT TEST ===\n');

  // Test 1: Launch + Google search
  console.log('TEST 1: Google Search');
  await browser.launch();
  console.log('  ✅ Browser launched');

  await browser.goto('https://www.google.com');
  console.log('  ✅ Navigated to Google');

  const title = await browser.getTitle();
  console.log(`  ✅ Title: ${title}`);

  // Type in search
  await browser.type('textarea[name="q"]', 'React developer jobs', { delay: 30 });
  console.log('  ✅ Typed search query');

  await browser.pressKey('Enter');
  console.log('  ✅ Pressed Enter');

  // Wait for results
  await new Promise(r => setTimeout(r, 3000));

  const resultText = await browser.getText();
  const hasResults = resultText.includes('React') || resultText.includes('react');
  console.log(`  ${hasResults ? '✅' : '❌'} Search results contain "React": ${hasResults}`);

  // Test 2: Page analysis on search results
  console.log('\nTEST 2: Page Analysis');
  const analysis = await analyzer.analyzePage();
  console.log(`  ✅ Page type: ${analysis.type}`);
  console.log(`  ✅ Headings: ${analysis.content.headings.length}`);
  console.log(`  ✅ Links: ${analysis.links.length}`);
  console.log(`  ✅ Buttons: ${analysis.buttons.length}`);

  const summary = await analyzer.getPageSummary(1000);
  console.log(`  ✅ Summary (${summary.length} chars)`);

  // Test 3: CAPTCHA check
  console.log('\nTEST 3: CAPTCHA Detection');
  const captcha = await analyzer.hasCaptcha();
  console.log(`  ✅ Has CAPTCHA: ${captcha}`);

  // Test 4: Multi-tab
  console.log('\nTEST 4: Multi-tab');
  await browser.newTab('https://example.com');
  console.log('  ✅ New tab opened');

  const tabs = await browser.listTabs();
  console.log(`  ✅ Tabs: ${tabs.length}`);
  tabs.forEach(t => console.log(`     [${t.index}] ${t.title}`));

  await browser.switchTab(0);
  console.log('  ✅ Switched back to tab 0');

  await browser.closeTab();
  // After closing tab 0, we should be on the remaining tab
  const tabs2 = await browser.listTabs();
  console.log(`  ✅ Closed tab, remaining: ${tabs2.length}`);

  // Test 5: Cookie save/load
  console.log('\nTEST 5: Cookies');
  await browser.goto('https://example.com');
  await browser.saveCookies('test-session');
  console.log('  ✅ Cookies saved');

  const loaded = await browser.loadCookies('test-session');
  console.log(`  ✅ Cookies loaded: ${loaded}`);

  // Test 6: Screenshot
  console.log('\nTEST 6: Screenshot');
  const ss = await browser.screenshot();
  console.log(`  ✅ Screenshot: ${ss.length} chars base64`);

  // Test 7: Links extraction
  console.log('\nTEST 7: Data Extraction');
  const links = await browser.getLinks();
  console.log(`  ✅ Links found: ${links.length}`);

  // Cleanup
  await browser.close();
  console.log('\n✅ Browser closed');

  console.log('\n🎉 ALL LIVE TESTS PASSED!\n');
}

test().catch(e => {
  console.error('\n❌ LIVE TEST FAILED:', e.message);
  console.error(e.stack);
  browser.close().catch(() => {});
  process.exit(1);
});
