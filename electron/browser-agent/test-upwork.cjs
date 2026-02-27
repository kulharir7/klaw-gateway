/**
 * Test: Can we search Upwork and extract job listings?
 * No login needed — Upwork job search is public.
 */
const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  console.log('=== UPWORK JOB SEARCH TEST ===\n');

  await browser.launch();
  console.log('✅ Browser launched');

  // Go to Upwork job search directly
  console.log('\n1. Navigating to Upwork job search...');
  await browser.goto('https://www.upwork.com/nx/search/jobs/?q=react+developer&sort=recency');
  await new Promise(r => setTimeout(r, 3000));

  const url = await browser.currentUrl();
  console.log(`   URL: ${url}`);

  // Check for login/captcha
  const captcha = await analyzer.hasCaptcha();
  const login = await analyzer.requiresLogin();
  console.log(`   CAPTCHA: ${captcha}`);
  console.log(`   Login required: ${login}`);

  // Get page text
  console.log('\n2. Reading page...');
  const text = await browser.getText();
  console.log(`   Page text length: ${text.length}`);
  console.log(`   Contains "React": ${text.toLowerCase().includes('react')}`);
  console.log(`   Contains "job": ${text.toLowerCase().includes('job')}`);
  console.log(`   First 500 chars:\n   ${text.substring(0, 500).replace(/\n/g, '\n   ')}`);

  // Analyze page
  console.log('\n3. Page analysis...');
  const analysis = await analyzer.analyzePage();
  console.log(`   Type: ${analysis.type}`);
  console.log(`   Headings: ${analysis.content.headings.length}`);
  analysis.content.headings.slice(0, 10).forEach(h => console.log(`     ${h.level}: ${h.text.substring(0, 80)}`));
  console.log(`   Links: ${analysis.links.length}`);
  console.log(`   Buttons: ${analysis.buttons.length}`);
  analysis.buttons.slice(0, 10).forEach(b => console.log(`     BTN: ${b.text}`));

  // Try to extract job cards
  console.log('\n4. Extracting job listings...');
  
  // Common Upwork job card selectors
  const selectors = [
    'article',
    '[data-test="job-tile-list"] > div',
    '.job-tile',
    'section.up-card-section',
    '[data-test="UpCLineClamp JobDescription"]',
  ];

  for (const sel of selectors) {
    try {
      const items = await browser.extractAll(sel, ['innerText']);
      if (items.length > 0) {
        console.log(`   ✅ Found ${items.length} items with selector: ${sel}`);
        items.slice(0, 3).forEach((item, i) => {
          console.log(`   [${i}] ${item.text?.substring(0, 150) || '(no text)'}...`);
        });
        break;
      }
    } catch (e) {
      // Try next selector
    }
  }

  // Get full page summary for AI
  console.log('\n5. AI-ready summary...');
  const summary = await analyzer.getPageSummary(2000);
  console.log(summary.substring(0, 1000));

  // Screenshot
  const ss = await browser.screenshot();
  console.log(`\n6. Screenshot: ${ss.length} chars`);

  await browser.close();
  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Failed:', e.message);
  browser.close().catch(() => {});
  process.exit(1);
});
