/**
 * Test Upwork — connect to existing Chrome via CDP
 * Run Chrome with: chrome.exe --remote-debugging-port=9222
 * Or we'll use a fresh profile with cookies copied
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');
const fs = require('fs');
const path = require('path');

async function test() {
  console.log('=== UPWORK TEST (Fresh profile + wait for Cloudflare) ===\n');

  // Use default isolated profile but NOT headless (visible so Cloudflare JS can run)
  await browser.launch({ useRealProfile: false });
  console.log('✅ Browser launched');

  // Go to Upwork homepage first (less aggressive Cloudflare)
  console.log('\n1. Going to Upwork homepage...');
  await browser.goto('https://www.upwork.com');
  
  console.log('   Waiting 10s for Cloudflare JS challenge...');
  await new Promise(r => setTimeout(r, 10000));

  let url = await browser.currentUrl();
  let text = await browser.getText();
  console.log(`   URL: ${url}`);
  console.log(`   Cloudflare: ${text.toLowerCase().includes('cloudflare')}`);
  console.log(`   Text length: ${text.length}`);

  if (text.toLowerCase().includes('cloudflare') || text.length < 200) {
    // Still blocked — wait more and reload
    console.log('   Still Cloudflare... waiting 10 more seconds...');
    await new Promise(r => setTimeout(r, 10000));
    await browser.reload();
    await new Promise(r => setTimeout(r, 5000));
    text = await browser.getText();
    url = await browser.currentUrl();
    console.log(`   URL: ${url}`);
    console.log(`   Text length: ${text.length}`);
  }

  if (text.length > 500) {
    console.log('\n✅ Upwork loaded!');
    console.log(`   First 500 chars: ${text.substring(0, 500)}`);

    // Now search for jobs
    console.log('\n2. Searching for React developer jobs...');
    await browser.goto('https://www.upwork.com/nx/search/jobs/?q=react+developer&sort=recency');
    await new Promise(r => setTimeout(r, 5000));

    text = await browser.getText();
    console.log(`   Text length: ${text.length}`);
    console.log(`   Contains "React": ${text.toLowerCase().includes('react')}`);

    if (text.length > 500) {
      console.log('\n3. Extracting job data...');
      const analysis = await analyzer.analyzePage();
      console.log(`   Headings: ${analysis.content.headings.length}`);
      analysis.content.headings.slice(0, 10).forEach(h => console.log(`     ${h.text.substring(0, 100)}`));
    }
  } else {
    console.log('\n❌ Cloudflare still blocking. Upwork needs real user cookies.');
    console.log('   Solution: User logs in manually once, we save cookies.');
  }

  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
