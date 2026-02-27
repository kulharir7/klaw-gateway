/**
 * Test Upwork with puppeteer-extra + stealth plugin
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== UPWORK TEST (Stealth Plugin) ===\n');

  await browser.launch({ useRealProfile: false });
  console.log('✅ Browser launched with stealth');

  console.log('\n1. Going to Upwork...');
  try {
    await browser.goto('https://www.upwork.com/nx/search/jobs/?q=react+developer&sort=recency', { timeout: 45000 });
  } catch (e) {
    console.log(`   Navigation error: ${e.message}`);
    console.log('   Waiting 15s for Cloudflare...');
    await new Promise(r => setTimeout(r, 15000));
  }

  const url = await browser.currentUrl();
  const text = await browser.getText();
  console.log(`   URL: ${url}`);
  console.log(`   Text length: ${text.length}`);
  console.log(`   Cloudflare: ${text.toLowerCase().includes('cloudflare')}`);
  console.log(`   React: ${text.toLowerCase().includes('react')}`);

  if (text.length > 500 && !text.toLowerCase().includes('cloudflare')) {
    console.log('\n✅ UPWORK LOADED!');
    console.log(`   First 600 chars:\n${text.substring(0, 600)}`);

    const analysis = await analyzer.analyzePage();
    console.log(`\n   Headings: ${analysis.content.headings.length}`);
    analysis.content.headings.slice(0, 10).forEach(h => console.log(`     ${h.text.substring(0, 100)}`));
    console.log(`   Links: ${analysis.links.length}`);
    console.log(`   Buttons: ${analysis.buttons.length}`);
  } else {
    console.log('\n❌ Still blocked');
    console.log(`   Raw: ${text.substring(0, 300)}`);
  }

  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
