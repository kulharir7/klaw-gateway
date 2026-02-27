/**
 * Test: Wait for Cloudflare to auto-solve (it runs JS checks, then redirects)
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== UPWORK TEST (Wait for Cloudflare auto-solve) ===\n');

  await browser.launch({ useRealProfile: false });
  console.log('✅ Browser launched');

  console.log('\n1. Going to Upwork homepage first (lighter CF check)...');
  try {
    await browser.goto('https://www.upwork.com', { timeout: 60000, waitUntil: 'domcontentloaded' });
  } catch(e) {
    console.log('   Timeout on initial load, checking page...');
  }

  // Poll until Cloudflare passes
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const text = await browser.getText();
    const url = await browser.currentUrl();
    const hasCF = text.toLowerCase().includes('cloudflare') || text.toLowerCase().includes('just a moment');
    console.log(`   [${(i+1)*5}s] URL: ${url.substring(0, 60)} | CF: ${hasCF} | Text: ${text.length} chars`);
    
    if (!hasCF && text.length > 300) {
      console.log('\n✅ CLOUDFLARE PASSED!');
      console.log(`   First 500 chars:\n${text.substring(0, 500)}`);
      
      // Now go to job search
      console.log('\n2. Searching jobs...');
      await browser.goto('https://www.upwork.com/nx/search/jobs/?q=react+developer&sort=recency', { timeout: 30000 });
      await new Promise(r => setTimeout(r, 3000));
      
      const jobText = await browser.getText();
      console.log(`   Jobs page text: ${jobText.length} chars`);
      console.log(`   Contains React: ${jobText.toLowerCase().includes('react')}`);
      
      if (jobText.length > 500) {
        console.log(`   First 500:\n${jobText.substring(0, 500)}`);
      }
      
      await browser.close();
      console.log('\n=== SUCCESS ===');
      return;
    }
  }

  console.log('\n❌ Cloudflare did not auto-solve after 60 seconds');
  console.log('   This IP may be flagged. Solutions:');
  console.log('   1. Use VPN/different network');
  console.log('   2. Use user\'s real Chrome profile (they\'re already logged in)');
  console.log('   3. Connect to user\'s running Chrome (--remote-debugging-port)');
  
  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
