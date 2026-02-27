const browser = require('./browser');
const analyzer = require('./page-analyzer');

async function test() {
  await browser.launch({ useRealProfile: false });
  await browser.goto('https://www.upwork.com', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));

  // Type in search box
  console.log('1. Typing in search...');
  await browser.type('input.hero-search-input-field', 'react developer', { delay: 60 });
  console.log('   ✅ Typed');

  // Click search button
  console.log('2. Clicking search button...');
  await browser.click('button.hero-search-button');
  console.log('   ✅ Clicked');

  // Wait for results
  console.log('3. Waiting for results...');
  await new Promise(r => setTimeout(r, 8000));

  const url = await browser.currentUrl();
  const text = await browser.getText();
  console.log(`   URL: ${url}`);
  console.log(`   Text: ${text.length} chars`);
  console.log(`   CF: ${text.includes('Cloudflare')}`);
  console.log(`   React: ${text.toLowerCase().includes('react')}`);

  if (text.length > 500 && !text.includes('Cloudflare')) {
    console.log('\n✅ SEARCH RESULTS!');
    console.log(text.substring(0, 1000));

    const analysis = await analyzer.analyzePage();
    console.log(`\nHeadings: ${analysis.content.headings.length}`);
    analysis.content.headings.slice(0, 15).forEach(h => console.log(`  ${h.text.substring(0, 120)}`));
    console.log(`Links: ${analysis.links.length}`);
    console.log(`Buttons: ${analysis.buttons.length}`);
  } else {
    console.log('\n❌ No results or Cloudflare block');
    console.log(text.substring(0, 500));
  }

  await browser.close();
}
test().catch(e => { console.error('❌', e.message); browser.close().catch(()=>{}); process.exit(1); });
