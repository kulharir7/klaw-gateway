const browser = require('./browser');

async function test() {
  await browser.launch({ useRealProfile: false });
  await browser.goto('https://www.upwork.com', { timeout: 60000, waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 5000));

  const page = await browser.getPage();
  
  const inputs = await page.$$eval('input, textarea', els => els.map(el => ({
    tag: el.tagName, type: el.type, name: el.name, placeholder: el.placeholder,
    id: el.id, cls: el.className.substring(0, 50), ariaLabel: el.getAttribute('aria-label'),
    vis: el.getBoundingClientRect().width > 0,
  })));
  console.log('Inputs:');
  inputs.forEach((inp, i) => console.log(`  [${i}] ${JSON.stringify(inp)}`));

  const searchEls = await page.$$eval('[class*="search" i], [id*="search" i], [aria-label*="search" i], [placeholder*="search" i], [role="search"], [role="searchbox"], [role="combobox"]', els => els.map(el => ({
    tag: el.tagName, cls: el.className?.substring?.(0, 60), id: el.id,
    role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
  })));
  console.log('\nSearch elements:');
  searchEls.forEach((el, i) => console.log(`  [${i}] ${JSON.stringify(el)}`));

  await browser.close();
}
test().catch(e => { console.error(e.message); browser.close().catch(()=>{}); process.exit(1); });
