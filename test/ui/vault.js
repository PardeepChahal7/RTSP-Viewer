// Logins are encrypted before they are stored, and come back after a restart.
// The fake TV here has real Web Crypto (Node's) and an in-memory IndexedDB that survives restarts.
const assert = require('assert');
global.__crypto = true;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = { D: 40, OK: 13, GREEN: 404, YELLOW: 405, BACK: 10009 };
const STORE_KEY = 'rtsp-viewer-cameras';

function harness() { delete require.cache[require.resolve('./harness.js')]; return require('./harness.js'); }
const cam = (n) => ({ id: 'c' + n, name: 'Cam ' + n, host: '10.0.0.' + n, user: 'user' + n, password: 'secret-pw-' + n, channel: 0, port: '80', scheme: 'http', mode: 'rtsp', stream: 'sub', audio: 'off', player: 'auto', rtspPort: '554', rtspPath: '/live0', rtspPlayer: 'auto', autoconnect: 'off' });
const tilesOf = t => t.byId('cam-grid').children;
const stored = t => JSON.parse(t.store[STORE_KEY]);
const type = (t, field, value) => { const row = t.byId('form').querySelectorAll('.focusable').find(r => r.attrs['data-field'] === field); const input = row.querySelector('input'); input.value = value; input.fire('blur'); };
const focusAction = (t, action) => { for (let i = 0; i < 40; i++) { const f = t.byId('form').querySelectorAll('.focusable').find(r => r.classList.contains('focused')); if (f.attrs['data-action'] === action) return; t.key(K.D); } throw new Error('no ' + action + ' row'); };

(async () => {
  // 1. a camera added on a fresh TV is stored without readable user name or password
  global.__idbData = {};
  let t = await harness().boot({});
  t.key(K.GREEN);
  type(t, 'name', 'Porch'); type(t, 'host', 'cam.local'); type(t, 'user', 'eufy-user'); type(t, 'password', 'p@ss w0rd');
  focusAction(t, 'save'); t.key(K.OK);
  await sleep(150);
  let data = stored(t);
  assert.strictEqual(data.version, 2); assert.strictEqual(data.encrypted, true);
  assert.strictEqual(data.cameras.length, 1);
  assert(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(data.cameras[0].secret), 'secret: ' + data.cameras[0].secret);
  assert(!('user' in data.cameras[0]) && !('password' in data.cameras[0]), 'no plain login fields');
  assert(t.store[STORE_KEY].indexOf('p@ss w0rd') < 0 && t.store[STORE_KEY].indexOf('eufy-user') < 0, 'nothing readable in the stored text');
  assert.strictEqual(data.cameras[0].name, 'Porch', 'the rest of the camera stays readable');
  const firstSecret = data.cameras[0].secret;
  console.log('1 stored encrypted ok');

  // 2. saving again uses a fresh random IV
  t.key(K.YELLOW); focusAction(t, 'save'); t.key(K.OK); await sleep(150);
  assert.notStrictEqual(stored(t).cameras[0].secret, firstSecret, 'new IV every save');
  console.log('2 new IV per save ok');

  // 3. after a restart the login is back
  const saved = Object.assign({}, t.store);
  t = await harness().boot(saved);
  assert.strictEqual(tilesOf(t).length, 1);
  t.key(K.YELLOW);
  assert.strictEqual(t.byId('f-user').value, 'eufy-user'); assert.strictEqual(t.byId('f-password').value, 'p@ss w0rd');
  console.log('3 login survives a restart ok');

  // 4. the key is gone (storage of the key cleared): logins cannot be read, the app says so and nothing crashes
  global.__idbData = {};
  t = await harness().boot(Object.assign({}, saved));
  assert.strictEqual(tilesOf(t).length, 1);
  assert(/could not be read/.test(t.byId('cam-message').textContent), t.byId('cam-message').textContent);
  t.key(K.YELLOW);
  assert.strictEqual(t.byId('f-user').value, ''); assert.strictEqual(t.byId('f-password').value, '');
  console.log('4 lost key reported, no crash ok');

  // 5. plain-text cameras from before (or from a TV that could not encrypt) are encrypted on the next start
  global.__idbData = {};
  t = await harness().boot({ [STORE_KEY]: JSON.stringify({ version: 1, cameras: [cam(1), cam(2)] }) });
  await sleep(150);
  data = stored(t);
  assert.strictEqual(data.encrypted, true);
  assert(data.cameras.every(c => c.secret && !c.password && !c.user), 'both cameras re-stored encrypted');
  assert(t.store[STORE_KEY].indexOf('secret-pw-1') < 0);
  t.key(K.YELLOW); assert.strictEqual(t.byId('f-password').value, 'secret-pw-1');
  console.log('5 plain text upgraded to encrypted ok');

  // 6. a secret is tied to its camera: swapping two cameras' secrets makes both unreadable
  const swapped = stored(t); const s0 = swapped.cameras[0].secret; swapped.cameras[0].secret = swapped.cameras[1].secret; swapped.cameras[1].secret = s0;
  t = await harness().boot({ [STORE_KEY]: JSON.stringify(swapped) });
  assert(/could not be read/.test(t.byId('cam-message').textContent));
  t.key(K.YELLOW); assert.strictEqual(t.byId('f-password').value, '');
  console.log('6 secrets are bound to their camera ok');

  // 7. a tampered secret is refused, not decrypted to garbage
  global.__idbData = {};
  t = await harness().boot({ [STORE_KEY]: JSON.stringify({ version: 1, cameras: [cam(1)] }) }); await sleep(150);
  const tampered = stored(t); const parts = tampered.cameras[0].secret.split('.'); parts[2] = parts[2].slice(0, -4) + 'AAAA'; tampered.cameras[0].secret = parts.join('.');
  t = await harness().boot({ [STORE_KEY]: JSON.stringify(tampered) });
  assert(/could not be read/.test(t.byId('cam-message').textContent));
  console.log('7 tampering detected ok');

  // 8. a TV without Web Crypto: logins are stored as plain text, and the app says so
  global.__crypto = false;
  t = await harness().boot({ [STORE_KEY]: JSON.stringify({ version: 1, cameras: [cam(1)] }) });
  assert(/cannot encrypt saved logins/.test(t.byId('cam-message').textContent), t.byId('cam-message').textContent);
  t.key(K.YELLOW); assert.strictEqual(t.byId('f-password').value, 'secret-pw-1'); focusAction(t, 'save'); t.key(K.OK);
  data = stored(t); assert.strictEqual(data.encrypted, false); assert.strictEqual(data.cameras[0].password, 'secret-pw-1');
  console.log('8 no-crypto TV falls back to plain text, and says so ok');

  // 9. storage that never answers: the app still starts (after a short wait), without encryption, and says so
  global.__crypto = true; global.__idbHang = true; global.__idbData = {};
  const began = Date.now();
  t = await harness().boot({ [STORE_KEY]: JSON.stringify({ version: 1, cameras: [cam(1)] }) });
  assert(Date.now() - began < 4500, 'started after ' + (Date.now() - began) + ' ms');
  assert.strictEqual(tilesOf(t).length, 1);
  assert(/cannot encrypt saved logins/.test(t.byId('cam-message').textContent));
  global.__idbHang = false;
  console.log('9 unresponsive storage does not block the app ok');

  // 10. a corrupt entry in the stored list does not stop the app
  global.__idbData = {};
  t = await harness().boot({ [STORE_KEY]: JSON.stringify({ version: 2, encrypted: true, cameras: [null, cam(2)] }) });
  assert.strictEqual(tilesOf(t).length, 2);
  console.log('10 corrupt entry tolerated ok');

  console.log('ALL VAULT OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
