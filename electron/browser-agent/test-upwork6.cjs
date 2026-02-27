/**
 * Navigate Upwork like a real user — homepage → search → results
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== UPWORK TEST (Navigate like human) ===\n');

  await browser.launch({ useRealProfile: false });
  console.log('✅ Browser launched');

  // Step 1: Go to homepage
  console.log('1. Homepage...');
  await browser.goto('https://www.upwork.com', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));
  let text = await browser.getText();
  console.log(`   Text: ${text.length} chars, CF: ${text.includes('Cloudflare')}`);

  if (text.length < 300) {
    console.log('❌ Blocked at homepage');
    await browser.close();
    return;
  }
  console.log('   ✅ Homepage loaded');

  // Step 2: Look for search box and type
  console.log('\n2. Looking for search...');
  
  // Try to find and use search
  try {
    // Upwork has search on homepage
    await browser.type('input[type="search"], input[placeholder*="Search"], input[name="q"]', 'react developer', { delay: 80 });
    console.log('   ✅ Typed in search box');
    await new Promise(r => setTimeout(r, 1000));
    await browser.pressKey('Enter');
    console.log('   ✅ Pressed Enter');
  } catch (e) {
    console.log(`   Search box not found: ${e.message}`);
    // Try "Find work" link instead
    console.log('   Trying "Find work" link...');
    try {
      await browser.click('Find work');
      console.log('   ✅ Clicked Find work');
    } catch (e2) {
      console.log(`   Find work failed: ${e2.message}`);
      // Direct URL as last resort
      console.log('   Trying direct URL with referrer...');
    }
  }

  // Wait for results
  await new Promise(r => setTimeout(r, 8000));
  
  text = await browser.getText();
  const url = await browser.currentUrl();
  console.log(`\n3. Current state:`);
  console.log(`   URL: ${url}`);
  console.log(`   Text: ${text.length} chars`);
  console.log(`   CF: ${text.includes('Cloudflare')}`);
  console.log(`   React: ${text.toLowerCase().includes('react')}`);
  
  if (text.length > 500 && !text.includes('Cloudflare')) {
    console.log(`\n✅ PAGE LOADED!`);
    console.log(text.substring(0, 800));

    const analysis = await analyzer.analyzePage();
    console.log(`\n   Headings: ${analysis.content.headings.length}`);
    analysis.content.headings.slice(0, 10).forEach(h => console.log(`     ${h.text.substring(0, 100)}`));
  } else {
    console.log('\n   Page content:');
    console.log(text.substring(0, 500));
  }

  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
