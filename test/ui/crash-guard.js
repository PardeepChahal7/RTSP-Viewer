// crash guard: a flag left behind by a run that died switches live view off at the next launch
const assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const players = [];
global.__mpegts = { isSupported: () => true, Events: { ERROR: 'error' },
  createPlayer: (cfg) => { const p = { cfg, handlers: {}, on() {}, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() {}, attachMediaElement(v) { p.v = v; },
    play() { setTimeout(() => { Object.assign(p.v, { readyState: 4, videoWidth: 1920, videoHeight: 1080, paused: false, currentTime: 1 }); p.v.fire('playing'); }, 50); return Promise.resolve(); } }; players.push(p); return p; } };
global.__ctx = { MediaSource: { isTypeSupported: () => true } };
const cam = (id, host) => ({ id, name: id, host, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'flv', stream: 'main', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' });
const cams = JSON.stringify({ cameras: [cam('A', '10.0.0.1')] });
const mode = process.argv[2];
const t = require('./harness.js').run(mode === 'died'
  ? { 'rtsp-viewer-cameras': cams, 'rtsp-viewer-live': 'focus', 'rtsp-viewer-live-guard': '123' }
  : { 'rtsp-viewer-cameras': cams, 'rtsp-viewer-live': '2' });
const { key, byId } = t;
(async () => {
  await sleep(1500);
  if (mode === 'died') {
    assert.strictEqual(players.length, 0, 'no stream starts after a crash');
    assert.strictEqual(byId('cam-live').textContent, 'Live view: off');
    assert.strictEqual(t.store['rtsp-viewer-live'], 'off');
    assert(!t.store.hasOwnProperty('rtsp-viewer-live-guard'), 'guard cleared');
    assert(/closed while showing live tiles/.test(byId('cam-message').textContent), byId('cam-message').textContent);
    console.log('died: live view switched off with a notice ok');
  } else {
    assert.strictEqual(players.length, 1);
    assert(t.store.hasOwnProperty('rtsp-viewer-live-guard'), 'guard set while a tile runs');
    key(13);                                  // open the camera full screen: tiles stop
    assert(!t.store.hasOwnProperty('rtsp-viewer-live-guard'), 'guard cleared when tiles stop');
    key(10009); await sleep(1200);
    assert(t.store.hasOwnProperty('rtsp-viewer-live-guard'), 'guard set again when tiles restart');
    key(10009);                               // Back on the list = exit the app
    assert(!t.store.hasOwnProperty('rtsp-viewer-live-guard'), 'guard cleared on a normal exit');
    console.log('normal: guard set while running, cleared on every normal stop ok');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
