/**
 * Test Upwork with real Chrome profile
 * First close all Chrome windows, then this will launch Chrome with your real profile
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== UPWORK TEST (Real Chrome Profile) ===\n');
  console.log('NOTE: Close all Chrome windows first!\n');

  // Wait 2s for user to close Chrome
  await new Promise(r => setTimeout(r, 2000));

  await browser.launch({ useRealProfile: true });
  console.log('✅ Browser launched with real profile');

  // Navigate to Upwork
  console.log('\n1. Going to Upwork...');
  await browser.goto('https://www.upwork.com/nx/search/jobs/?q=react+developer&sort=recency');
  
  // Wait for Cloudflare check to pass
  console.log('   Waiting for Cloudflare...');
  await new Promise(r => setTimeout(r, 8000));

  const url = await browser.currentUrl();
  console.log(`   URL: ${url}`);

  const text = await browser.getText();
  console.log(`   Text length: ${text.length}`);
  console.log(`   Contains "React": ${text.toLowerCase().includes('react')}`);
  console.log(`   Contains "Cloudflare": ${text.toLowerCase().includes('cloudflare')}`);
  
  if (text.length > 200) {
    console.log(`\n2. Page content (first 800 chars):`);
    console.log(text.substring(0, 800));

    console.log('\n3. Page analysis...');
    const analysis = await analyzer.analyzePage();
    console.log(`   Type: ${analysis.type}`);
    console.log(`   Headings: ${analysis.content.headings.length}`);
    analysis.content.headings.slice(0, 5).forEach(h => console.log(`     ${h.level}: ${h.text.substring(0, 100)}`));
    console.log(`   Links: ${analysis.links.length}`);
  } else {
    console.log('\n❌ Still blocked by Cloudflare');
    console.log(`   Raw text: ${text}`);
  }

  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
