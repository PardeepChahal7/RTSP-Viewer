const assert = require('assert');
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, BACK: 10009, CHUP: 427, CHDN: 428, GREEN: 404, YELLOW: 405 };
const h = require('./harness.js').run({});
const { doc, store, key, byId } = h;
const shown = id => !byId(id).classList.contains('hidden');
const tiles = () => byId('cam-grid').children;
const saved = () => JSON.parse(store['rtsp-viewer-cameras']).cameras;
const type = (field, v) => { const row = byId('form').querySelectorAll('.focusable').find(r => r.attrs['data-field'] === field); const i = row.querySelector('input'); i.value = v; i.fire('blur'); };
const focusRow = (pred) => { for (let n = 0; n < 40; n++) { const f = byId('form').querySelectorAll('.focusable').find(r => r.classList.contains('focused')); if (pred(f)) return f; key(K.D); } throw new Error('row not found'); };
const press = (action) => { const r = focusRow(r => r.attrs['data-action'] === action); key(K.OK); return r; };

// 1. fresh boot: empty camera screen, Add focused
assert(shown('view-cameras') && !shown('view-setup') && !shown('view-player'));
assert(shown('cam-empty'));
assert(byId('cam-add').classList.contains('focused'));
console.log('1 empty main screen ok');

// 2. add camera A
key(K.OK);
assert(shown('view-setup') && byId('setup-title').textContent === 'Add camera');
assert(byId('form').querySelector('[data-action="delete"]').classList.contains('hidden'), 'delete hidden when adding');
press('save'); // invalid: no host
assert(shown('view-setup') && /IP/.test(byId('setup-message').textContent));
type('name', 'Front door'); type('host', '192.168.1.50'); type('password', 'pw1');
focusRow(r => r.attrs['data-action'] === 'save'); key(K.OK);
assert(shown('view-cameras') && tiles().length === 1);
assert.strictEqual(saved()[0].name, 'Front door');
assert.strictEqual(saved()[0].password, 'pw1');
console.log('2 add camera ok');

// 3. add camera B via green key, name left empty -> falls back to host
key(K.GREEN); type('host', '192.168.1.60'); press('save');
assert.strictEqual(tiles().length, 2);
assert.strictEqual(saved()[1].name, '192.168.1.60');
console.log('3 second camera ok');

// 4. live view is off by default: tiles are plain cards
setTimeout(() => {
  assert.strictEqual(tiles()[0].querySelector('.thumb-note').textContent, '');
  assert.strictEqual(byId('cam-live').textContent, 'Live view: off');
  assert.strictEqual(byId('cam-view').textContent, 'View: 4');
  console.log('4 default: live off, view 4 ok');
  rest();
}, 800);
function rest() {
  // 5. watch camera 1, CH switches to camera 2, back to list
  assert(tiles()[1].classList.contains('focused'), 'focus lands on the camera just saved');
  key(K.L); key(K.OK);
  assert(shown('view-player'));
  assert(/Front door\s+\(1 \/ 2\)/.test(byId('now-playing').textContent), byId('now-playing').textContent);
  key(K.CHUP);
  assert(/192\.168\.1\.60\s+\(2 \/ 2\)/.test(byId('now-playing').textContent));
  key(K.CHUP);
  assert(/\(1 \/ 2\)/.test(byId('now-playing').textContent));
  key(K.CHDN);
  assert(/\(2 \/ 2\)/.test(byId('now-playing').textContent));
  key(K.BACK);
  assert(shown('view-cameras') && !shown('view-player'));
  console.log('5 watch / switch / back ok');

  // 6. Manage mode on the toolbar: OK on a tile opens its options, Edit camera opens the form
  key(K.U); assert(byId('cam-add').classList.contains('focused') || byId('cam-edit').classList.contains('focused'));
  assert(byId('cam-edit').classList.contains('focused')); key(K.OK);
  assert.strictEqual(byId('cam-edit').textContent, 'Manage cameras: on');
  key(K.D); assert(tiles()[1].classList.contains('focused'), 'list reopens on the camera last watched');
  key(K.L); assert(tiles()[0].classList.contains('focused'));
  key(K.OK);
  assert(shown('cam-menu') && byId('cam-menu-title').textContent === 'Front door', 'options menu for the camera');
  key(K.OK);                                  // first item: Edit camera
  assert(!shown('cam-menu') && shown('view-setup') && byId('setup-title').textContent === 'Edit camera');
  assert.strictEqual(byId('f-name').value, 'Front door');
  assert(!byId('form').querySelector('[data-action="delete"]').classList.contains('hidden'));
  type('name', 'Porch'); press('save');
  assert.strictEqual(saved()[0].name, 'Porch'); assert.strictEqual(saved().length, 2);
  assert.strictEqual(byId('cam-edit').textContent, 'Manage cameras: off', 'manage mode resets');
  console.log('6 edit ok');

  // 7. Yellow key edits focused tile; RETURN discards
  key(K.YELLOW); assert.strictEqual(byId('setup-title').textContent, 'Edit camera');
  type('name', 'SHOULD NOT SAVE'); key(K.BACK);
  assert(shown('view-cameras')); assert.strictEqual(saved()[0].name, 'Porch');
  console.log('7 yellow edit + cancel ok');

  // 8. delete needs two presses
  key(K.YELLOW); const del = focusRow(r => r.attrs['data-action'] === 'delete'); key(K.OK);
  assert(/again/.test(del.textContent) && saved().length === 2);
  key(K.U); key(K.D); assert.strictEqual(del.textContent, 'Delete camera', 'confirmation cancelled by moving');
  focusRow(r => r.attrs['data-action'] === 'delete'); key(K.OK); key(K.OK);
  assert(shown('view-cameras')); assert.strictEqual(saved().length, 1); assert.strictEqual(tiles().length, 1);
  assert.strictEqual(saved()[0].host, '192.168.1.60');
  console.log('8 delete ok');

  // 9. single camera: CH steps NVR channel and remembers it
  key(K.OK); assert(shown('view-player'));
  key(K.CHUP); assert.strictEqual(saved()[0].channel, 1);
  key(K.BACK);
  console.log('9 single-camera channel ok');

  // 10. a camera set to connect on launch goes straight to its picture; Back lands on the camera list
  delete require.cache[require.resolve('./harness.js')];   // a fresh app needs a fresh harness
  const auto = { id: 'a', name: 'Garden', host: '10.0.0.5', user: 'viewer', password: 'x', channel: 3, port: '80', scheme: 'http', mode: 'flv', stream: 'sub', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'on' };
  const g = require('./harness.js').run({ 'rtsp-viewer-cameras': JSON.stringify({ version: 1, cameras: [auto] }) });
  assert(!g.byId('view-player').classList.contains('hidden'), 'autoconnect goes to the player');
  assert(/Garden/.test(g.byId('now-playing').textContent));
  g.key(K.BACK);
  assert(!g.byId('view-cameras').classList.contains('hidden'), 'RETURN lands on the list');
  console.log('10 autoconnect ok');
  console.log('ALL OK'); process.exit(0);
}
