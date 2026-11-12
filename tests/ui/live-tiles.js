const assert = require('assert');
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, BACK: 10009 };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fake relay (XHR) ----
const calls = []; let relayVersionOld = false;
function FakeXHR() { const x = this; x.headers = {};
  x.open = (m, u) => { x.m = m; x.u = u; }; x.setRequestHeader = () => {};
  x.send = (b) => { const body = b ? JSON.parse(b) : null; calls.push({ m: x.m, u: x.u.replace('http://127.0.0.1:8139', ''), body });
    setTimeout(() => { x.readyState = 4; x.status = 200; const p = x.u.replace('http://127.0.0.1:8139', '');
      let out = { ok: true };
      if (p === '/ping') out = { ok: true, version: '1.2.0', multi: true };
      else if (p === '/start') out = relayVersionOld ? { ok: true, id: 'x', url: 'rtsp://cam' } : { ok: true, id: 'x', slot: body.slot, url: 'rtsp://cam' };
      else if (p.indexOf('/status') === 0) out = { ok: true, state: 'playing', video: { codec: 'H264' } };
      x.responseText = JSON.stringify(out); x.onreadystatechange(); }, 5); };
}
// ---- fake mpegts: the TV decodes at most `decodeLimit` streams ----
const players = []; let decodeLimit = 99;
global.__mpegts = { isSupported: () => true, Events: { ERROR: 'error' },
  createPlayer: (cfg) => { const p = { cfg, destroyed: false, handlers: {}, on(e, f) { p.handlers[e] = f; }, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() { p.destroyed = true; },
    attachMediaElement(v) { p.v = v; },
    play() { setTimeout(() => { if (players.filter(q => !q.destroyed && q.ok).length >= decodeLimit) { p.handlers.error('MediaError', 'decode'); } else { p.ok = true; Object.assign(p.v, { readyState: 4, videoWidth: 1920, videoHeight: 1080, paused: false, currentTime: 3 }); p.v.fire('playing'); } }, 50); return Promise.resolve(); } };
    players.push(p); return p; } };
global.__ctx = { XMLHttpRequest: FakeXHR, MediaSource: { isTypeSupported: () => true } };

const cam = (id, host, mode, extra) => Object.assign({ id, name: id, host, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode, rtspPort: '554', rtspPath: mode === 'rtsp' ? '/live0' : '', stream: 'main', audio: 'on', player: 'auto', rtspPlayer: 'auto', autoconnect: 'off' }, extra);
const preset = { 'rtsp-viewer-cameras': JSON.stringify({ cameras: [cam('A', '10.0.0.1', 'flv'), cam('B', '10.0.0.2', 'rtsp'), cam('C', '10.0.0.3', 'rtsp'), cam('D', '10.0.0.4', 'flv')] }) };
preset['rtsp-viewer-live'] = '2';
const t = require('./harness.js').run(preset);
const { key, byId } = t;
const tiles = () => byId('cam-grid').children;
const note = i => tiles()[i].querySelector('.thumb-note').textContent;
const liveCount = () => players.filter(p => !p.destroyed).length;
const starts = () => calls.filter(c => c.m === 'POST' && c.u === '/start');

(async () => {
  // default is 2 live tiles: A (flv, direct) and B (rtsp, through the relay), staggered
  assert.strictEqual(byId('cam-live').textContent, 'Live view: 2');
  assert(/Not live/.test(note(2)) && /Not live/.test(note(3)), 'cameras beyond the limit say so: ' + note(2));
  await sleep(500); assert.strictEqual(players.length, 1, 'only the first camera has started after 0.5 s');
  await sleep(1500);
  assert.strictEqual(players.length, 2);
  assert(/\/flv\?port=1935&app=bcs&stream=channel0_sub\.bcs&user=admin&password=pw$/.test(players[0].cfg.url), players[0].cfg.url);
  assert.strictEqual(players[0].cfg.type, 'flv');
  assert.strictEqual(players[1].cfg.url.replace(/&t=\d+$/, ''), 'http://127.0.0.1:8139/live.ts?slot=t1');
  assert.strictEqual(players[1].cfg.type, 'mpegts');
  const s = starts()[0].body;
  assert.deepStrictEqual([s.slot, s.host, s.port, s.path, s.stream, s.audio], ['t1', '10.0.0.2', 554, '/live0', 'sub', false]);
  assert(tiles()[0].classList.contains('has-thumb') && tiles()[1].classList.contains('has-thumb'), 'both tiles show video');
  assert.strictEqual(note(0), '');
  assert.strictEqual(tiles()[0].liveLine.textContent, '● live 1920x1080 · 3 s', 'status line under the tile');
  console.log('1 two live tiles, flv direct + rtsp via relay slot, staggered ok');

  // open a camera full screen: tile streams close, relay told to stop tiles
  key(K.R);                                  // focus tile B? (focus is tile 0 initially) -> tile 1
  const before = calls.length;
  key(K.OK);
  assert(!byId('view-player').classList.contains('hidden'));
  assert(players.slice(0, 2).every(p => p.destroyed), 'tile players destroyed');
  assert.strictEqual(tiles()[0].liveLine.textContent, '', 'status line cleared when the tile closes');
  assert(calls.slice(before).some(c => c.u === '/stop?tiles=1'), 'relay stop for tiles sent');
  assert(!calls.slice(before).some(c => c.u === '/stop'), 'main slot untouched by that stop');
  console.log('2 leaving the list closes the tile streams ok');

  // back to the list: tiles start again
  const n = players.length; key(K.BACK); await sleep(2200);
  assert(byId('view-cameras') && !byId('view-cameras').classList.contains('hidden'));
  assert.strictEqual(players.length, n + 2, 'tiles restarted');
  console.log('3 back on the list restarts live tiles ok');

  // Live view button: 2 -> 4
  key(K.U); key(K.R);
  assert(byId('cam-live').classList.contains('focused')); key(K.OK);
  assert.strictEqual(byId('cam-live').textContent, 'Live view: 4');
  assert.strictEqual(t.store['rtsp-viewer-live'], '4');
  await sleep(3500);
  assert.strictEqual(liveCount(), 4, 'four live tiles');
  console.log('4 live view 4 ok');

  // TV decoder limit: only 2 streams decode, others fail with MediaError
  key(K.OK); key(K.OK);                      // 4 -> focus -> off
  assert.strictEqual(byId('cam-live').textContent, 'Live view: off');
  assert.strictEqual(liveCount(), 0, 'off closes everything');
  assert(!tiles()[0].classList.contains('has-thumb') && note(0) === '');
  decodeLimit = 2;
  key(K.OK);                                 // off -> 2 ... then 4 again
  await sleep(2200); key(K.OK); await sleep(4200);   // -> 4
  assert.strictEqual(byId('cam-live').textContent, 'Live view: 4');
  assert(/TV decoder limit/.test(note(2)) || /TV decoder limit/.test(note(3)), [note(0), note(1), note(2), note(3)].join(' | '));
  assert.strictEqual(byId('cam-message').textContent, 'This TV shows 2 live views at once.');
  console.log('5 decoder limit detected and reported ok');

  // old relay still running (no slot support)
  relayVersionOld = true; decodeLimit = 99;
  key(K.OK); key(K.OK); key(K.OK);            // 4 -> focus -> off -> 2
  await sleep(2200);
  assert(/restart the app/.test(note(1)), note(1));
  console.log('6 old relay detected ok');
  console.log('ALL LIVE OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
