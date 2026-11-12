// How a tile's video can go wrong on a TV, one scenario per process: node tile-video.js <scenario>
const assert = require('assert');
const scenario = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const players = [];
global.__mpegts = { isSupported: () => true, Events: { ERROR: 'error' },
  createPlayer: (cfg) => { let plays = 0;
    const p = { cfg, handlers: {}, on(e, f) { p.handlers[e] = f; }, load() {}, pause() {}, unload() {}, detachMediaElement() {}, destroy() {},
      attachMediaElement(v) { p.v = v; Object.assign(v, { readyState: 0, videoWidth: 0, videoHeight: 0, paused: true, error: null }); },
      play() { plays++;
        const ready = () => Object.assign(p.v, { readyState: 4, videoWidth: 1920, videoHeight: 1080 });
        if (scenario === 'refuse-then-ok') { if (plays === 1) return Promise.reject({ name: 'NotAllowedError' }); ready(); p.v.paused = false; }
        else if (scenario === 'frames-no-event') { ready(); p.v.paused = false; }
        else if (scenario === 'paused-forever') { ready(); }
        else if (scenario === 'reject-always') { return Promise.reject({ name: 'NotAllowedError' }); }
        else if (scenario === 'video-error') { setTimeout(() => { p.v.error = { code: 3 }; p.v.fire('error'); }, 100); }
        else if (scenario === 'stream-error') { setTimeout(() => p.handlers.error('NetworkError', 'Exception'), 100); }
        return Promise.resolve(); } };
    players.push(p); return p; } };
global.__ctx = { MediaSource: { isTypeSupported: () => true } };
const preset = { 'rtsp-viewer-cameras': JSON.stringify({ cameras: [{ id: 'A', name: 'A', host: '10.0.0.1', user: 'admin', password: 'pw', channel: 0, port: '80', scheme: 'http', mode: 'flv', stream: 'main', audio: 'on', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' }] }) };
preset['rtsp-viewer-live'] = '2';
const t = require('./harness.js').run(preset);
const tile = () => t.byId('cam-grid').children[0];
const note = () => tile().querySelector('.thumb-note').textContent;
const wait = { 'never': 16000, 'reject-always': 16000, 'paused-forever': 6500 }[scenario] || 2500;
(async () => {
  await sleep(wait);
  const live = tile().classList.contains('has-thumb');
  const expect = {
    'refuse-then-ok': () => assert(live, 'live after the TV refused the first play(): ' + note()),
    'frames-no-event': () => assert(live, 'live from frames alone, no playing event: ' + note()),
    'paused-forever': () => assert(!live && /TV would not start playback/.test(note()), note()),
    'never': () => assert(!live && /no picture \(state 0, 0x0, paused\)/.test(note()), note()),
    'reject-always': () => assert(!live && /no picture \(state 0, 0x0, paused, play refused: NotAllowedError\)/.test(note()), note()),
    'video-error': () => assert(!live && /video error 3/.test(note()), note()),
    'stream-error': () => assert(!live && /stream error \(NetworkError: Exception\)/.test(note()), note()),
  }[scenario];
  expect(); console.log(scenario, 'ok:', live ? 'live' : note()); process.exit(0);
})().catch(e => { console.error(scenario, 'FAILED', e.message); process.exit(1); });
