/**
 * Test vault.js security checks
 */
const vault = require('./vault.cjs');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) { if (!condition) throw new Error(msg); }

console.log('\n🧪 Testing vault.js\n');

// App blocking
test('blocks KeePass', () => {
  const r = vault.checkApp('KeePass');
  assert(r.blocked === true, 'Should block KeePass');
});

test('blocks 1password', () => {
  const r = vault.checkApp('1password');
  assert(r.blocked === true, 'Should block 1password');
});

test('allows notepad', () => {
  const r = vault.checkApp('notepad');
  assert(r.blocked === false, 'Should allow notepad');
});

test('allows chrome', () => {
  const r = vault.checkApp('chrome');
  assert(r.blocked === false, 'Should allow chrome');
});

// URL blocking
test('blocks hdfcbank.com', () => {
  const r = vault.checkUrl('https://hdfcbank.com/login');
  assert(r.blocked === true, 'Should block HDFC bank');
});

test('blocks paypal.com', () => {
  const r = vault.checkUrl('https://www.paypal.com/pay');
  assert(r.blocked === true, 'Should block PayPal');
});

test('allows linkedin.com', () => {
  const r = vault.checkUrl('https://www.linkedin.com');
  assert(r.blocked === false, 'Should allow LinkedIn');
});

test('allows google.com', () => {
  const r = vault.checkUrl('https://www.google.com');
  assert(r.blocked === false, 'Should allow Google');
});

// Text blocking
test('blocks password text', () => {
  const r = vault.checkText('my password is abc123');
  assert(r.blocked === true, 'Should block password');
});

test('blocks credit card number', () => {
  const r = vault.checkText('card: 4111 1111 1111 1111');
  assert(r.blocked === true, 'Should block card number');
});

test('blocks CVV', () => {
  const r = vault.checkText('cvv is 123');
  assert(r.blocked === true, 'Should block CVV');
});

test('allows normal text', () => {
  const r = vault.checkText('Hello world, this is a LinkedIn post about AI');
  assert(r.blocked === false, 'Should allow normal text');
});

// Confirmation check
test('needs confirm for send action', () => {
  const r = vault.checkConfirmation('clicking send button', 'click', {});
  assert(r.needsConfirmation === true, 'Should need confirmation');
});

test('needs confirm for delete', () => {
  const r = vault.checkConfirmation('deleting the file', 'click', {});
  assert(r.needsConfirmation === true, 'Should need confirmation');
});

test('needs confirm for post (contains "post")', () => {
  const r = vault.checkConfirmation('typing the post content', 'type', {});
  assert(r.needsConfirmation === true, 'Should need confirmation — "post" is sensitive');
});

test('no confirm for safe typing', () => {
  const r = vault.checkConfirmation('typing the message content', 'type', { text: 'hello' });
  assert(r.needsConfirmation === false, 'Should not need confirmation');
});

// Full action check
test('checkAction blocks banking URL', () => {
  const r = vault.checkAction(
    { thought: 'opening bank', action: 'open_url', params: { url: 'https://hdfcbank.com' } },
    'chrome'
  );
  assert(r.allowed === false, 'Should block');
});

test('checkAction allows LinkedIn post', () => {
  const r = vault.checkAction(
    { thought: 'typing post content', action: 'type', params: { text: 'AI is the future' } },
    'chrome'
  );
  assert(r.allowed === true, 'Should allow');
});

// Load/save vault
test('loadVault returns config', () => {
  const v = vault.loadVault();
  assert(v.blockedApps.length > 0, 'Should have blocked apps');
  assert(v.safetyMode, 'Should have safety mode');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed}\n`);
process.exit(failed === 0 ? 0 : 1);

