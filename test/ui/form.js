// The add / edit form: RTSP is the default connection, the RTSP path field, and the Show checkbox in the password row.
const assert = require('assert');
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, GREEN: 404, YELLOW: 405 };
const t = require('./harness.js').run({});
const byId = t.byId;
const rows = () => byId('form').querySelectorAll('.focusable');
const rowOf = field => rows().find(r => r.attrs['data-field'] === field);
const hidden = field => rowOf(field).classList.contains('hidden');
const focusRow = pred => { for (let i = 0; i < 40; i++) t.key(K.U);   // from the top, whatever was focused before
  for (let i = 0; i < 40; i++) { const f = rows().find(r => r.classList.contains('focused')); if (pred(f)) return f; t.key(K.D); } throw new Error('row not found'); };
const type = (field, value) => { const input = rowOf(field).querySelector('input'); input.value = value; input.fire('blur'); };
const saved = () => JSON.parse(t.store['rtsp-viewer-cameras']).cameras;
const typeOf = el => el.type !== undefined ? el.type : el.attrs.type;   // the app sets the property, the page started with the attribute

// 1. a new camera starts as RTSP, with the RTSP rows showing and the HTTP-FLV rows hidden; there is no preset row
t.key(K.GREEN);
assert(/RTSP via relay/.test(byId('f-mode').textContent), byId('f-mode').textContent);
assert(!hidden('rtspPort') && !hidden('rtspPath') && !hidden('rtspPlayer'));
assert(hidden('port') && hidden('scheme'));
assert(!rowOf('preset') && !byId('f-preset'), 'no camera preset option');
assert(/\/live0/.test(rowOf('rtspPath').querySelector('.row-hint').textContent), 'the RTSP path hint names the Eufy path');
console.log('1 RTSP is the default connection, no preset row ok');

// 2. Show password: a checkbox in the password row, not a row of its own
assert(!rows().some(r => r.attrs['data-action'] === 'showpass'), 'no separate Show password row');
const pwRow = rowOf('password'); const box = byId('f-showpass'); const pw = byId('f-password');
assert(pwRow.children.includes(box), 'the checkbox lives inside the password row');
assert.strictEqual(typeOf(pw), 'password'); assert(!box.classList.contains('on'));
focusRow(r => r.attrs['data-field'] === 'password'); t.key(K.R);
assert.strictEqual(typeOf(pw), 'text'); assert(box.classList.contains('on'), 'ticked');
t.key(K.L); assert.strictEqual(typeOf(pw), 'password'); assert(!box.classList.contains('on'), 'left unticks it again');
box.fire('click', { stopPropagation() {} }); assert.strictEqual(typeOf(pw), 'text', 'a click on the box ticks it too');
type('host', '192.168.1.20'); type('password', 'hunter2');
assert.strictEqual(pw.value, 'hunter2');
console.log('2 show password checkbox ok');

// 3. save with the Eufy path typed by hand, as RTSP
type('rtspPath', '/live0');
focusRow(r => r.attrs['data-action'] === 'save'); t.key(K.OK);
const cam = saved()[0];
assert.strictEqual(cam.mode, 'rtsp'); assert.strictEqual(cam.rtspPath, '/live0'); assert.strictEqual(cam.rtspPort, '554');
console.log('3 saved as RTSP with the path ok');

// 4. a freshly opened form hides the password again
t.key(K.YELLOW);
assert.strictEqual(typeOf(byId('f-password')), 'password'); assert(!byId('f-showpass').classList.contains('on'));
console.log('4 form opens with the password hidden ok');

// 5. switching the connection to HTTP-FLV swaps the rows
focusRow(r => r.attrs['data-field'] === 'mode'); t.key(K.R);
assert(/HTTP-FLV/.test(byId('f-mode').textContent)); assert(hidden('rtspPath') && !hidden('port') && !hidden('scheme'));
console.log('5 HTTP-FLV still available ok');

console.log('ALL FORM OK'); process.exit(0);
