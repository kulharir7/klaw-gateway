/**
 * End-to-end test: WebAgent executes a real task with AI
 */
const { WebAgent } = require('./web-agent');
const { callGatewayForWebAgent } = require('./ai-bridge');

async function test() {
  console.log('=== END-TO-END WEB AGENT TEST ===\n');

  const agent = new WebAgent();
  agent.setAI(callGatewayForWebAgent);

  // Listen for events
  agent.on('start', (d) => console.log(`🚀 START: ${d.task}`));
  agent.on('step', (d) => console.log(`   📍 Step ${d.stepNum || '?'}: [${d.action}] ${d.thought || ''}`));
  agent.on('done', (d) => console.log(`✅ DONE: ${typeof d.result === 'string' ? d.result.substring(0, 200) : JSON.stringify(d.result).substring(0, 200)}`));
  agent.on('error', (d) => console.log(`❌ ERROR: ${d.message}`));
  agent.on('need_captcha', () => console.log('⚠️ CAPTCHA detected!'));
  agent.on('need_login', () => console.log('⚠️ Login needed!'));

  // Simple task: Google search
  console.log('Task: "Go to google.com and search for React developer jobs"\n');

  const result = await agent.execute('Go to google.com and search for React developer jobs. Once you see search results, report done with the number of results you see.');

  console.log(`\nResult: success=${result.success}, steps=${result.steps}, duration=${result.duration}ms`);
  if (result.result) console.log(`Output: ${typeof result.result === 'string' ? result.result.substring(0, 300) : JSON.stringify(result.result).substring(0, 300)}`);

  // Close browser
  const browser = require('./browser');
  await browser.close();

  console.log('\n=== TEST COMPLETE ===');
}

test().catch(e => {
  console.error('❌ E2E test failed:', e.message);
  console.error(e.stack);
  const browser = require('./browser');
  browser.close().catch(() => {});
  process.exit(1);
});
