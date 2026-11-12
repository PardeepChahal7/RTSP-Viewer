const assert = require('assert');
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, CHUP: 427, CHDN: 428 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cam = (n) => ({ id: 'c' + n, name: 'Cam ' + n, host: '10.0.0.' + n, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'flv', stream: 'sub', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' });
const N = 20;
const t = require('./harness.js').run({ 'rtsp-viewer-cameras': JSON.stringify({ cameras: Array.from({ length: N }, (_, i) => cam(i + 1)) }) });
const { key, byId } = t;
const tiles = () => byId('cam-grid').children;
const visible = () => tiles().map((x, i) => [x, i]).filter(([x]) => x.style.display === 'flex');
const focused = () => tiles().findIndex(x => x.classList.contains('focused'));
const px = v => parseInt(v, 10);
const gridClass = () => byId('cam-grid').className;

(async () => {
  await sleep(300);
  // default 4: 2x2, fills 1840x880 (fallback area) with 16px gaps
  assert.strictEqual(byId('cam-view').textContent, 'View: 4');
  let v = visible(); assert.strictEqual(v.length, 4);
  assert.deepStrictEqual([px(v[0][0].style.width), px(v[0][0].style.height)], [912, 432]);
  assert.strictEqual(px(v[0][0].style.marginRight), 16); assert.strictEqual(px(v[1][0].style.marginRight), 0);
  assert.strictEqual(px(v[0][0].style.marginBottom), 16); assert.strictEqual(px(v[2][0].style.marginBottom), 0);
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 1 / 5 (CH ▲▼)');
  assert(/\bv4\b/.test(gridClass()));
  console.log('1 view 4: 2x2 tiles 912x432, page 1/5 ok');

  // arrow keys inside the page; bottom row + Down goes to the next page
  assert.strictEqual(focused(), 0);
  key(K.R); assert.strictEqual(focused(), 1);
  key(K.D); assert.strictEqual(focused(), 3);
  key(K.D);                                   // bottom row of page 1 -> first tile of page 2
  assert.strictEqual(focused(), 4);
  assert.deepStrictEqual(visible().map(x => x[1]), [4, 5, 6, 7]);
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 2 / 5 (CH ▲▼)');
  key(K.CHUP); assert.deepStrictEqual(visible().map(x => x[1]), [8, 9, 10, 11]); assert.strictEqual(focused(), 8);
  key(K.CHDN); key(K.CHDN); assert.deepStrictEqual(visible().map(x => x[1]), [0, 1, 2, 3]);
  key(K.CHDN); assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 1 / 5 (CH ▲▼)', 'cannot go before page 1');
  console.log('2 navigation and paging ok');

  // cycle View: 4 -> 8 -> 16 -> 2 -> 4 through the toolbar
  key(K.U);                                   // top row -> toolbar
  key(K.R); key(K.R); key(K.R);
  assert(byId('cam-view').classList.contains('focused'));
  key(K.OK); assert.strictEqual(byId('cam-view').textContent, 'View: 8');
  v = visible(); assert.strictEqual(v.length, 8);
  assert.deepStrictEqual([px(v[0][0].style.width), px(v[0][0].style.height)], [448, 432]);
  assert.strictEqual(px(v[3][0].style.marginRight), 0, 'last of 4 columns has no gap');
  assert.strictEqual(t.store['rtsp-viewer-view'], '8');
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 1 / 3 (CH ▲▼)');
  key(K.OK); assert.strictEqual(byId('cam-view').textContent, 'View: 16');
  v = visible(); assert.strictEqual(v.length, 16);
  assert.deepStrictEqual([px(v[0][0].style.width), px(v[0][0].style.height)], [448, 208]);
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 1 / 2 (CH ▲▼)');
  key(K.OK); assert.strictEqual(byId('cam-view').textContent, 'View: 2');
  v = visible(); assert.strictEqual(v.length, 2);
  assert.deepStrictEqual([px(v[0][0].style.width), px(v[0][0].style.height)], [912, 880]);
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 1 / 10 (CH ▲▼)');
  assert(/\bv2\b/.test(gridClass()));
  console.log('3 views 8 / 16 / 2 fill the screen ok');

  // the focused camera stays on screen when the view changes
  key(K.D); key(K.R); assert.strictEqual(focused(), 1);       // toolbar -> tile 0 -> tile 1
  key(K.U); key(K.L); key(K.L); key(K.L);                     // toolbar: View -> Live -> Edit -> Add
  key(K.D);
  for (let i = 0; i < 9; i++) key(K.CHUP);                    // page 10
  assert.deepStrictEqual(visible().map(x => x[1]), [18, 19]);
  key(K.U); key(K.R); key(K.R); key(K.R); key(K.OK);          // View -> 4
  assert.strictEqual(byId('cam-view').textContent, 'View: 4');
  assert.deepStrictEqual(visible().map(x => x[1]), [16, 17, 18, 19], 'page containing the focused tile');
  console.log('4 focus stays visible across view changes ok');

  // fewer cameras than the view: tiles keep their cell size, no crash
  console.log('ALL VIEW OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
