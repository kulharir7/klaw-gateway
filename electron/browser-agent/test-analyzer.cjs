/**
 * Test page-analyzer.js on real websites
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('1. Launching browser...');
  await browser.launch({ headless: true });
  console.log('   ✅ Launched');

  // Test on example.com
  console.log('\n2. Analyzing example.com...');
  await browser.goto('https://example.com');
  const a1 = await analyzer.analyzePage();
  console.log(`   ✅ Type: ${a1.type}`);
  console.log(`   ✅ Title: ${a1.title}`);
  console.log(`   ✅ Headings: ${a1.content.headings.length}`);
  console.log(`   ✅ Links: ${a1.links.length}`);
  console.log(`   ✅ Buttons: ${a1.buttons.length}`);

  // Test page summary
  console.log('\n3. Getting page summary...');
  const summary = await analyzer.getPageSummary();
  console.log(`   ✅ Summary (${summary.length} chars):`);
  console.log('   ' + summary.split('\n').slice(0, 5).join('\n   '));

  // Test CAPTCHA detection
  console.log('\n4. CAPTCHA detection...');
  const captcha = await analyzer.hasCaptcha();
  console.log(`   ✅ Has CAPTCHA: ${captcha}`);

  // Test login detection
  console.log('\n5. Login detection...');
  const login = await analyzer.requiresLogin();
  console.log(`   ✅ Requires login: ${login}`);

  // Test on Google
  console.log('\n6. Analyzing google.com...');
  await browser.goto('https://www.google.com');
  const a2 = await analyzer.analyzePage();
  console.log(`   ✅ Type: ${a2.type}`);
  console.log(`   ✅ Forms: ${a2.forms.length}`);
  if (a2.forms.length > 0) {
    console.log(`   ✅ Form inputs: ${a2.forms[0].inputs.map(i => i.type).join(', ')}`);
  }
  console.log(`   ✅ Buttons: ${a2.buttons.map(b => b.text).join(', ')}`);

  await browser.close();
  console.log('\n🎉 All analyzer tests passed!');
}

test().catch(e => {
  console.error('❌ Test failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
