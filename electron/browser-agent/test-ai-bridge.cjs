/**
 * Test ai-bridge.js — can we call AI?
 */
const { callGatewayForWebAgent, getAIConfig } = require('./ai-bridge');

async function test() {
  console.log('=== AI BRIDGE TEST ===\n');

  // Check what AI config we have
  console.log('1. Checking AI config...');
  const config = getAIConfig();
  console.log(`   Provider: ${config.provider}`);
  console.log(`   Model: ${config.model || 'default'}`);
  console.log(`   Has API key: ${config.apiKey ? 'yes (' + config.apiKey.substring(0, 10) + '...)' : 'no'}`);

  // Try a simple call
  console.log('\n2. Calling AI...');
  try {
    const response = await callGatewayForWebAgent(
      'You are a helpful assistant. Respond in one short sentence.',
      'What is 2+2?'
    );
    console.log(`   ✅ Response: "${response.trim()}"`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
    
    // If gateway fails, check if port is open
    console.log('\n3. Checking gateway port...');
    const net = require('net');
    for (const port of [18790, 18789]) {
      try {
        await new Promise((resolve, reject) => {
          const sock = new net.Socket();
          sock.setTimeout(2000);
          sock.on('connect', () => { sock.destroy(); resolve(true); });
          sock.on('error', () => { sock.destroy(); reject(); });
          sock.on('timeout', () => { sock.destroy(); reject(); });
          sock.connect(port, '127.0.0.1');
        });
        console.log(`   ✅ Port ${port} is open`);
      } catch (e) {
        console.log(`   ❌ Port ${port} is closed`);
      }
    }
  }

  console.log('\n=== DONE ===');
}

test().catch(e => {
  console.error('❌ Test error:', e.message);
  process.exit(1);
});
