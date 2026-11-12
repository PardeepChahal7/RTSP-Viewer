// The About screen: reachable from the toolbar and the Blue key, shows the version, the project page, the author.
const assert = require('assert');
const fs = require('fs'), path = require('path');
const K = { L: 37, U: 38, R: 39, D: 40, OK: 13, BACK: 10009, BLUE: 406 };
const root = path.resolve(__dirname, '..', '..');
const cam = { id: 'c1', name: 'Cam 1', host: '10.0.0.1', user: 'a', password: 'b', channel: 0, port: '80', scheme: 'http', mode: 'rtsp', stream: 'sub', audio: 'off', player: 'auto', rtspPort: '554', rtspPath: '', rtspPlayer: 'auto', autoconnect: 'off' };
const t = require('./harness.js').run({ 'rtsp-viewer-cameras': JSON.stringify({ version: 2, encrypted: false, cameras: [cam] }) });
const shown = id => !t.byId(id).classList.contains('hidden');
const REPO = 'https://github.com/PardeepChahal7/RTSP-Viewer';

// 1. the main screen has the icon, and an About button at the end of the toolbar
const icon = t.byId('view-cameras').querySelectorAll('.app-icon')[0];
assert(icon && icon.attrs.src === 'icon.png', 'app icon on the main screen');
assert.strictEqual(t.byId('cam-about').textContent, 'About');
console.log('1 icon and About button ok');

// 2. the toolbar reaches About with the arrow keys and OK opens it; RETURN comes back
const tools = ['cam-add', 'cam-edit', 'cam-live', 'cam-view', 'cam-about'];
for (let i = 0; i < 4 && !tools.some(id => t.byId(id).classList.contains('focused')); i++) t.key(K.U);
for (let i = 0; i < 6; i++) t.key(K.R);
assert(t.byId('cam-about').classList.contains('focused'), 'About is the last toolbar button');
t.key(K.OK);
assert(shown('view-about') && !shown('view-cameras'));
const text = t.byId('view-about').textContent;
assert(/RTSP Viewer/.test(text) && /Pardeep/.test(text) && text.indexOf(REPO) >= 0, 'name, author and project page are on the screen');
assert(/Apps2Samsung\/ReolinkViewer/.test(text) && /mpegts\.js/.test(text) && /Claude/.test(text), 'credits');
assert(/MIT/.test(text));
t.key(K.BACK);
assert(shown('view-cameras') && !shown('view-about'));
console.log('2 toolbar -> About -> back ok');

// 3. the Blue key opens it from the main screen and closes it again
t.key(K.BLUE); assert(shown('view-about')); t.key(K.BLUE); assert(shown('view-cameras'));
console.log('3 Blue key ok');

// 4. the version shown is the one in config.xml, and the line about stored logins says what is true here
const config = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
const configVersion = config.match(/<widget[^>]*\sversion="([^"]+)"/)[1];
t.key(K.BLUE);
assert.strictEqual(t.byId('about-version').textContent, 'Version ' + configVersion, 'About shows the version of config.xml');
assert(/cannot encrypt/.test(t.byId('about-storage').textContent), 'the fake TV has no crypto, and the page says so: ' + t.byId('about-storage').textContent);
console.log('4 version', configVersion, 'matches config.xml ok');

// 5. the repository, author and files the About screen needs are in place
assert(/<author href="https:\/\/github\.com\/PardeepChahal7\/RTSP-Viewer">Pardeep<\/author>/.test(config), 'config.xml author');
assert(fs.existsSync(path.join(root, 'qr-repo.png')) && fs.readFileSync(path.join(root, 'index.html'), 'utf8').indexOf('src="qr-repo.png"') >= 0, 'QR image');
assert(/Copyright \(c\) 2026 Pardeep/.test(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')));
assert(/PardeepChahal7\/RTSP-Viewer/.test(fs.readFileSync(path.join(root, 'README.md'), 'utf8')));
console.log('5 author, repository and QR image in place ok');

console.log('ALL ABOUT OK'); process.exit(0);
