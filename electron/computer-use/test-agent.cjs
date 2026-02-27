/**
 * Quick test: Run the Computer Use Agent on a simple task.
 * Usage: node test-agent.js "Open Notepad and type Hello World"
 */
const { ComputerUseAgent } = require('./agent.cjs');

const goal = process.argv[2] || 'Open Notepad and type "Hello from Klaw Computer Use Agent!"';

console.log(`\n🤖 Klaw Computer Use Agent`);
console.log(`📋 Goal: ${goal}\n`);

const agent = new ComputerUseAgent();

agent.on('start', ({ goal }) => {
  console.log(`▶️  Started: ${goal}\n`);
});

agent.on('step', ({ stepNum, thought, action, params }) => {
  console.log(`  Step ${stepNum}: 💭 ${thought}`);
  console.log(`          🎯 ${action}(${JSON.stringify(params)})\n`);
});

agent.on('done', ({ summary, steps }) => {
  console.log(`\n✅ Done in ${steps} steps: ${summary}\n`);
});

agent.on('error', ({ message, steps }) => {
  console.log(`\n❌ Error after ${steps} steps: ${message}\n`);
});

agent.on('stopped', ({ reason, steps }) => {
  console.log(`\n⏹️  Stopped after ${steps} steps: ${reason}\n`);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n⏹️  Stopping agent...');
  agent.stop();
});

agent.run(goal).then(result => {
  console.log('Result:', JSON.stringify(result, null, 2));
  process.exit(result.success ? 0 : 1);
}).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});


