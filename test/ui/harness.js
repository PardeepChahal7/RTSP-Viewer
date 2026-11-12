// A minimal fake browser, just enough to run the real js/app.js and drive it with key presses:
// a small DOM built from index.html, localStorage, timers, and stand-ins for XMLHttpRequest,
// Image, MediaSource and mpegts (tests set global.__ctx and global.__mpegts before requiring this).
// It cannot tell how a real TV behaves; it checks the app's own logic.
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = process.env.RTSP_VIEWER_ROOT || path.resolve(__dirname, '..', '..');

class El {
  constructor(tag, attrs) { this.tag = tag; this.attrs = attrs || {}; this.children = []; this.parent = null; this.listeners = {}; this._text = ''; this.value = ''; this.style = {}; this.failures = undefined;
    const self = this; const set = new Set((this.attrs['class'] || '').split(/\s+/).filter(Boolean));
    this.classList = { add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, f) => { const on = f === undefined ? !set.has(c) : !!f; on ? set.add(c) : set.delete(c); return on; } };
    this._set = set; }
  get className() { return [...this._set].join(' '); } set className(v) { this._set.clear(); v.split(/\s+/).filter(Boolean).forEach(c => this._set.add(c)); }
  get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  set innerHTML(v) { this.children = []; this._text = String(v).replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' '); }
  get innerHTML() { return this._text; }
  get firstChild() { return this.children[0] || null; }
  get parentNode() { return this.parent; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  insertBefore(c, ref) { c.parent = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
  removeChild(c) { this.children = this.children.filter(x => x !== c); }
  getAttribute(n) { return this.attrs.hasOwnProperty(n) ? this.attrs[n] : null; }
  removeAttribute(n) { delete this.attrs[n]; }
  load() {}
  hasAttribute(n) { return this.attrs.hasOwnProperty(n); }
  setAttribute(n, v) { this.attrs[n] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  pause() {}
  fire(t, e) { (this.listeners[t] || []).forEach(f => f(e || { target: this })); }
  focus() { doc.activeElement = this; } blur() { if (doc.activeElement === this) doc.activeElement = null; this.fire('blur'); }
  scrollIntoView() {}
  getContext() { return { drawImage() { this.drawn = true; }, getImageData(x, y, w, hh) { return { data: new Uint8Array(w * hh * 4).fill(200) }; } }; }
  matches(sel) { const m = sel.match(/^([a-z0-9]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i); if (!m) throw new Error('selector ' + sel);
    if (m[1] && m[1] !== this.tag) return false; for (const c of (m[2] || '').split('.').filter(Boolean)) if (!this._set.has(c)) return false;
    if (m[3]) { if (!this.hasAttribute(m[3])) return false; if (m[4] !== undefined && this.attrs[m[3]] !== m[4]) return false; } return true; }
  all(out) { this.children.forEach(c => { out.push(c); c.all(out); }); return out; }
  querySelectorAll(sel) { return this.all([]).filter(e => e.matches(sel)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const doc = new El('document'); doc.activeElement = null; doc.hidden = false;
doc.body = new El('body'); doc.createElement = t => new El(t);
doc.getElementById = id => doc.body.all([]).find(e => e.attrs.id === id) || null;
// tiny HTML parser for index.html
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
const VOID = new Set(['input', 'link', 'meta']); let cur = doc.body;
const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi; let m;
const body = html.slice(html.indexOf('<body>') + 6);
while ((m = re.exec(body))) {
  if (m[4] !== undefined) { cur._text += m[4].replace(/&nbsp;/g, ' ').trim() ? m[4].replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ') : ''; continue; }
  if (m[1]) { if (!VOID.has(m[2])) cur = cur.parent || cur; continue; }
  const attrs = {}; String(m[3]).replace(/([\w-]+)(?:="([^"]*)")?/g, (_, k, v) => { attrs[k] = v === undefined ? '' : v; });
  const e = new El(m[2].toLowerCase(), attrs); cur.appendChild(e); if (!VOID.has(m[2]) && !/\/\s*$/.test(m[3])) cur = e;
}
const store = {};
const timers = [];
const ctx = { document: doc, console, JSON, Math, Date, Object, Array, parseInt, parseFloat, String, Number, isNaN, encodeURIComponent, RegExp, Error,
  setTimeout: (f, ms) => { const id = setTimeout(f, ms); return id; }, clearTimeout, setInterval: (f, ms) => setInterval(f, ms), clearInterval,
  // A relay that is not there: every request fails at once, like a TV with nothing listening.
  XMLHttpRequest: function () {
    const x = this;
    x.open = () => {}; x.setRequestHeader = () => {};
    x.send = () => { setTimeout(() => { if (x.onerror) x.onerror(); }, 1); };
  },
  Image: function () { const self = this; Image.made.push(self); },
};
Image.made = []; ctx.Image = Image;
function Image() { const e = new El('img'); Image.made.push(e); return e; }
ctx.Image = Image;
ctx.addEventListener = () => {}; ctx.window = ctx; ctx.window.localStorage = { getItem: k => store.hasOwnProperty(k) ? store[k] : null, setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
ctx.window.innerWidth = 1920; ctx.window.innerHeight = 1080;
ctx.btoa = s => Buffer.from(s, 'binary').toString('base64');
ctx.atob = s => Buffer.from(s, 'base64').toString('binary');

// By default the fake TV has neither Web Crypto nor IndexedDB, so logins are stored as plain text and the app
// starts synchronously. Tests of encrypted storage set global.__crypto = true and use boot().
function fakeIndexedDB() {
  const data = global.__idbData = global.__idbData || {};   // survives from one app start to the next, like a TV's storage
  return { open(name) {
    const req = {};
    if (global.__idbHang) return req;   // a TV whose storage never answers
    setTimeout(() => {
      const fresh = !data[name];
      if (fresh) data[name] = { stores: {} };
      const db = {
        createObjectStore(s) { data[name].stores[s] = data[name].stores[s] || {}; },
        transaction(s) {
          const store = data[name].stores[s]; const tx = {};
          tx.objectStore = () => ({
            get(key) { const r = {}; setTimeout(() => { r.result = store[key]; if (r.onsuccess) r.onsuccess(); }, 0); return r; },
            put(value, key) { store[key] = value; setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0); return {}; },
          });
          return tx;
        },
      };
      req.result = db;
      if (fresh && req.onupgradeneeded) req.onupgradeneeded();
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  } };
}
if (global.__crypto) { ctx.crypto = require('crypto').webcrypto; ctx.indexedDB = fakeIndexedDB(); }
if (global.__mpegts) ctx.mpegts = global.__mpegts;
Object.assign(ctx, global.__ctx || {});
vm.createContext(ctx);
function run(preset) {
  Object.assign(store, preset || {});
  vm.runInContext(fs.readFileSync(path.join(root, 'js/app.js'), 'utf8'), ctx);
  const fire = (type, kc, extra) => (doc.listeners[type] || []).forEach(f => f(Object.assign({ keyCode: kc, preventDefault() {} }, extra)));
  return { doc, store, Image,
    key: kc => fire('keydown', kc),                          // a quick press: key down only
    keyDown: (kc, extra) => fire('keydown', kc, extra),      // pass { repeat: true } for the repeats of a held key
    keyUp: kc => fire('keyup', kc),
    byId: id => doc.getElementById(id) };
}
// With encryption available the app starts asynchronously: wait until it says it is ready.
function boot(preset) {
  const app = run(preset);
  return new Promise((resolve, reject) => {
    const began = Date.now();
    (function poll() {
      if (doc.body.classList.contains('ready')) return resolve(app);
      if (Date.now() - began > 5000) return reject(new Error('the app did not finish starting'));
      setTimeout(poll, 5);
    }());
  });
}
module.exports = { run, boot };
