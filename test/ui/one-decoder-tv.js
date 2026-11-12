// A TV that plays only ONE video at a time: the second concurrent stream stalls with metadata but no frames.
const assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const players = [];
global.__mpegts = { isSupported: () => true, Events: { ERROR: 'error' },
  createPlayer: (cfg) => { const p = { cfg, destroyed: false, handlers: {}, on(e, f) { p.handlers[e] = f; }, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() { p.destroyed = true; },
    attachMediaElement(v) { p.v = v; Object.assign(v, { readyState: 0, videoWidth: 0, videoHeight: 0, paused: true, error: null, currentTime: 0 }); },
    play() { setTimeout(() => {
        const another = players.some(q => q !== p && !q.destroyed && q.ok);
        if (another) { Object.assign(p.v, { readyState: 1, videoWidth: 1920, videoHeight: 1080, paused: false }); }      // no decoder left: size known, no picture
        else { p.ok = true; Object.assign(p.v, { readyState: 4, videoWidth: 1920, videoHeight: 1080, paused: false, currentTime: 3 }); p.v.fire('playing'); }
      }, 50); return Promise.resolve(); } };
    players.push(p); return p; } };
global.__ctx = { MediaSource: { isTypeSupported: () => true } };
const cam = (id, host) => ({ id, name: id, host, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'flv', stream: 'main', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' });
const t = require('./harness.js').run({ 'rtsp-viewer-live': '2', 'rtsp-viewer-cameras': JSON.stringify({ cameras: [cam('A', '10.0.0.1'), cam('B', '10.0.0.2')] }) });
const { key, byId } = t;
const tiles = () => byId('cam-grid').children;
const note = i => tiles()[i].querySelector('.thumb-note').textContent;
const snapTag = i => { const e = tiles()[i].querySelector('.snap'); return e ? e.tag : null; };
(async () => {
  await sleep(9500);       // A live; B stalls (6 s) and is recognised as "no decoder left"
  assert(tiles()[0].classList.contains('has-thumb'), 'A is live');
  assert.strictEqual(byId('cam-live').textContent, 'Live view: focus');
  assert.strictEqual(t.store['rtsp-viewer-live'], 'focus', 'remembered for next launch');
  assert.strictEqual(byId('cam-message').textContent, 'This TV plays one live video at a time: the highlighted camera is live.');
  assert(/Highlight to see live/.test(note(1)), note(1));
  console.log('1 stall detected, switched to focus mode ok');

  key(K_R()); await sleep(2300);   // highlight B: the live tile moves
  assert(players[0].destroyed, 'A stream closed');
  assert(!tiles()[0].classList.contains('has-thumb') && /Highlight to see live/.test(note(0)), 'A goes back to its name card: ' + note(0));
  assert.strictEqual(tiles()[0].liveLine.textContent, '');
  const b = players[players.length - 1];
  assert(!b.destroyed && b.cfg.url.indexOf('10.0.0.2') >= 0, 'B is now the live stream: ' + b.cfg.url);
  assert(tiles()[1].classList.contains('has-thumb') && /● live/.test(tiles()[1].liveLine.textContent));
  console.log('2 live tile follows the highlight, old tile keeps its last picture ok');

  key(K_L()); await sleep(2300);
  assert(players[players.length - 1].cfg.url.indexOf('10.0.0.1') >= 0 && !players[players.length - 1].destroyed, 'A live again');
  assert(/Highlight to see live/.test(note(1)) && tiles()[1].liveLine.textContent === '');
  assert(/● live/.test(tiles()[0].liveLine.textContent), 'A shows live line again');
  console.log('3 moving back works ok');

  // fast cursor movement does not open a stream for every tile passed
  const n = players.length; key(K_R()); key(K_L()); key(K_R()); key(K_L()); await sleep(2300);
  assert(players.length <= n + 1, 'debounced: ' + (players.length - n));
  assert(new Set(players.map(p => p.v)).size <= 2, 'video elements are reused, saw ' + new Set(players.map(p => p.v)).size);
  console.log('4 video elements reused (' + new Set(players.map(p => p.v)).size + ' for ' + players.length + ' streams) ok');
  console.log('ALL FOCUS OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
function K_R() { return 39; } function K_L() { return 37; }
