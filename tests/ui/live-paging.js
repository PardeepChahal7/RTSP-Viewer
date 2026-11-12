// live tiles respect the view size and the page; video box is 16:9 and centred
const assert = require('assert');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const players = [];
global.__mpegts = { isSupported: () => true, Events: { ERROR: 'error' },
  createPlayer: (cfg) => { const p = { cfg, destroyed: false, on() {}, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() { p.destroyed = true; },
    attachMediaElement(v) { p.v = v; }, play() { setTimeout(() => { Object.assign(p.v, { readyState: 4, videoWidth: 1920, videoHeight: 1080, paused: false, currentTime: 1 }); p.v.fire('playing'); }, 30); return Promise.resolve(); } }; players.push(p); return p; } };
global.__ctx = { MediaSource: { isTypeSupported: () => true } };
const cam = (n) => ({ id: 'c' + n, name: 'Cam ' + n, host: '10.0.0.' + n, user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'flv', stream: 'main', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' });
const t = require('./harness.js').run({ 'rtsp-viewer-live': '4', 'rtsp-viewer-view': '2', 'rtsp-viewer-cameras': JSON.stringify({ cameras: [1, 2, 3, 4, 5, 6].map(cam) }) });
const { key, byId } = t;
const alive = () => players.filter(p => !p.destroyed).map(p => p.cfg.url.match(/10\.0\.0\.\d/) ? p.cfg.url : p.cfg.url);
(async () => {
  await sleep(2000);
  assert.strictEqual(players.length, 2, 'view 2 starts live video for the 2 tiles on the page only, not for all 4 allowed');
  const v = players[0].v;
  assert.deepStrictEqual([v.style.left, v.style.top, v.style.width, v.style.height], ['0px', '136px', '903px', '508px'], JSON.stringify(v.style));
  console.log('1 video box 903x508 centred in the 2-view tile ok');
  key(427); await sleep(2500);                // next page
  assert(players[0].destroyed && players[1].destroyed, 'page 1 streams closed');
  assert.strictEqual(players.length, 4); assert(!players[2].destroyed && !players[3].destroyed);
  assert.strictEqual(byId('cam-page').textContent.replace(/\s+/g, ' '), 'Page 2 / 3 (CH ▲▼)');
  console.log('2 paging moves the live tiles to the new page ok');
  console.log('ALL LIVE5 OK'); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
