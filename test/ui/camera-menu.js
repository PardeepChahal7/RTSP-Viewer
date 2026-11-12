// Hold OK on a camera tile: options menu with Edit, Move and Remove. A tap on OK still watches the camera.
const assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, BACK: 10009 };
const cam = (n) => ({ id: 'c' + n, name: 'Cam ' + n, host: '10.0.0.' + n, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'rtsp', stream: 'sub', audio: 'off', player: 'auto', rtspPort: '554', rtspPath: '/live0', rtspPlayer: 'auto', autoconnect: 'off' });
const preset = () => ({ 'rtsp-viewer-cameras': JSON.stringify({ version: 2, encrypted: false, cameras: [1, 2, 3, 4, 5].map(cam) }) });

(async () => {
  let t = require('./harness.js').run(preset());
  const shown = id => !t.byId(id).classList.contains('hidden');
  const tiles = () => t.byId('cam-grid').children;
  const names = () => tiles().map(x => x.querySelector('.tile-name').textContent);
  const storedNames = () => JSON.parse(t.store['rtsp-viewer-cameras']).cameras.map(c => c.name);
  const hold = async () => { t.keyDown(K.OK); await sleep(800); };   // OK pressed and kept down past the hold time
  const focusedTile = () => tiles().findIndex(x => x.classList.contains('focused'));
  const menuItems = () => t.byId('cam-menu-items').children.map(x => x.textContent);
  const menuFocus = () => t.byId('cam-menu-items').children.findIndex(x => x.classList.contains('focused'));

  // The TV has delivered a key release (the arrow key), so tap-or-hold detection is on. Focus moves to Cam 2.
  t.keyDown(K.R); t.keyUp(K.R);
  assert.strictEqual(focusedTile(), 1);

  // 1. a tap watches the camera
  t.keyDown(K.OK); t.keyUp(K.OK);
  assert(shown('view-player') && /Cam 2/.test(t.byId('now-playing').textContent), 'a tap opens the camera');
  t.key(K.BACK); assert(shown('view-cameras'));
  console.log('1 tap watches ok');

  // 2. a hold opens the options; the repeats of the held key and the release do nothing more
  await hold();
  assert(shown('cam-menu') && t.byId('cam-menu-title').textContent === 'Cam 2');
  assert.deepStrictEqual(menuItems(), ['Edit camera', 'Move camera', 'Remove camera', 'Close']);
  assert.strictEqual(menuFocus(), 0);
  t.keyDown(K.OK, { repeat: true }); t.keyDown(K.OK, { repeat: true });
  t.keyDown(K.OK);                                   // a TV that does not flag repeats: still the same press
  t.keyUp(K.OK);
  assert(shown('cam-menu') && shown('view-cameras') && menuFocus() === 0, 'holding must not also choose an item');
  t.key(K.BACK); assert(!shown('cam-menu'));
  console.log('2 hold opens options ok');

  // 3. Edit camera
  await hold(); t.keyUp(K.OK);
  t.key(K.OK);                                       // a new press on the first item
  assert(!shown('cam-menu') && shown('view-setup') && t.byId('setup-title').textContent === 'Edit camera');
  assert.strictEqual(t.byId('f-name').value, 'Cam 2');
  t.key(K.BACK); assert(shown('view-cameras'));
  console.log('3 edit ok');

  // 4. Move camera: it follows the arrows, OK keeps the order, RETURN restores it
  await hold(); t.keyUp(K.OK);
  t.key(K.D); t.key(K.OK);
  assert(!shown('cam-menu'));
  assert(/Moving "Cam 2"/.test(t.byId('cam-message').textContent), t.byId('cam-message').textContent);
  t.key(K.R);
  assert.deepStrictEqual(names(), ['Cam 1', 'Cam 3', 'Cam 2', 'Cam 4', 'Cam 5']);
  assert(tiles()[2].classList.contains('moving') && focusedTile() === 2);
  t.key(K.D);                                        // down a row (2 columns in the default view)
  assert.deepStrictEqual(names(), ['Cam 1', 'Cam 3', 'Cam 4', 'Cam 5', 'Cam 2']);
  t.key(K.BACK);                                     // cancel
  assert.deepStrictEqual(names(), ['Cam 1', 'Cam 2', 'Cam 3', 'Cam 4', 'Cam 5'], 'cancel puts it back');
  assert.deepStrictEqual(storedNames(), ['Cam 1', 'Cam 2', 'Cam 3', 'Cam 4', 'Cam 5']);
  assert.strictEqual(t.byId('cam-message').textContent, '');
  await hold(); t.keyUp(K.OK); t.key(K.D); t.key(K.OK); t.key(K.R); t.key(K.OK);   // move Cam 2 one place right and keep it
  assert.deepStrictEqual(names(), ['Cam 1', 'Cam 3', 'Cam 2', 'Cam 4', 'Cam 5']);
  assert.deepStrictEqual(storedNames(), ['Cam 1', 'Cam 3', 'Cam 2', 'Cam 4', 'Cam 5'], 'the new order is saved');
  assert.strictEqual(focusedTile(), 2); assert.strictEqual(t.byId('cam-message').textContent, '');
  assert(!tiles().some(x => x.classList.contains('moving')));
  console.log('4 move ok');

  // 5. Remove camera asks first, and the safe answer is preselected
  await hold(); t.keyUp(K.OK);
  t.key(K.D); t.key(K.D); t.key(K.OK);               // Remove camera
  assert.strictEqual(t.byId('cam-menu-title').textContent, 'Remove "Cam 2"?');
  assert.deepStrictEqual(menuItems(), ['Yes, remove this camera', 'No, keep it']); assert.strictEqual(menuFocus(), 1);
  t.key(K.OK);                                       // No, keep it: back to the options
  assert(shown('cam-menu') && menuItems().length === 4 && names().length === 5);
  t.key(K.OK);                                       // Remove camera again (focus came back to it)
  t.key(K.U); t.key(K.OK);                           // Yes
  assert(!shown('cam-menu'));
  assert.deepStrictEqual(names(), ['Cam 1', 'Cam 3', 'Cam 4', 'Cam 5']);
  assert.deepStrictEqual(storedNames(), ['Cam 1', 'Cam 3', 'Cam 4', 'Cam 5']);
  console.log('5 remove ok');

  // 6. RETURN in the remove question goes back one step
  await hold(); t.keyUp(K.OK); t.key(K.D); t.key(K.D); t.key(K.OK); t.key(K.BACK);
  assert(shown('cam-menu') && menuItems().length === 4); t.key(K.BACK); assert(!shown('cam-menu'));
  assert.strictEqual(names().length, 4);
  console.log('6 remove can be backed out of ok');

  // 7. a stray key release does nothing
  t.keyUp(K.OK); assert(shown('view-cameras') && !shown('cam-menu'));

  // 8. Manage cameras mode: OK on a tile opens the same options without holding (for remotes that report no key releases)
  const tools = ['cam-add', 'cam-edit', 'cam-live', 'cam-view'];
  for (let i = 0; i < 4 && !tools.some(id => t.byId(id).classList.contains('focused')); i++) t.key(K.U);   // up to the toolbar
  for (let i = 0; i < 4 && !t.byId('cam-edit').classList.contains('focused'); i++) t.key(t.byId('cam-add').classList.contains('focused') ? K.R : K.L);
  t.key(K.OK);
  assert.strictEqual(t.byId('cam-edit').textContent, 'Manage cameras: on');
  t.key(K.D); t.key(K.OK);
  assert(shown('cam-menu'));
  console.log('8 manage mode opens options ok');

  // 9. a TV that never reports key releases: OK acts at once, nothing gets stuck
  delete require.cache[require.resolve('./harness.js')];
  t = require('./harness.js').run(preset());
  t.keyDown(K.OK);
  assert(!t.byId('view-player').classList.contains('hidden'), 'without key releases a press of OK watches at once');
  console.log('9 no key releases: tap still works ok');

  console.log('ALL MENU OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
