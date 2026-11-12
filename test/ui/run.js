// Runs every screen test, each in its own process (each one boots a fresh copy of the app).
//   node tests/ui/run.js
const { spawnSync } = require('child_process');
const path = require('path');

const runs = [
  ['screens.js'],
  ['view-modes.js'],
  ['form.js'],
  ['about.js'],
  ['camera-menu.js'],
  ['vault.js'],
  ['live-tiles.js'],
  ['live-paging.js'],
  ['one-decoder-tv.js'],
  ['crash-guard.js', 'died'],
  ['crash-guard.js', 'normal'],
  ['tile-video.js', 'refuse-then-ok'],
  ['tile-video.js', 'frames-no-event'],
  ['tile-video.js', 'video-error'],
  ['tile-video.js', 'stream-error'],
  ['tile-video.js', 'paused-forever'],
  ['tile-video.js', 'never'],
  ['tile-video.js', 'reject-always'],
];

let failed = 0;
for (const [file, ...args] of runs) {
  const label = [file].concat(args).join(' ');
  const result = spawnSync(process.execPath, [path.join(__dirname, file)].concat(args), { encoding: 'utf8', timeout: 120000 });
  if (result.status === 0) {
    console.log('ok      ' + label);
  } else {
    failed += 1;
    console.log('FAILED  ' + label);
    console.log((result.stdout || '') + (result.stderr || ''));
  }
}
console.log(failed ? failed + ' of ' + runs.length + ' failed' : 'all ' + runs.length + ' screen tests passed');
process.exit(failed ? 1 : 0);
