/*
 * RTSP Viewer for Samsung Tizen TVs.
 *
 * Two ways to get the picture:
 *
 *  - HTTP-FLV: the camera's own FLV-over-HTTP live stream (H.264 + AAC), fed
 *    to the TV's decoder through Media Source Extensions by mpegts.js. Works on
 *    every Tizen TV, but H.264 only.
 *  - RTSP: the camera's RTSP stream, fetched by the relay service that ships
 *    inside this package (service/relay.js) and re-served on 127.0.0.1 as
 *    MPEG-TS. That stream is played either by mpegts.js (MSE, low delay) or,
 *    when the browser cannot decode H.265, by Samsung's AVPlay from a live
 *    HLS playlist. Needs Tizen 4.0 (2018 models) for the service.
 *
 * Several cameras (or NVR channels) can be saved. The main screen is a tile grid
 * of them, each with a refreshing snapshot; OK watches, the toolbar adds and edits.
 *
 * Everything stays on the local network; the only thing the app talks to is
 * the camera / NVR the user typed in, and the relay on the TV itself.
 */
(function () {
    'use strict';

    var STORAGE_PREFIX = 'rtsp-viewer-';
    var CAMERAS_KEY = STORAGE_PREFIX + 'cameras';      // the saved camera list
    var VIEW_KEY = STORAGE_PREFIX + 'view';            // how many cameras fit on the main screen
    var VIEW_ORDER = ['2', '4', '8', '16'];
    var VIEW_MODES = {                                 // info = height of the name area under each picture
        '2': { cols: 2, rows: 1, info: 92 },
        '4': { cols: 2, rows: 2, info: 84 },
        '8': { cols: 4, rows: 2, info: 74 },
        '16': { cols: 4, rows: 4, info: 52 }
    };
    var TILE_GAP = 16;
    var APP_VERSION = '1.0.0';                         // keep equal to the version in config.xml (a test checks it)
    var LIVE_KEY = STORAGE_PREFIX + 'live';            // live tiles: off | 2 | 4 | focus (one live tile that follows the highlight)
    var LIVE_CHOICES = ['off', '2', '4', 'focus'];
    var LIVE_START_GAP_MS = 700;                       // connect the cameras one after another, not all at once
    var LIVE_TIMEOUT_MS = 15000;                       // give up on a tile that shows no picture by then
    var TILE_STALL_MS = 6000;                          // metadata but no frame this long, next to a working tile: no decoder left
    var FOCUS_DELAY_MS = 600;                          // wait for the highlight to settle before moving the live tile
    var FOCUS_HANDOVER_MS = 1500;                      // give the TV's decoder time to let go before the next stream
    var KEEP_LAST_PICTURE = false;                     // copying a hardware-decoded frame to a canvas is off until it is proven safe on the TV
    var LIVE_GUARD_KEY = STORAGE_PREFIX + 'live-guard';  // present while tiles run; still there at launch = the app died
    var TILE_PAUSED_LIMIT_MS = 4000;                   // frames but still paused after this long: the TV refuses to play
    var RELAY_BASE = 'http://127.0.0.1:8139';

    // Samsung TV remote key codes. Arrows / Enter are standard; the rest are Tizen-specific.
    var KEY = {
        LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13,
        RETURN: 10009, EXIT: 10182,
        PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413,
        CH_UP: 427, CH_DOWN: 428,
        GREEN: 404, YELLOW: 405, BLUE: 406
    };

    var DEFAULTS = {
        name: '',
        host: '',
        port: '80',
        scheme: 'http',
        user: 'admin',
        password: '',
        stream: 'sub',
        channel: 0,
        audio: 'on',
        mode: 'rtsp',           // 'rtsp' | 'flv'
        rtspPort: '554',
        rtspPath: '',           // '' = the standard paths
        rtspPlayer: 'auto',     // 'auto' | 'mse' | 'avplay'
        autoconnect: 'off'
    };

    // Display names for toggle values that are not self-explanatory.
    var LABELS = {
        flv: 'HTTP-FLV (H.264)',
        rtsp: 'RTSP via relay (H.264 / H.265)',
        auto: 'Automatic',
        mse: 'Browser (MSE)',
        avplay: 'TV player (AVPlay)'
    };

    var MPEGTS_CONFIG = {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 128,
        isLive: true,
        lazyLoad: false,
        liveBufferLatencyChasing: true,
        liveBufferLatencyMaxLatency: 3.0,
        liveBufferLatencyMinRemain: 0.5,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10,
        fixAudioTimestampGap: true,
        reuseRedirectedURL: true
    };

    var RECONNECT_BASE_MS = 3000;
    var RECONNECT_MAX_MS = 30000;
    var OVERLAY_HIDE_MS = 4000;

    var RELAY_LAUNCH_TRIES = 25;          // x 300 ms waiting for the service to answer /ping
    var RELAY_START_TIMEOUT_MS = 25000;   // relay must reach 'playing' (first keyframe) in this time
    var RELAY_POLL_MS = 1000;
    var HLS_MIN_SEGMENTS = 3;             // AVPlay wants a few segments before it starts

    var settings = cloneDefaults();   // working copy for the camera being edited or watched
    var cameras = [];                 // the saved camera list

    var el = {
        setup: document.getElementById('view-setup'),
        player: document.getElementById('view-player'),
        form: document.getElementById('form'),
        setupMessage: document.getElementById('setup-message'),
        showPass: document.getElementById('f-showpass'),
        camMenu: document.getElementById('cam-menu'),
        camMenuTitle: document.getElementById('cam-menu-title'),
        camMenuItems: document.getElementById('cam-menu-items'),
        video: document.getElementById('video'),
        avObject: document.getElementById('av-player'),
        overlay: document.getElementById('overlay'),
        status: document.getElementById('status'),
        stats: document.getElementById('stats'),
        nowPlaying: document.getElementById('now-playing'),
        playerKeys: document.getElementById('player-keys'),
        cameras: document.getElementById('view-cameras'),
        camGrid: document.getElementById('cam-grid'),
        camEmpty: document.getElementById('cam-empty'),
        camAdd: document.getElementById('cam-add'),
        camEdit: document.getElementById('cam-edit'),
        camLive: document.getElementById('cam-live'),
        camView: document.getElementById('cam-view'),
        camAbout: document.getElementById('cam-about'),
        about: document.getElementById('view-about'),
        aboutVersion: document.getElementById('about-version'),
        aboutStorage: document.getElementById('about-storage'),
        camPage: document.getElementById('cam-page'),
        camMessage: document.getElementById('cam-message'),
        setupTitle: document.getElementById('setup-title')
    };

    var rows = Array.prototype.slice.call(el.form.querySelectorAll('.focusable'));
    var focusedRow = null;
    var currentView = 'cameras';    // 'cameras' | 'setup' (add / edit) | 'player'

    var camTiles = [];              // tile elements on the camera screen
    var camTile = 0;                // focused tile
    var camZone = 'grid';           // 'grid' | 'toolbar'
    var camToolbar = 0;             // 0 = Add camera, 1 = Manage cameras, 2 = Live view, 3 = View, 4 = About
    var editMode = false;           // OK on a tile edits it instead of watching
    var editingCamera = null;       // camera being edited, null while adding a new one
    var playingIndex = -1;          // index in `cameras` of the camera on screen
    var deleteArmed = false;        // first OK on Delete asks for confirmation
    var liveSetting = loadLiveSetting();
    var viewMode = loadViewMode();
    var camPage = 0;                // page of the camera screen (tiles beyond the view size go to the next page)
    var tileGeo = null;             // where the 16:9 picture sits inside a tile
    var decoderCap = 99;            // lowered when the TV turns out to decode fewer streams at once
    var liveRun = 0;                // bumped on every stop, so late callbacks from an old run do nothing
    var liveTiles = [];             // { tile, index, slot, player, video, relay, live }
    var focusTimer = null;
    var showPassword = false;       // the Show password checkbox on the add / edit form
    var menu = null;                // options menu of one camera: { index, step: 'main' | 'remove', focus }
    var moveState = null;           // while a camera is being moved: { index, from, backup }
    var enterDown = false;          // OK is held down on a camera tile
    var enterDownAt = 0;
    var holdTimer = null;
    var holdFired = false;
    var keyupSeen = false;          // hold-OK needs key-release events; until one arrives OK acts at once
    var HOLD_MS = 700;
    var saveTicket = 0;
    var savedTicket = 0;
    var vault = { key: null, encrypted: false };
    var videoPool = [];             // tile <video> elements are reused, never thrown away: the TV frees a decoder with its element, not before
    var pendingNotice = '';
    var lastLiveIndex = 0;          // the camera that was live last, for focus mode when the toolbar is highlighted

    var player = null;              // mpegts.js player (FLV or relay TS)
    var avplayActive = false;       // AVPlay has a stream open
    var avplayPaused = false;
    var activeBackend = null;       // 'flv' | 'mse' | 'avplay'
    var startToken = 0;             // bumps on every (re)start; stale async steps check it
    var relaySessionId = null;
    var relayPollTimer = null;
    var mseFailedForRelay = false;  // MSE could not decode the relay stream: automatic mode uses AVPlay
    var reconnectTimer = null;
    var reconnectAttempt = 0;
    var overlayTimer = null;
    var lastMediaInfo = null;
    var lastRelayStatus = null;

    // ------------------------------------------------------------------ settings

    function cloneDefaults() {
        var copy = {};
        Object.keys(DEFAULTS).forEach(function (key) { copy[key] = DEFAULTS[key]; });
        return copy;
    }

    // A camera record is the settings fields plus an id.
    function cameraToSettings(cam) {
        var copy = {};
        Object.keys(DEFAULTS).forEach(function (key) {
            copy[key] = cam.hasOwnProperty(key) ? cam[key] : DEFAULTS[key];
        });
        return copy;
    }

    function newCameraId() {
        return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
    }

    function normalizeCamera(raw) {
        var cam = cameraToSettings(raw || {});
        cam.id = (raw && raw.id) || newCameraId();
        if (!cam.name) {
            cam.name = cam.host;
        }
        return cam;
    }

    function cameraLabel(cam) {
        return cam.name || cam.host || 'Camera';
    }

    // ---- storage of the camera list, with encrypted logins
    //
    // Usernames and passwords are encrypted with AES-256-GCM before they are written to localStorage,
    // bound to the camera's id. The key is a non-extractable CryptoKey kept in IndexedDB, so it is never
    // written out as bytes. That keeps the logins unreadable in copies of the app's stored data; it cannot
    // protect against code running inside the app itself. Where the TV's browser has no Web Crypto or
    // IndexedDB the logins are stored as plain text, and the app says so.

    function subtleCrypto() {
        var api = window.crypto || window.msCrypto;
        return api && (api.subtle || api.webkitSubtle) ? (api.subtle || api.webkitSubtle) : null;
    }

    function toBytes(text) {
        var binary = unescape(encodeURIComponent(text));
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function fromBytes(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return decodeURIComponent(escape(binary));
    }

    function toBase64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    function fromBase64(text) {
        var binary = window.atob(text);
        var bytes = new Uint8Array(binary.length);
        for (var i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    // Find the key, or make one the first time. Always calls done(); vault.encrypted says what happened.
    function initVault(done) {
        var subtle = subtleCrypto();
        if (!subtle || !window.indexedDB) {
            done();
            return;
        }
        var finished = false;
        function finish() {
            if (!finished) {
                finished = true;
                done();
            }
        }
        // A TV whose storage never answers must not leave the app waiting: start without encryption.
        setTimeout(function () {
            if (!finished) {
                vault.key = null;
                vault.encrypted = false;
                finish();
            }
        }, 3000);
        try {
            var open = window.indexedDB.open('rtsp-viewer', 1);
            open.onupgradeneeded = function () {
                open.result.createObjectStore('keys');
            };
            open.onerror = finish;
            open.onsuccess = function () {
                var db = open.result;
                var get = db.transaction('keys', 'readonly').objectStore('keys').get('main');
                get.onerror = finish;
                get.onsuccess = function () {
                    if (finished) {
                        return;
                    }
                    if (get.result) {
                        vault.key = get.result;
                        vault.encrypted = true;
                        finish();
                        return;
                    }
                    subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then(function (key) {
                        var tx = db.transaction('keys', 'readwrite');
                        tx.objectStore('keys').put(key, 'main');
                        tx.oncomplete = function () {
                            if (finished) {
                                return;
                            }
                            vault.key = key;
                            vault.encrypted = true;
                            finish();
                        };
                        tx.onerror = finish;
                        tx.onabort = finish;
                    }, finish);
                };
            };
        } catch (e) {
            finish();
        }
    }

    // done(text), or done(null) when encrypting failed
    function sealLogin(cam, done) {
        try {
            var iv = new Uint8Array(12);
            (window.crypto || window.msCrypto).getRandomValues(iv);
            subtleCrypto().encrypt(
                { name: 'AES-GCM', iv: iv, additionalData: toBytes(cam.id) },
                vault.key,
                toBytes(JSON.stringify({ user: cam.user, password: cam.password }))
            ).then(function (buffer) {
                done('v1.' + toBase64(iv) + '.' + toBase64(new Uint8Array(buffer)));
            }, function () {
                done(null);
            });
        } catch (e) {
            done(null);
        }
    }

    // done({ user, password }), or done(null) when the text cannot be read with this key
    function openLogin(cam, text, done) {
        var parts = String(text).split('.');
        if (parts.length !== 3 || parts[0] !== 'v1') {
            done(null);
            return;
        }
        try {
            subtleCrypto().decrypt(
                { name: 'AES-GCM', iv: fromBase64(parts[1]), additionalData: toBytes(cam.id) },
                vault.key,
                fromBase64(parts[2])
            ).then(function (buffer) {
                try {
                    var login = JSON.parse(fromBytes(new Uint8Array(buffer)));
                    done({ user: String(login.user || ''), password: String(login.password || '') });
                } catch (e) {
                    done(null);
                }
            }, function () {
                done(null);
            });
        } catch (e2) {
            done(null);
        }
    }

    // done(list, info): info.unreadable = cameras whose login could not be decrypted,
    // info.resave = plain-text logins that should now be stored encrypted.
    function loadCameras(done) {
        var raw = null;
        try {
            raw = window.localStorage.getItem(CAMERAS_KEY);
        } catch (e) {
            raw = null;
        }
        var items = [];
        if (raw !== null) {
            try {
                var data = JSON.parse(raw);
                if (data && Array.isArray(data.cameras)) {
                    items = data.cameras;
                }
            } catch (e2) {
                // Unreadable list: start empty rather than crash.
            }
        }
        var list = [];
        var info = { unreadable: 0, resave: false };
        var remaining = items.length;
        if (!remaining) {
            done(list, info);
            return;
        }
        items.forEach(function (item, index) {
            item = item || {};
            var cam = normalizeCamera(item);
            list[index] = cam;
            function next() {
                remaining -= 1;
                if (!remaining) {
                    done(list, info);
                }
            }
            if (typeof item.secret === 'string') {
                cam.user = '';
                cam.password = '';
                if (!vault.encrypted) {
                    info.unreadable += 1;
                    next();
                    return;
                }
                openLogin(cam, item.secret, function (login) {
                    if (login) {
                        cam.user = login.user;
                        cam.password = login.password;
                    } else {
                        info.unreadable += 1;
                    }
                    next();
                });
                return;
            }
            if (vault.encrypted && (item.password || item.user)) {
                info.resave = true;   // stored in plain text before encryption was available
            }
            next();
        });
    }

    function saveCameras() {
        saveTicket += 1;
        var ticket = saveTicket;
        var snapshot = cameras.map(function (cam) {
            var copy = {};
            Object.keys(cam).forEach(function (key) { copy[key] = cam[key]; });
            return copy;
        });
        var out = new Array(snapshot.length);
        var remaining = snapshot.length;
        var failed = false;
        function write() {
            if (failed) {
                el.camMessage.textContent = 'Could not encrypt the camera logins, so the changes were not saved.';
                return;
            }
            if (ticket < savedTicket) {
                return;   // a newer save already went through
            }
            savedTicket = ticket;
            try {
                window.localStorage.setItem(CAMERAS_KEY, JSON.stringify({ version: 2, encrypted: vault.encrypted, cameras: out }));
            } catch (e) {
                // Storage unavailable: the app still works for this session.
            }
        }
        function check() {
            remaining -= 1;
            if (!remaining) {
                write();
            }
        }
        if (!remaining) {
            write();
            return;
        }
        snapshot.forEach(function (cam, index) {
            if (!vault.encrypted) {
                out[index] = cam;
                check();
                return;
            }
            sealLogin(cam, function (text) {
                if (text === null) {
                    failed = true;
                } else {
                    var stored = {};
                    Object.keys(cam).forEach(function (key) {
                        if (key !== 'user' && key !== 'password') {
                            stored[key] = cam[key];
                        }
                    });
                    stored.secret = text;
                    out[index] = stored;
                }
                check();
            });
        });
    }

    function buildStreamUrl(opts) {
        var defaultPort = opts.scheme === 'https' ? '443' : '80';
        var hostPort = opts.host + (opts.port && opts.port !== defaultPort ? ':' + opts.port : '');
        return opts.scheme + '://' + hostPort +
            '/flv?port=1935&app=bcs' +
            '&stream=channel' + opts.channel + '_' + opts.stream + '.bcs' +
            '&user=' + encodeURIComponent(opts.user) +
            '&password=' + encodeURIComponent(opts.password);
    }

    function maskPassword(url) {
        return url.replace(/password=[^&]*/, 'password=••••');
    }

    // ------------------------------------------------------------------ form rendering

    function visibleRows() {
        return rows.filter(function (row) { return !row.classList.contains('hidden'); });
    }

    // Rows marked data-mode only apply to one connection mode; rows marked
    // data-existing (Delete) only exist while editing a saved camera.
    function applyModeVisibility() {
        rows.forEach(function (row) {
            var mode = row.getAttribute('data-mode');
            if (mode) {
                row.classList.toggle('hidden', mode !== settings.mode);
            }
            if (row.hasAttribute('data-existing')) {
                row.classList.toggle('hidden', !editingCamera);
            }
        });
    }

    function toggleShowPassword() {
        showPassword = !showPassword;
        renderShowPassword();
    }

    function renderShowPassword() {
        var input = document.getElementById('f-password');
        input.type = showPassword ? 'text' : 'password';
        el.showPass.classList.toggle('on', showPassword);
    }

    function renderRow(row) {
        var field = row.getAttribute('data-field');
        if (!field) {
            return;
        }
        var type = row.getAttribute('data-type');
        if (type === 'text') {
            row.querySelector('input').value = settings[field];
        } else {
            var value = String(settings[field]);
            row.querySelector('.value').textContent = LABELS.hasOwnProperty(value) ? LABELS[value] : value;
        }
    }

    function renderForm() {
        applyModeVisibility();
        rows.forEach(renderRow);
        renderShowPassword();
    }

    // target: a row element, or an index into the visible rows.
    function setFocus(target) {
        var list = visibleRows();
        var index = typeof target === 'number' ? target : list.indexOf(target);
        index = Math.max(0, Math.min(list.length - 1, index));
        focusedRow = list[index];
        rows.forEach(function (row) {
            row.classList.toggle('focused', row === focusedRow);
        });
        focusedRow.scrollIntoView({ block: 'nearest' });
    }

    function moveFocus(direction) {
        setFocus(visibleRows().indexOf(focusedRow) + direction);
    }

    function cycleOption(row, direction) {
        var field = row.getAttribute('data-field');
        var options = row.getAttribute('data-options').split(',');
        var index = options.indexOf(String(settings[field]));
        index = (index + direction + options.length) % options.length;
        settings[field] = options[index];
        renderRow(row);
        if (field === 'mode') {
            applyModeVisibility();
        }
    }

    function stepValue(row, direction) {
        var field = row.getAttribute('data-field');
        var min = parseInt(row.getAttribute('data-min'), 10);
        var max = parseInt(row.getAttribute('data-max'), 10);
        var value = parseInt(settings[field], 10) + direction;
        settings[field] = Math.max(min, Math.min(max, value));
        renderRow(row);
    }

    function adjustRow(row, direction) {
        var type = row.getAttribute('data-type');
        if (type === 'toggle') {
            cycleOption(row, direction);
        } else if (type === 'stepper') {
            stepValue(row, direction);
        } else if (row.getAttribute('data-field') === 'password') {
            toggleShowPassword();   // the Show checkbox sits in the password row: left / right tick it
        }
    }

    function activateRow(row) {
        var action = row.getAttribute('data-action');
        if (action === 'start') {
            startFromForm();
            return;
        }
        if (action === 'save') {
            saveFromForm();
            return;
        }
        if (action === 'delete') {
            deleteFromForm(row);
            return;
        }
        var type = row.getAttribute('data-type');
        if (type === 'text') {
            // Hand DOM focus to the input: the TV's on-screen keyboard opens.
            row.querySelector('input').focus();
        } else {
            adjustRow(row, 1);
        }
    }

    function commitInput(input) {
        var field = input.parentNode.getAttribute('data-field');
        settings[field] = input.value.trim();
    }

    function showSetupMessage(text) {
        el.setupMessage.textContent = text || '';
    }

    function validateSettings() {
        if (!settings.host) {
            return 'Enter the camera IP address first.';
        }
        if (settings.mode === 'rtsp') {
            if (settings.rtspPort && !/^\d+$/.test(settings.rtspPort)) {
                return 'RTSP port must be a number.';
            }
        } else if (settings.port && !/^\d+$/.test(settings.port)) {
            return 'Port must be a number.';
        }
        return null;
    }

    // Validate the form and store it: updates the camera being edited, or adds a new one.
    function commitForm() {
        var problem = validateSettings();
        if (problem) {
            showSetupMessage(problem);
            setFocus(el.form.querySelector('[data-field="host"]'));
            return null;
        }
        showSetupMessage('');
        if (!settings.name) {
            settings.name = settings.host;
        }
        var cam = editingCamera;
        if (!cam) {
            cam = { id: newCameraId() };
            cameras.push(cam);
        }
        Object.keys(DEFAULTS).forEach(function (key) { cam[key] = settings[key]; });
        editingCamera = cam;
        saveCameras();
        camTile = cameras.indexOf(cam);
        camZone = 'grid';
        return cam;
    }

    function startFromForm() {
        var cam = commitForm();
        if (cam) {
            openPlayer(cameras.indexOf(cam));
        }
    }

    function saveFromForm() {
        if (commitForm()) {
            showCameras();
        }
    }

    function deleteFromForm(row) {
        if (!editingCamera) {
            return;
        }
        if (!deleteArmed) {
            deleteArmed = true;
            row.textContent = 'Press OK again to delete this camera';
            return;
        }
        cameras.splice(cameras.indexOf(editingCamera), 1);
        saveCameras();
        showCameras();
    }

    function disarmDelete() {
        deleteArmed = false;
        var row = el.form.querySelector('[data-action="delete"]');
        if (row) {
            row.textContent = 'Delete camera';
        }
    }

    // Open the form for a saved camera, or blank to add a new one.
    function openEditor(cam) {
        editingCamera = cam || null;
        settings = cam ? cameraToSettings(cam) : cloneDefaults();
        disarmDelete();
        showPassword = false;
        showSetupMessage('');
        el.setupTitle.textContent = cam ? 'Edit camera' : 'Add camera';
        showView('setup');
        renderForm();
        setFocus(0);
    }

    // RETURN on the form: back to the camera list, nothing saved.
    function cancelEditor() {
        showCameras();
    }

    // ------------------------------------------------------------------ views

    function showView(name) {
        currentView = name;
        el.cameras.classList.toggle('hidden', name !== 'cameras');
        el.setup.classList.toggle('hidden', name !== 'setup');
        el.player.classList.toggle('hidden', name !== 'player');
        el.about.classList.toggle('hidden', name !== 'about');
        if (name !== 'cameras') {
            stopLiveTiles();
        }
    }

    // ---- About screen

    function appVersion() {
        try {
            var version = window.tizen.application.getCurrentApplication().appInfo.version;
            if (version) {
                return version;
            }
        } catch (e) {
            // Not running on a TV: use the built-in number.
        }
        return APP_VERSION;
    }

    function openAbout() {
        el.aboutVersion.textContent = 'Version ' + appVersion();
        el.aboutStorage.textContent = vault.encrypted
            ? 'Camera user names and passwords are stored encrypted on this TV.'
            : 'This TV cannot encrypt, so camera logins are stored as plain text.';
        showView('about');
    }

    function handleAboutKey(event) {
        switch (event.keyCode) {
            case KEY.RETURN:
            case KEY.ENTER:
            case KEY.BLUE:
                showCameras();
                break;
            case KEY.EXIT:
                exitApp();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    function exitApp() {
        stopLiveTiles();
        stopRelaySession();
        try {
            window.tizen.application.getCurrentApplication().exit();
        } catch (e) {
            // Not running on Tizen (e.g. desktop browser during development).
        }
    }

    // ------------------------------------------------------------------ camera screen

    function describeCamera(cam) {
        return cam.host + (cam.mode === 'rtsp' ? '  ·  RTSP' : '') + '  ·  ch ' + cam.channel + '  ·  ' + cam.stream;
    }

    function showCameras() {
        editingCamera = null;
        editMode = false;
        showView('cameras');
        renderCameraList();
        if (pendingNotice) {
            el.camMessage.textContent = pendingNotice;
            pendingNotice = '';
        }
        startLiveTiles();
    }

    function renderCameraList() {
        el.camGrid.innerHTML = '';
        camTiles = [];
        el.camMessage.textContent = '';
        el.camMessage.className = '';
        cameras.forEach(function (cam, index) {
            var tile = document.createElement('div');
            tile.className = 'tile';
            var thumb = document.createElement('div');
            thumb.className = 'thumb';
            var badge = document.createElement('div');
            badge.className = 'edit-badge';
            badge.textContent = '⋯ Options';
            thumb.appendChild(badge);
            var note = document.createElement('div');
            note.className = 'thumb-note';
            thumb.appendChild(note);
            var info = document.createElement('div');
            info.className = 'tile-info';
            var title = document.createElement('div');
            title.className = 'tile-name';
            title.textContent = cameraLabel(cam);
            var sub = document.createElement('div');
            sub.className = 'tile-sub';
            sub.textContent = describeCamera(cam);
            var liveLine = document.createElement('div');
            liveLine.className = 'tile-live';
            tile.liveLine = liveLine;
            info.appendChild(title);
            info.appendChild(sub);
            info.appendChild(liveLine);
            tile.appendChild(thumb);
            tile.appendChild(info);
            tile.addEventListener('click', function () {
                camZone = 'grid';
                camTile = index;
                applyCamFocus();
                activateCamera();
            });
            el.camGrid.appendChild(tile);
            camTiles.push(tile);
        });
        el.camGrid.classList.toggle('editing', editMode);
        el.camEdit.textContent = 'Manage cameras: ' + (editMode ? 'on' : 'off');
        el.camLive.textContent = 'Live view: ' + liveSetting;
        el.camEmpty.classList.toggle('hidden', cameras.length > 0);
        if (!cameras.length) {
            camZone = 'toolbar';
            camToolbar = 0;
        }
        camTile = Math.max(0, Math.min(cameras.length - 1, camTile));
        camPage = pageOf(camTile);
        el.camView.textContent = 'View: ' + viewMode;
        layoutTiles();
        applyCamFocus();
    }

    // ---- options for one camera (hold OK on its tile): edit, move, remove

    function openCameraMenu(index) {
        if (!cameras[index]) {
            return;
        }
        menu = { index: index, step: 'main', focus: 0 };
        renderMenu();
    }

    function menuItems() {
        return menu.step === 'remove'
            ? ['Yes, remove this camera', 'No, keep it']
            : ['Edit camera', 'Move camera', 'Remove camera', 'Close'];
    }

    function renderMenu() {
        var cam = cameras[menu.index];
        el.camMenuTitle.textContent = menu.step === 'remove' ? 'Remove "' + cameraLabel(cam) + '"?' : cameraLabel(cam);
        el.camMenuItems.innerHTML = '';
        menuItems().forEach(function (label, i) {
            var item = document.createElement('div');
            item.className = 'cam-menu-item' + (i === menu.focus ? ' focused' : '') +
                (menu.step === 'remove' && i === 0 ? ' danger' : '');
            item.textContent = label;
            item.addEventListener('click', function () {
                if (menu) {
                    menu.focus = i;
                    chooseMenuItem();
                }
            });
            el.camMenuItems.appendChild(item);
        });
        el.camMenu.classList.remove('hidden');
    }

    function closeCameraMenu() {
        menu = null;
        el.camMenu.classList.add('hidden');
    }

    function chooseMenuItem() {
        var index = menu.index;
        var choice = menu.focus;
        if (menu.step === 'remove') {
            if (choice === 0) {
                closeCameraMenu();
                removeCamera(index);
            } else {
                menu.step = 'main';
                menu.focus = 2;
                renderMenu();
            }
            return;
        }
        if (choice === 0) {
            closeCameraMenu();
            openEditor(cameras[index]);
        } else if (choice === 1) {
            closeCameraMenu();
            startMove(index);
        } else if (choice === 2) {
            menu.step = 'remove';
            menu.focus = 1;   // the safe answer is pre-selected
            renderMenu();
        } else {
            closeCameraMenu();
        }
    }

    function handleMenuKey(event) {
        var count = menuItems().length;
        switch (event.keyCode) {
            case KEY.UP:
                menu.focus = (menu.focus + count - 1) % count;
                renderMenu();
                break;
            case KEY.DOWN:
                menu.focus = (menu.focus + 1) % count;
                renderMenu();
                break;
            case KEY.ENTER:
                chooseMenuItem();
                break;
            case KEY.RETURN:
                if (menu.step === 'remove') {
                    menu.step = 'main';
                    menu.focus = 2;
                    renderMenu();
                } else {
                    closeCameraMenu();
                }
                break;
            case KEY.EXIT:
                exitApp();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    function removeCamera(index) {
        cameras.splice(index, 1);
        saveCameras();
        camTile = Math.max(0, Math.min(cameras.length - 1, index));
        showCameras();
    }

    // Move: the camera is picked up and follows the arrow keys; OK puts it down, RETURN puts it back.
    function startMove(index) {
        stopLiveTiles();
        moveState = { index: index, from: index, backup: cameras.slice() };
        showMoveHint();
        applyMoveHighlight();
    }

    function showMoveHint() {
        el.camMessage.className = 'move-hint';   // an instruction, not a warning
        el.camMessage.textContent = 'Moving "' + cameraLabel(cameras[moveState.index]) +
            '": arrows move it, OK places it, RETURN cancels.';
    }

    function applyMoveHighlight() {
        camTiles.forEach(function (tile, i) {
            tile.classList.toggle('moving', !!moveState && i === moveState.index);
        });
    }

    function moveCameraBy(dx, dy) {
        var target = moveState.index + dx + dy * VIEW_MODES[viewMode].cols;
        target = Math.max(0, Math.min(cameras.length - 1, target));
        if (target === moveState.index) {
            return;
        }
        var cam = cameras.splice(moveState.index, 1)[0];
        cameras.splice(target, 0, cam);
        moveState.index = target;
        camTile = target;
        camZone = 'grid';
        renderCameraList();   // the tiles in their new order, on the page that now holds it
        showMoveHint();
        applyMoveHighlight();
    }

    function finishMove(keep) {
        if (keep) {
            saveCameras();
        } else {
            cameras = moveState.backup;
            camTile = moveState.from;
        }
        moveState = null;
        showCameras();
    }

    function handleMoveKey(event) {
        switch (event.keyCode) {
            case KEY.LEFT:
                moveCameraBy(-1, 0);
                break;
            case KEY.RIGHT:
                moveCameraBy(1, 0);
                break;
            case KEY.UP:
                moveCameraBy(0, -1);
                break;
            case KEY.DOWN:
                moveCameraBy(0, 1);
                break;
            case KEY.ENTER:
                finishMove(true);
                break;
            case KEY.RETURN:
                finishMove(false);
                break;
            case KEY.EXIT:
                exitApp();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    // ---- view size: 2, 4, 8 or 16 cameras fill the screen

    function loadViewMode() {
        try {
            var saved = window.localStorage.getItem(VIEW_KEY);
            if (VIEW_MODES.hasOwnProperty(saved)) {
                return saved;
            }
        } catch (e) {
            // Storage unavailable: use the default.
        }
        return '4';
    }

    function viewPer() {
        return VIEW_MODES[viewMode].cols * VIEW_MODES[viewMode].rows;
    }

    function pageOf(index) {
        return Math.floor(Math.max(0, index) / viewPer());
    }

    function updatePageLabel() {
        var pages = Math.max(1, Math.ceil(cameras.length / viewPer()));
        el.camPage.textContent = pages > 1 ? 'Page ' + (camPage + 1) + ' / ' + pages + '   (CH ▲▼)' : '';
    }

    // Size and place the tiles of the current page so they fill the area under the toolbar.
    function layoutTiles() {
        var mode = VIEW_MODES[viewMode];
        var scroller = el.camGrid.parentNode;
        var areaW = scroller.clientWidth || 1840;
        var areaH = scroller.clientHeight || 880;
        var cellW = Math.floor((areaW - TILE_GAP * (mode.cols - 1)) / mode.cols);
        var cellH = Math.floor((areaH - TILE_GAP * (mode.rows - 1)) / mode.rows);
        var thumbW = cellW - 8;
        var thumbH = Math.max(40, cellH - 8 - mode.info);
        // the picture is 16:9, as large as fits, centred in the tile
        var pictureH = Math.min(thumbH, Math.floor(thumbW * 9 / 16));
        var pictureW = Math.floor(pictureH * 16 / 9);
        tileGeo = {
            vw: pictureW,
            vh: pictureH,
            left: Math.floor((thumbW - pictureW) / 2),
            top: Math.floor((thumbH - pictureH) / 2)
        };
        var per = mode.cols * mode.rows;
        camTiles.forEach(function (tile, index) {
            var onPage = pageOf(index) === camPage;
            tile.style.display = onPage ? 'flex' : 'none';
            if (!onPage) {
                return;
            }
            var slot = index - camPage * per;
            tile.style.width = cellW + 'px';
            tile.style.height = cellH + 'px';
            tile.style.marginRight = ((slot % mode.cols) < mode.cols - 1 ? TILE_GAP : 0) + 'px';
            tile.style.marginBottom = (Math.floor(slot / mode.cols) < mode.rows - 1 ? TILE_GAP : 0) + 'px';
            tile.querySelector('.thumb').style.height = thumbH + 'px';
            tile.querySelector('.tile-info').style.height = mode.info + 'px';
        });
        el.camGrid.className = 'cam-grid v' + viewMode + (editMode ? ' editing' : '');
        updatePageLabel();
    }

    function cycleView() {
        viewMode = VIEW_ORDER[(VIEW_ORDER.indexOf(viewMode) + 1) % VIEW_ORDER.length];
        try {
            window.localStorage.setItem(VIEW_KEY, viewMode);
        } catch (e) {
            // Storage unavailable: the choice lasts until the app closes.
        }
        el.camView.textContent = 'View: ' + viewMode;
        camPage = pageOf(camTile);
        layoutTiles();
        applyCamFocus();
        startLiveTiles();
    }

    function changePage(direction) {
        var per = viewPer();
        var pages = Math.ceil(cameras.length / per);
        var next = camPage + direction;
        if (next < 0 || next >= pages) {
            return;
        }
        camZone = 'grid';
        camTile = Math.min(cameras.length - 1, next * per);
        afterFocusMove();
    }

    // After the focus moved: switch page if it left this one, then refresh the highlight and live tiles.
    function afterFocusMove() {
        var pageChanged = camZone === 'grid' && pageOf(camTile) !== camPage;
        if (pageChanged) {
            camPage = pageOf(camTile);
            layoutTiles();
        }
        applyCamFocus();
        if (pageChanged) {
            startLiveTiles();
        } else if (liveSetting === 'focus') {
            scheduleFocusLive();
        }
    }

    function applyCamFocus() {
        camTiles.forEach(function (tile, index) {
            tile.classList.toggle('focused', camZone === 'grid' && index === camTile);
        });
        el.camAdd.classList.toggle('focused', camZone === 'toolbar' && camToolbar === 0);
        el.camEdit.classList.toggle('focused', camZone === 'toolbar' && camToolbar === 1);
        el.camLive.classList.toggle('focused', camZone === 'toolbar' && camToolbar === 2);
        el.camView.classList.toggle('focused', camZone === 'toolbar' && camToolbar === 3);
        el.camAbout.classList.toggle('focused', camZone === 'toolbar' && camToolbar === 4);
    }

    function moveCameraFocus(dx, dy) {
        var count = cameras.length;
        var cols = VIEW_MODES[viewMode].cols;
        var rows = VIEW_MODES[viewMode].rows;
        var per = cols * rows;
        var slot = camTile - camPage * per;
        var row = Math.floor(slot / cols);
        if (camZone === 'toolbar') {
            if (dx) {
                camToolbar = Math.max(0, Math.min(4, camToolbar + dx));
            } else if (dy > 0 && count) {
                camZone = 'grid';
            }
        } else if (dx) {
            camTile = Math.max(0, Math.min(count - 1, camTile + dx));
        } else if (dy < 0) {
            if (row === 0) {
                camZone = 'toolbar';
                camToolbar = Math.min(3, slot % cols);
            } else {
                camTile -= cols;
            }
        } else if (dy > 0) {
            if (row === rows - 1) {
                if (camPage * per + per < count) {
                    camTile = camPage * per + per;   // bottom row: on to the next page
                }
            } else {
                camTile = Math.min(count - 1, camTile + cols);
            }
        }
        afterFocusMove();
    }

    function toggleEditMode() {
        editMode = !editMode;
        el.camGrid.classList.toggle('editing', editMode);
        el.camEdit.textContent = 'Manage cameras: ' + (editMode ? 'on' : 'off');
    }

    function activateCamera() {
        if (camZone === 'toolbar') {
            if (camToolbar === 0) {
                openEditor(null);
            } else if (camToolbar === 1) {
                toggleEditMode();
            } else if (camToolbar === 2) {
                cycleLive();
            } else if (camToolbar === 3) {
                cycleView();
            } else {
                openAbout();
            }
            return;
        }
        var cam = cameras[camTile];
        if (!cam) {
            return;
        }
        if (editMode) {
            openCameraMenu(camTile);
        } else {
            openPlayer(camTile);
        }
    }

    // ---- live video on the tiles
    //
    // The first N cameras (N = the Live view setting, lowered if the TV cannot decode that many)
    // each get a small muted player. FLV cameras are read directly; RTSP cameras (Eufy and
    // others) go through the relay, one slot per tile. They connect one after another. Leaving the
    // camera screen closes every tile stream, so the full-screen player has the camera to itself.

    function loadLiveSetting() {
        try {
            var saved = window.localStorage.getItem(LIVE_KEY);
            if (LIVE_CHOICES.indexOf(saved) >= 0) {
                return saved;
            }
        } catch (e) {
            // Storage unavailable: use the default.
        }
        return 'off';   // off until chosen: many TVs decode only one or two streams, and some crash when pushed
    }

    function liveLimit() {
        if (liveSetting === 'off') {
            return 0;
        }
        return liveSetting === 'focus' ? 1 : Math.min(parseInt(liveSetting, 10), decoderCap);
    }

    function cycleLive() {
        liveSetting = LIVE_CHOICES[(LIVE_CHOICES.indexOf(liveSetting) + 1) % LIVE_CHOICES.length];
        decoderCap = 99;
        try {
            window.localStorage.setItem(LIVE_KEY, liveSetting);
        } catch (e) {
            // Storage unavailable: the choice lasts until the app closes.
        }
        el.camLive.textContent = 'Live view: ' + liveSetting;
        el.camMessage.textContent = '';
        startLiveTiles();
    }

    function setThumbNote(tile, text) {
        var note = tile.querySelector('.thumb-note');
        if (note) {
            note.textContent = text;
        }
    }

    function tileSettings(cam) {
        var copy = cameraToSettings(cam);
        copy.stream = 'sub';   // tiles are small: the light stream is plenty
        return copy;
    }

    function releaseTilePlayer(entry) {
        clearTimeout(entry.watch);
        clearInterval(entry.poll);
        clearInterval(entry.stat);
        if (entry.tile && entry.tile.liveLine) {
            entry.tile.liveLine.textContent = '';
        }
        if (entry.player) {
            try {
                entry.player.pause();
                entry.player.unload();
                entry.player.detachMediaElement();
                entry.player.destroy();
            } catch (e) {
                // Ignore teardown errors.
            }
            entry.player = null;
        }
        if (entry.video) {
            releaseVideo(entry.video, entry.listeners);
            entry.video = null;
        }
        entry.live = false;
    }

    // One element per concurrent tile, created once and reused for every later stream.
    function acquireVideo() {
        var video = videoPool.pop();
        if (!video) {
            video = document.createElement('video');
            video.muted = true;
            video.defaultMuted = true;
            video.setAttribute('muted', '');
            video.setAttribute('playsinline', '');
            video.setAttribute('autoplay', '');
            video.className = 'snap';
        }
        return video;
    }

    function releaseVideo(video, listeners) {
        (listeners || []).forEach(function (pair) { video.removeEventListener(pair[0], pair[1]); });
        try {
            video.pause();
            video.removeAttribute('src');
            video.load();   // hand the TV's decoder back
        } catch (e) {
            // Ignore.
        }
        if (video.parentNode) {
            video.parentNode.removeChild(video);
        }
        videoPool.push(video);
    }

    // A flag in storage while tiles are running. Normal exits clear it; if it is still there at the
    // next launch the app died while playing tiles, so live view starts switched off.
    function setLiveGuard(on) {
        try {
            if (on) {
                window.localStorage.setItem(LIVE_GUARD_KEY, String(Date.now()));
            } else {
                window.localStorage.removeItem(LIVE_GUARD_KEY);
            }
        } catch (e) {
            // Storage unavailable: no guard.
        }
    }

    function checkLiveGuard() {
        var left = null;
        try {
            left = window.localStorage.getItem(LIVE_GUARD_KEY);
        } catch (e) {
            left = null;
        }
        if (left === null) {
            return;
        }
        setLiveGuard(false);
        if (liveSetting !== 'off') {
            liveSetting = 'off';
            try {
                window.localStorage.setItem(LIVE_KEY, liveSetting);
            } catch (e2) {
                // Ignore.
            }
            pendingNotice = 'The app closed while showing live tiles, so Live view is off. Choose Live view to try again.';
        }
    }

    function stopLiveTiles() {
        liveRun += 1;
        clearTimeout(focusTimer);
        var usedRelay = false;
        liveTiles.forEach(function (entry) {
            releaseTilePlayer(entry);
            if (entry.relay) {
                usedRelay = true;
            }
        });
        liveTiles = [];
        setLiveGuard(false);
        if (usedRelay) {
            relayRequest('POST', '/stop?tiles=1', {}, function () {});
        }
    }

    function startLiveTiles() {
        stopLiveTiles();
        var run = liveRun;
        if (!player) {
            try {
                el.video.removeAttribute('src');
                el.video.load();   // the idle full-screen video must not hold the TV's decoder
            } catch (e) {
                // Ignore.
            }
        }
        var limit = liveLimit();
        camTiles.forEach(function (tile, index) {
            tile.classList.remove('has-thumb');
            setThumbNote(tile, '');
        });
        if (currentView !== 'cameras' || !limit) {
            return;
        }
        var started = 0;
        var focusMode = liveSetting === 'focus';
        var focusIndex = camZone === 'grid' ? camTile : lastLiveIndex;
        if (pageOf(focusIndex) !== camPage) {
            focusIndex = camPage * viewPer();
        }
        camTiles.forEach(function (tile, index) {
            var cam = cameras[index];
            if (pageOf(index) !== camPage || !cam || !cam.host) {
                return;
            }
            if (focusMode ? index !== focusIndex : started >= limit) {
                setThumbNote(tile, focusMode ? 'Highlight to see live' : 'Not live · limit ' + limit);
                return;
            }
            setThumbNote(tile, 'Connecting…');
            // The first start waits a moment so the relay has processed the stop of the previous run.
            setTimeout(function () {
                if (run === liveRun) {
                    startLiveTile(run, index);
                }
            }, 300 + started * LIVE_START_GAP_MS);
            started += 1;
        });
    }

    function liveFail(entry, reason) {
        entry.failed = true;
        releaseTilePlayer(entry);
        if (entry.relay) {
            entry.relay = false;
            relayRequest('POST', '/stop?slot=' + entry.slot, {}, function () {});
        }
        entry.tile.classList.remove('has-thumb');
        setThumbNote(entry.tile, 'No live view · ' + reason);
    }

    // The TV could not decode one more stream: remember how many it managed.
    function liveDecoderLimit(entry) {
        var working = liveTiles.filter(function (other) { return other !== entry && other.live; }).length;
        liveFail(entry, 'TV decoder limit');
        if (working === 1) {
            switchToFocusMode();
        } else if (working > 1 && working < decoderCap) {
            decoderCap = working;
            el.camMessage.textContent = 'This TV shows ' + working + ' live views at once.';
        }
    }

    // The TV plays one video at a time: keep one live tile and let it follow the highlight.
    function switchToFocusMode() {
        liveSetting = 'focus';
        try {
            window.localStorage.setItem(LIVE_KEY, liveSetting);
        } catch (e) {
            // Storage unavailable: lasts until the app closes.
        }
        el.camLive.textContent = 'Live view: focus';
        el.camMessage.textContent = 'This TV plays one live video at a time: the highlighted camera is live.';
        camTiles.forEach(function (tile) {
            var live = liveTiles.some(function (e) { return e.tile === tile && e.live; });
            if (!live && !tile.classList.contains('has-thumb')) {
                setThumbNote(tile, 'Highlight to see live');
            }
        });
        scheduleFocusLive();
    }

    // Last picture of a tile that is about to stop being live, or null when the TV will not let us copy it.
    function captureStill(entry) {
        if (!KEEP_LAST_PICTURE) {
            return null;
        }
        try {
            var video = entry.video;
            if (!entry.live || !video || !video.videoWidth) {
                return null;
            }
            var canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = Math.max(1, Math.round(512 * video.videoHeight / video.videoWidth));
            var context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            // TVs often hand back an all-black copy of a hardware-decoded picture: do not keep that.
            var data = context.getImageData(0, 0, canvas.width, canvas.height).data;
            var lit = 0;
            for (var i = 0; i < data.length; i += 4 * 997) {
                if (data[i] + data[i + 1] + data[i + 2] > 30) {
                    lit += 1;
                }
            }
            return lit >= 3 ? canvas : null;
        } catch (e) {
            return null;
        }
    }

    function placeStill(tile, canvas) {
        var thumb = tile.querySelector('.thumb');
        var old = thumb.querySelector('.snap');
        if (old) {
            thumb.removeChild(old);
        }
        canvas.className = 'snap';
        thumb.insertBefore(canvas, thumb.firstChild);
        tile.classList.add('has-thumb');
        setThumbNote(tile, '');
        if (tile.liveLine) {
            tile.liveLine.textContent = '◐ last picture';
        }
    }

    function closeEntry(entry) {
        releaseTilePlayer(entry);
        if (entry.relay) {
            entry.relay = false;
            relayRequest('POST', '/stop?slot=' + entry.slot, {}, function () {});
        }
        entry.tile.classList.remove('has-thumb');
    }

    function scheduleFocusLive() {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(function () {
            if (currentView === 'cameras' && liveSetting === 'focus' && camZone === 'grid') {
                retargetLive(camTile);
            }
        }, FOCUS_DELAY_MS);
    }

    // Move the one live tile to another camera.
    function retargetLive(index) {
        var run = liveRun;
        var current = liveTiles[0];
        if (current && current.index === index && !current.failed) {
            return;
        }
        liveTiles.slice().forEach(function (entry) {
            var still = captureStill(entry);
            closeEntry(entry);
            if (still) {
                placeStill(entry.tile, still);
            } else {
                setThumbNote(entry.tile, 'Highlight to see live');
            }
        });
        liveTiles = [];
        var tile = camTiles[index];
        var cam = cameras[index];
        if (!tile || !cam || !cam.host) {
            return;
        }
        setThumbNote(tile, 'Connecting…');
        setTimeout(function () {
            if (run === liveRun && currentView === 'cameras' && liveSetting === 'focus' && !liveTiles.length) {
                startLiveTile(run, index);
            }
        }, FOCUS_HANDOVER_MS);
    }

    function startLiveTile(run, index) {
        var cam = cameras[index];
        var tile = camTiles[index];
        if (!cam || !tile) {
            return;
        }
        var entry = { tile: tile, index: index, slot: 't' + index, player: null, video: null, relay: false, live: false };
        liveTiles.push(entry);
        lastLiveIndex = index;
        setLiveGuard(true);
        if (cam.mode === 'rtsp') {
            startRelayTile(run, entry, cam);
        } else {
            attachTilePlayer(run, entry, buildStreamUrl(tileSettings(cam)), 'flv');
        }
    }

    function startRelayTile(run, entry, cam) {
        ensureRelay(function (err) {
            if (run !== liveRun) {
                return;
            }
            if (err) {
                liveFail(entry, 'relay not running');
                return;
            }
            relayRequest('POST', '/start', {
                slot: entry.slot,
                host: cam.host,
                port: parseInt(cam.rtspPort, 10) || 554,
                user: cam.user,
                pass: cam.password,
                channel: cam.channel,
                stream: 'sub',
                path: cam.rtspPath,
                audio: false
            }, function (err2, data) {
                if (run !== liveRun) {
                    return;
                }
                if (err2 || !data.ok) {
                    liveFail(entry, err2 ? 'relay not answering' : (data.error || 'relay refused'));
                    return;
                }
                if (data.slot !== entry.slot) {
                    liveFail(entry, 'restart the app to update the relay');
                    return;
                }
                entry.relay = true;
                waitForTileStream(run, entry, Date.now());
            });
        });
    }

    function waitForTileStream(run, entry, since) {
        relayRequest('GET', '/status?slot=' + entry.slot, null, function (err, st) {
            if (run !== liveRun || !entry.relay) {
                return;
            }
            if (err) {
                liveFail(entry, 'relay not answering');
                return;
            }
            if (st.state === 'error') {
                liveFail(entry, st.errorCode === 'auth' ? 'wrong login' : (st.errorCode === 'unreachable' ? 'unreachable' : 'camera error'));
                return;
            }
            if (st.state === 'playing') {
                var codec = st.video ? st.video.codec : '';
                if (!mseCanPlay(codec)) {
                    liveFail(entry, codec === 'H265' ? 'H.265 not supported here' : 'cannot decode');
                    return;
                }
                attachTilePlayer(run, entry, RELAY_BASE + '/live.ts?slot=' + entry.slot + '&t=' + Date.now(), 'mpegts');
                return;
            }
            if (Date.now() - since > LIVE_TIMEOUT_MS) {
                liveFail(entry, 'no video');
                return;
            }
            setTimeout(function () { waitForTileStream(run, entry, since); }, 500);
        });
    }

    // What the TV's video element is doing, for the note on a tile that never started.
    function describeTileVideo(video, playError) {
        var parts = ['state ' + video.readyState, video.videoWidth + 'x' + video.videoHeight];
        if (video.paused) {
            parts.push('paused');
        }
        if (video.error) {
            parts.push('media error ' + video.error.code);
        }
        if (playError) {
            parts.push(playError);
        }
        return parts.join(', ');
    }

    function markTileLive(entry) {
        if (entry.live) {
            return;
        }
        entry.live = true;
        clearInterval(entry.poll);
        entry.tile.classList.add('has-thumb');
        setThumbNote(entry.tile, '');
        // A line under the picture, outside the video area, so it is readable even if the TV
        // plays the video without drawing it: size and seconds played prove the stream runs.
        var showStats = function () {
            var video = entry.video;
            if (video && entry.tile.liveLine) {
                entry.tile.liveLine.textContent = '● live ' + video.videoWidth + 'x' + video.videoHeight +
                    ' · ' + Math.round(video.currentTime || 0) + ' s';
            }
        };
        showStats();
        entry.stat = setInterval(showStats, 1000);
    }

    function attachTilePlayer(run, entry, url, type) {
        if (!window.mpegts || !window.mpegts.isSupported()) {
            liveFail(entry, 'no stream support');
            return;
        }
        try {
            var video = acquireVideo();
            if (tileGeo) {
                video.style.left = tileGeo.left + 'px';
                video.style.top = tileGeo.top + 'px';
                video.style.width = tileGeo.vw + 'px';
                video.style.height = tileGeo.vh + 'px';
            }
            var thumb = entry.tile.querySelector('.thumb');
            var old = thumb.querySelector('.snap');
            if (old) {
                thumb.removeChild(old);
            }
            thumb.insertBefore(video, thumb.firstChild);
            entry.video = video;
            entry.playError = '';
            entry.pausedSince = 0;
            entry.startedAt = Date.now();
            entry.player = window.mpegts.createPlayer({
                type: type,
                isLive: true,
                url: url,
                hasVideo: true,
                hasAudio: false
            }, MPEGTS_CONFIG);
            entry.player.attachMediaElement(video);
            entry.player.on(window.mpegts.Events.ERROR, function (errType, errDetail) {
                if (run !== liveRun || entry.video !== video) {
                    return;
                }
                if (errType === 'MediaError') {
                    liveDecoderLimit(entry);
                } else {
                    liveFail(entry, 'stream error (' + errType + (errDetail ? ': ' + errDetail : '') + ')');
                }
            });
            var onVideoError = function () {
                if (run === liveRun && entry.video === video) {
                    liveFail(entry, 'video error ' + (video.error ? video.error.code : '?'));
                }
            };
            var onVideoPlaying = function () {
                if (run === liveRun && entry.video === video) {
                    markTileLive(entry);
                }
            };
            video.addEventListener('error', onVideoError);
            video.addEventListener('playing', onVideoPlaying);
            entry.listeners = [['error', onVideoError], ['playing', onVideoPlaying]];

            var tryPlay = function () {
                if (!entry.player) {
                    return;
                }
                var promise = entry.player.play();
                if (promise && typeof promise.catch === 'function') {
                    promise.catch(function (err) {
                        entry.playError = 'play refused: ' + (err && err.name ? err.name : err);
                    });
                }
            };
            entry.player.load();
            tryPlay();

            // Do not wait for one particular event: a picture is a picture. If frames are there
            // but the TV left the video paused, ask again, and only give up after a few seconds.
            entry.poll = setInterval(function () {
                if (run !== liveRun || entry.video !== video) {
                    clearInterval(entry.poll);
                    return;
                }
                var hasFrame = video.readyState >= 2 && video.videoWidth > 0;
                if (hasFrame && !video.paused) {
                    markTileLive(entry);
                    return;
                }
                // Size known but no picture, while another tile plays: the TV has no decoder left.
                if (!hasFrame && video.readyState === 1 && video.videoWidth > 0 &&
                        Date.now() - entry.startedAt > TILE_STALL_MS &&
                        liveTiles.some(function (other) { return other !== entry && other.live; })) {
                    liveDecoderLimit(entry);
                    return;
                }
                if (video.paused && (video.readyState >= 1 || entry.playError)) {
                    tryPlay();   // the TV said no, or the stream arrived paused: ask again
                }
                if (hasFrame && video.paused) {
                    entry.pausedSince = entry.pausedSince || Date.now();
                    if (Date.now() - entry.pausedSince > TILE_PAUSED_LIMIT_MS) {
                        liveFail(entry, 'TV would not start playback' + (entry.playError ? ' (' + entry.playError + ')' : ''));
                    }
                } else {
                    entry.pausedSince = 0;
                }
            }, 400);
            entry.watch = setTimeout(function () {
                if (run === liveRun && !entry.live) {
                    liveFail(entry, 'no picture (' + describeTileVideo(video, entry.playError) + ')');
                }
            }, LIVE_TIMEOUT_MS);
        } catch (e) {
            liveFail(entry, 'player error: ' + (e && e.message ? e.message : e));
        }
    }

    // ---- watching a saved camera

    function updateNowPlaying() {
        var many = cameras.length > 1;
        el.nowPlaying.textContent = cameraLabel(settings) +
            (many ? '  (' + (playingIndex + 1) + ' / ' + cameras.length + ')' : '');
        el.playerKeys.innerHTML = many
            ? 'OK info &nbsp; CH ▲▼ camera &nbsp; RETURN cameras'
            : 'OK info &nbsp; CH ▲▼ channel &nbsp; RETURN cameras';
    }

    function openPlayer(index) {
        var cam = cameras[index];
        if (!cam) {
            return;
        }
        playingIndex = index;
        settings = cameraToSettings(cam);
        var problem = validateSettings();
        if (problem) {
            openEditor(cam);
            showSetupMessage(problem);
            return;
        }
        mseFailedForRelay = false;
        reconnectAttempt = 0;
        updateNowPlaying();
        showView('player');
        startPlayer();
    }

    // CH up / down: next or previous saved camera (or the NVR channel, when there is only one camera).
    function switchCamera(direction) {
        var count = cameras.length;
        if (count < 2) {
            changeChannel(direction);
            return;
        }
        clearTimeout(reconnectTimer);
        destroyPlayer();   // frees the relay session before the next camera connects
        playingIndex = (playingIndex + direction + count) % count;
        settings = cameraToSettings(cameras[playingIndex]);
        camTile = playingIndex;
        mseFailedForRelay = false;
        reconnectAttempt = 0;
        updateNowPlaying();
        startPlayer();
    }

    // ------------------------------------------------------------------ status overlay

    function setStatus(text, isError) {
        el.status.textContent = text;
        el.status.classList.toggle('error', !!isError);
        showOverlay(!isError);
    }

    function showOverlay(autoHide) {
        el.overlay.classList.remove('faded');
        clearTimeout(overlayTimer);
        if (autoHide) {
            overlayTimer = setTimeout(function () {
                el.overlay.classList.add('faded');
            }, OVERLAY_HIDE_MS);
        }
    }

    function toggleOverlay() {
        if (el.overlay.classList.contains('faded')) {
            showOverlay(true);
        } else {
            el.overlay.classList.add('faded');
        }
    }

    function describeMediaInfo(info) {
        if (!info) {
            return '';
        }
        var parts = [];
        if (info.videoCodec) {
            parts.push(info.videoCodec);
        }
        if (info.width && info.height) {
            parts.push(info.width + 'x' + info.height);
        }
        if (info.fps) {
            parts.push(Math.round(info.fps) + ' fps');
        }
        if (info.audioCodec) {
            parts.push(info.audioCodec);
        }
        return parts.join('  ·  ');
    }

    function bufferLag() {
        if (!el.video.buffered.length) {
            return '';
        }
        var lag = el.video.buffered.end(el.video.buffered.length - 1) - el.video.currentTime;
        return '  ·  buffer ' + lag.toFixed(1) + 's';
    }

    // ------------------------------------------------------------------ codec support

    // Can this TV's browser decode the codec through Media Source Extensions?
    function mseCanPlay(codec) {
        if (!window.MediaSource || !window.mpegts || !window.mpegts.isSupported()) {
            return false;
        }
        var types = codec === 'H265'
            ? ['video/mp4; codecs="hvc1.1.6.L153.B0"', 'video/mp4; codecs="hev1.1.6.L153.B0"']
            : ['video/mp4; codecs="avc1.640028"'];
        for (var i = 0; i < types.length; i++) {
            try {
                if (window.MediaSource.isTypeSupported(types[i])) {
                    return true;
                }
            } catch (e) {
                // Fall through: treat as unsupported.
            }
        }
        return false;
    }

    // ------------------------------------------------------------------ mpegts.js (FLV and relay TS)

    function onMediaInfo(info) {
        lastMediaInfo = info;
        if (activeBackend === 'flv' && /hevc|hvc1|hev1|h265/i.test(info.videoCodec || '') && !mseCanPlay('H265')) {
            setStatus('This stream is H.265 and the TV\'s browser cannot decode it. Switch Connection to RTSP, choose the Sub stream, or set the camera\'s main stream to H.264.', true);
        }
    }

    function onStatistics(stats) {
        if (activeBackend !== 'flv') {
            return;   // relay modes render their stats from the relay's status
        }
        var speed = stats.speed ? (stats.speed / 1024).toFixed(2) + ' MB/s' : '';
        var dropped = stats.droppedFrames ? '  ·  dropped ' + stats.droppedFrames : '';
        el.stats.textContent = describeMediaInfo(lastMediaInfo) +
            (speed ? '\n' + speed : '') + dropped + bufferLag() +
            '\n' + maskPassword(buildStreamUrl(settings));
    }

    function explainError(type, detail, info) {
        var message = (info && info.msg) ? info.msg : '';
        if (type === 'NetworkError') {
            if (activeBackend === 'mse') {
                return 'The relay stream dropped.';
            }
            if (/40[13]/.test(message) || (info && (info.code === 401 || info.code === 403))) {
                return 'Login rejected. Check the username and password.';
            }
            if (info && info.code === 404) {
                return 'Camera reachable but no FLV stream at that URL. Check the channel number and that the firmware supports FLV.';
            }
            return 'Cannot reach the camera at ' + settings.host +
                (settings.port !== '80' ? ':' + settings.port : '') + '. Check the IP, port and that the TV is on the same network.';
        }
        if (type === 'MediaError') {
            if (/codec|not supported|unsupported/i.test(message + ' ' + detail)) {
                return activeBackend === 'mse'
                    ? 'The browser player cannot decode this stream. Set Player to TV player (AVPlay).'
                    : 'The TV cannot decode this stream. Switch Connection to RTSP, use the Sub stream, or set the camera to H.264.';
            }
            return 'Playback error: ' + (detail || message);
        }
        return 'Error: ' + type + ' ' + (detail || '') + ' ' + message;
    }

    function onPlayerError(type, detail, info) {
        if (activeBackend === 'mse' && type === 'MediaError' && settings.rtspPlayer === 'auto' && !mseFailedForRelay) {
            switchToAvPlay();
            return;
        }
        scheduleReconnect(explainError(type, detail, info));
    }

    function startMsePlayer(url, type, hasAudio) {
        if (!window.mpegts || !window.mpegts.isSupported()) {
            setStatus('This TV does not support Media Source Extensions. ' +
                (settings.mode === 'rtsp' ? 'Set Player to TV player (AVPlay).' : 'Switch Connection to RTSP and Player to TV player.'), true);
            return;
        }
        player = window.mpegts.createPlayer({
            type: type,
            isLive: true,
            url: url,
            hasVideo: true,
            hasAudio: hasAudio
        }, MPEGTS_CONFIG);

        player.attachMediaElement(el.video);
        player.on(window.mpegts.Events.ERROR, onPlayerError);
        player.on(window.mpegts.Events.MEDIA_INFO, onMediaInfo);
        player.on(window.mpegts.Events.STATISTICS_INFO, onStatistics);
        player.on(window.mpegts.Events.LOADING_COMPLETE, function () {
            scheduleReconnect(activeBackend === 'mse' ? 'The relay closed the stream.' : 'The camera closed the stream.');
        });

        player.load();
        var playPromise = player.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(function (err) {
                setStatus('Playback could not start: ' + (err && err.message ? err.message : err), true);
            });
        }
    }

    function startFlvPlayback() {
        activeBackend = 'flv';
        var url = buildStreamUrl(settings);
        setStatus('Connecting to ' + settings.host + ' (channel ' + settings.channel + ', ' + settings.stream + ' stream)…');
        el.stats.textContent = maskPassword(url);
        startMsePlayer(url, 'flv', settings.audio === 'on');
    }

    function destroyMsePlayer() {
        if (!player) {
            return;
        }
        try {
            player.pause();
            player.unload();
            player.detachMediaElement();
            player.destroy();
        } catch (e) {
            // Ignore teardown errors; a fresh player is created on the next start.
        }
        player = null;
    }

    // ------------------------------------------------------------------ relay service (RTSP mode)

    function relayRequest(method, path, body, cb) {
        var xhr = new XMLHttpRequest();
        xhr.open(method, RELAY_BASE + path, true);
        xhr.timeout = 4000;
        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) {
                return;
            }
            if (xhr.status === 0) {
                cb(new Error('relay unreachable'));
                return;
            }
            var data = null;
            try {
                data = JSON.parse(xhr.responseText);
            } catch (e) {
                data = null;
            }
            cb(null, data || {}, xhr.status);
        };
        xhr.ontimeout = function () {
            cb(new Error('relay timeout'));
        };
        if (body) {
            xhr.setRequestHeader('Content-Type', 'application/json');
            xhr.send(JSON.stringify(body));
        } else {
            xhr.send();
        }
    }

    function relayServiceId() {
        try {
            var info = window.tizen.application.getCurrentApplication().appInfo;
            return (info.packageId || info.id.split('.')[0]) + '.relay';
        } catch (e) {
            return null;   // desktop browser: run `node service/relay.js` by hand
        }
    }

    function launchRelayService(cb) {
        var id = relayServiceId();
        if (!id) {
            cb(null);
            return;
        }
        try {
            window.tizen.application.launch(id, function () { cb(null); }, function (e) { cb(e); });
        } catch (e) {
            cb(e);
        }
    }

    // Make sure the relay answers; launch it if it is not running yet.
    function ensureRelay(cb) {
        relayRequest('GET', '/ping', null, function (err, data) {
            if (!err && data.ok) {
                cb(null);
                return;
            }
            launchRelayService(function (launchErr) {
                var tries = 0;
                (function poll() {
                    relayRequest('GET', '/ping', null, function (err2, data2) {
                        if (!err2 && data2.ok) {
                            cb(null);
                            return;
                        }
                        if (++tries >= RELAY_LAUNCH_TRIES) {
                            var name = launchErr ? String(launchErr.name || launchErr.message || '') : '';
                            if (/NotFound/i.test(name)) {
                                cb(new Error('RTSP mode needs the full package (RTSPViewer.wgt, 2018 and newer TVs). This installation has no relay service.'));
                            } else {
                                cb(new Error('The relay service did not start' + (name ? ' (' + name + ')' : '') + '.'));
                            }
                            return;
                        }
                        setTimeout(poll, 300);
                    });
                }());
            });
        });
    }

    function stopRelaySession() {
        clearInterval(relayPollTimer);
        if (relaySessionId) {
            relaySessionId = null;
            relayRequest('POST', '/stop', {}, function () {});
        }
    }

    function explainRelayError(st) {
        var code = st.errorCode;
        if (code === 'auth') {
            return 'Login rejected by the camera. Check the username and password.';
        }
        if (code === 'unreachable') {
            return 'Cannot reach ' + settings.host + ':' + (settings.rtspPort || '554') +
                ' over RTSP. Check the IP, and that RTSP is enabled on the camera (Network → Advanced → Port Settings).';
        }
        if (code === 'notfound') {
            return 'No stream at the known RTSP paths. Check the channel number, or fill in the RTSP path.';
        }
        if (code === 'busy') {
            return 'The camera refused: too many viewers. Close the camera app elsewhere and try again.';
        }
        return st.error || 'Relay error.';
    }

    function startRelayPlayback(token) {
        activeBackend = null;
        lastRelayStatus = null;
        setStatus('Starting the RTSP relay…');
        el.stats.textContent = '';
        ensureRelay(function (err) {
            if (token !== startToken) {
                return;
            }
            if (err) {
                scheduleReconnect(err.message);
                return;
            }
            relayRequest('POST', '/start', {
                host: settings.host,
                port: parseInt(settings.rtspPort, 10) || 554,
                user: settings.user,
                pass: settings.password,
                channel: settings.channel,
                stream: settings.stream,
                path: settings.rtspPath,
                audio: settings.audio === 'on'
            }, function (err2, data) {
                if (token !== startToken) {
                    return;
                }
                if (err2 || !data.ok) {
                    scheduleReconnect('The relay could not start: ' + (err2 ? err2.message : data.error));
                    return;
                }
                relaySessionId = data.id;
                setStatus('Connecting to ' + settings.host + ' over RTSP…');
                el.stats.textContent = data.url || '';
                waitForRelay(token, Date.now());
            });
        });
    }

    // Poll until the relay has video (first keyframe), then pick a player.
    function waitForRelay(token, since) {
        relayRequest('GET', '/status', null, function (err, st) {
            if (token !== startToken) {
                return;
            }
            if (err) {
                scheduleReconnect('Lost contact with the relay.');
                return;
            }
            if (st.state === 'error') {
                scheduleReconnect(explainRelayError(st));
                return;
            }
            if (st.state === 'playing') {
                chooseRelayPlayer(token, st);
                return;
            }
            if (Date.now() - since > RELAY_START_TIMEOUT_MS) {
                scheduleReconnect('The relay got no video from the camera.' + (st.note ? ' ' + st.note + '.' : ''));
                return;
            }
            if (st.state === 'waiting') {
                setStatus('Connected. Waiting for the first keyframe…');
            }
            setTimeout(function () { waitForRelay(token, since); }, 500);
        });
    }

    function chooseRelayPlayer(token, st) {
        var codec = st.video ? st.video.codec : '';
        var choice = settings.rtspPlayer;
        if (choice === 'auto') {
            choice = (!mseFailedForRelay && mseCanPlay(codec)) ? 'mse' : 'avplay';
        }
        lastRelayStatus = st;
        if (choice === 'mse') {
            activeBackend = 'mse';
            setStatus('Opening the browser player (' + (codec === 'H265' ? 'H.265' : 'H.264') + ')…');
            startMsePlayer(RELAY_BASE + '/live.ts?t=' + Date.now(), 'mpegts', !!st.audio);
            startRelayPolling(token);
        } else {
            activeBackend = 'avplay';
            waitForSegments(token, Date.now());
        }
    }

    // MSE gave up on the relay stream mid-way: keep the relay session, hand the
    // stream to AVPlay instead.
    function switchToAvPlay() {
        mseFailedForRelay = true;
        startToken += 1;
        var token = startToken;
        clearInterval(relayPollTimer);
        destroyMsePlayer();
        setStatus('The browser player cannot decode this stream. Switching to the TV player…');
        activeBackend = 'avplay';
        waitForSegments(token, Date.now());
    }

    function waitForSegments(token, since) {
        relayRequest('GET', '/status', null, function (err, st) {
            if (token !== startToken) {
                return;
            }
            if (err) {
                scheduleReconnect('Lost contact with the relay.');
                return;
            }
            if (st.state === 'error') {
                scheduleReconnect(explainRelayError(st));
                return;
            }
            if (st.segments >= HLS_MIN_SEGMENTS) {
                startAvPlayer(token, RELAY_BASE + '/live.m3u8');
                return;
            }
            setStatus('Buffering for the TV player (' + st.segments + '/' + HLS_MIN_SEGMENTS + ')…');
            if (Date.now() - since > 30000) {
                scheduleReconnect('The relay did not produce enough video for the TV player.');
                return;
            }
            setTimeout(function () { waitForSegments(token, since); }, 500);
        });
    }

    // ------------------------------------------------------------------ AVPlay (HLS from the relay)

    function startAvPlayer(token, url) {
        var av = window.webapis && window.webapis.avplay;
        if (!av) {
            scheduleReconnect('AVPlay is not available on this TV. Set Player to Browser (MSE).');
            return;
        }
        try {
            av.open(url);
            av.setDisplayRect(0, 0, window.innerWidth || 1920, window.innerHeight || 1080);
            try {
                av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
            } catch (e) {
                // Older firmware: default display method is fine.
            }
            av.setListener({
                onbufferingstart: function () { setStatus('Buffering…'); },
                onbufferingprogress: function () {},
                onbufferingcomplete: function () { reconnectAttempt = 0; setStatus('Live'); },
                oncurrentplaytime: function () {},
                onstreamcompleted: function () { scheduleReconnect('The stream ended.'); },
                onevent: function () {},
                onerror: function (e) { scheduleReconnect('TV player error: ' + e); },
                ondrmevent: function () {},
                onsubtitlechange: function () {}
            });
            avplayActive = true;
            avplayPaused = false;
            document.body.classList.add('avplay');
            el.video.classList.add('hidden');
            el.avObject.classList.remove('hidden');
            setStatus('Opening the TV player…');
            av.prepareAsync(function () {
                if (token !== startToken) {
                    return;
                }
                try {
                    av.play();
                } catch (e) {
                    scheduleReconnect('TV player could not start: ' + (e.message || e));
                    return;
                }
                reconnectAttempt = 0;
                setStatus('Live');
            }, function (e) {
                if (token !== startToken) {
                    return;
                }
                scheduleReconnect('TV player could not open the stream: ' + (e && e.message ? e.message : e));
            });
            startRelayPolling(token);
        } catch (e) {
            scheduleReconnect('TV player error: ' + (e.message || e));
        }
    }

    function stopAvPlayer() {
        if (avplayActive) {
            try { window.webapis.avplay.stop(); } catch (e) { /* already stopped */ }
            try { window.webapis.avplay.close(); } catch (e2) { /* already closed */ }
        }
        avplayActive = false;
        avplayPaused = false;
        document.body.classList.remove('avplay');
        el.video.classList.remove('hidden');
        el.avObject.classList.add('hidden');
    }

    // ------------------------------------------------------------------ relay status polling

    function startRelayPolling(token) {
        clearInterval(relayPollTimer);
        relayPollTimer = setInterval(function () {
            if (token !== startToken) {
                clearInterval(relayPollTimer);
                return;
            }
            relayRequest('GET', '/status', null, function (err, st) {
                if (token !== startToken) {
                    return;
                }
                if (err) {
                    scheduleReconnect('Lost contact with the relay.');
                    return;
                }
                if (st.state === 'error') {
                    scheduleReconnect(explainRelayError(st));
                    return;
                }
                if (st.state === 'stopped' || st.state === 'idle' || (relaySessionId && st.id !== relaySessionId)) {
                    scheduleReconnect('The relay stopped the stream.');
                    return;
                }
                lastRelayStatus = st;
                renderRelayStats(st);
            });
        }, RELAY_POLL_MS);
    }

    function renderRelayStats(st) {
        var parts = [];
        if (st.video) {
            parts.push(st.video.codec === 'H265' ? 'H.265' : 'H.264');
        }
        if (activeBackend === 'mse' && lastMediaInfo && lastMediaInfo.width) {
            parts.push(lastMediaInfo.width + 'x' + lastMediaInfo.height);
        }
        if (st.fps) {
            parts.push(st.fps + ' fps');
        }
        if (st.audio) {
            parts.push('AAC');
        } else if (st.note) {
            parts.push(st.note);
        }
        parts.push(activeBackend === 'avplay' ? 'TV player (HLS)' : 'browser player (MSE)');
        var line2 = st.kbps ? (st.kbps / 1000).toFixed(1) + ' Mbit/s' : '';
        if (st.rtpLost) {
            line2 += '  ·  RTP loss ' + st.rtpLost;
        }
        if (activeBackend === 'mse') {
            line2 += bufferLag();
        }
        el.stats.textContent = parts.join('  ·  ') + (line2 ? '\n' + line2 : '') + '\n' + (st.url || '');
    }

    // ------------------------------------------------------------------ player lifecycle

    function startPlayer() {
        clearTimeout(reconnectTimer);
        startToken += 1;
        clearInterval(relayPollTimer);
        destroyMsePlayer();
        stopAvPlayer();
        lastMediaInfo = null;
        if (settings.mode === 'rtsp') {
            startRelayPlayback(startToken);
        } else {
            startFlvPlayback();
        }
    }

    // Stop everything, including the relay session so the camera's viewer slot is freed.
    function destroyPlayer() {
        startToken += 1;
        destroyMsePlayer();
        stopAvPlayer();
        stopRelaySession();
        activeBackend = null;
    }

    function scheduleReconnect(reason) {
        destroyPlayer();
        reconnectAttempt += 1;
        var delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, reconnectAttempt - 1));
        var remaining = Math.round(delay / 1000);
        setStatus(reason + '  Retrying in ' + remaining + 's (attempt ' + reconnectAttempt + '). Press RETURN to go back.', true);

        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function () {
            if (currentView === 'player') {
                startPlayer();
            }
        }, delay);
    }

    function stopAndReturnToList() {
        clearTimeout(reconnectTimer);
        reconnectAttempt = 0;
        destroyPlayer();
        showCameras();
    }

    // Only one camera saved: CH up / down steps the NVR channel, and the camera remembers it.
    function changeChannel(direction) {
        var row = el.form.querySelector('[data-field="channel"]');
        stepValue(row, direction);
        if (cameras[playingIndex]) {
            cameras[playingIndex].channel = settings.channel;
            saveCameras();
        }
        reconnectAttempt = 0;
        startPlayer();
    }

    function togglePlayPause() {
        if (activeBackend === 'avplay') {
            if (avplayPaused) {
                reconnectAttempt = 0;
                startPlayer();
            } else {
                try { window.webapis.avplay.pause(); } catch (e) { /* ignore */ }
                avplayPaused = true;
                setStatus('Paused');
            }
            return;
        }
        if (!player) {
            return;
        }
        if (el.video.paused) {
            // Resuming a live stream from a stale buffer is pointless: reconnect to the live edge.
            reconnectAttempt = 0;
            startPlayer();
        } else {
            player.pause();
            setStatus('Paused');
        }
    }

    // ------------------------------------------------------------------ video element events

    el.video.addEventListener('playing', function () {
        reconnectAttempt = 0;
        setStatus('Live');
    });
    el.video.addEventListener('waiting', function () {
        if (activeBackend !== 'avplay') {
            setStatus('Buffering…');
        }
    });
    el.video.addEventListener('error', function () {
        if (activeBackend === 'avplay') {
            return;
        }
        var err = el.video.error;
        if (activeBackend === 'mse' && settings.rtspPlayer === 'auto' && !mseFailedForRelay && err && err.code === 3) {
            switchToAvPlay();   // MEDIA_ERR_DECODE
            return;
        }
        scheduleReconnect('Video element error' + (err ? ' (code ' + err.code + ')' : '') + '.');
    });

    // ------------------------------------------------------------------ input handling

    function handleSetupKey(event) {
        var active = document.activeElement;
        var editing = active && active.tagName === 'INPUT';

        if (editing) {
            // The on-screen keyboard owns arrow keys. Enter / Return closes it.
            if (event.keyCode === KEY.ENTER || event.keyCode === KEY.RETURN) {
                commitInput(active);
                active.blur();
                event.preventDefault();
            }
            return;
        }

        if (deleteArmed && !(event.keyCode === KEY.ENTER && focusedRow.getAttribute('data-action') === 'delete')) {
            disarmDelete();
        }

        switch (event.keyCode) {
            case KEY.UP:
                moveFocus(-1);
                break;
            case KEY.DOWN:
                moveFocus(1);
                break;
            case KEY.LEFT:
                adjustRow(focusedRow, -1);
                break;
            case KEY.RIGHT:
                adjustRow(focusedRow, 1);
                break;
            case KEY.ENTER:
                activateRow(focusedRow);
                break;
            case KEY.RETURN:
                cancelEditor();
                break;
            case KEY.EXIT:
                exitApp();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    function handleCameraKey(event) {
        if (menu) {
            handleMenuKey(event);
            return;
        }
        if (moveState) {
            handleMoveKey(event);
            return;
        }
        switch (event.keyCode) {
            case KEY.LEFT:
                moveCameraFocus(-1, 0);
                break;
            case KEY.RIGHT:
                moveCameraFocus(1, 0);
                break;
            case KEY.UP:
                moveCameraFocus(0, -1);
                break;
            case KEY.DOWN:
                moveCameraFocus(0, 1);
                break;
            case KEY.ENTER:
                activateCamera();
                break;
            case KEY.CH_UP:
                changePage(1);
                break;
            case KEY.CH_DOWN:
                changePage(-1);
                break;
            case KEY.BLUE:
                openAbout();
                break;
            case KEY.GREEN:
                openEditor(null);
                break;
            case KEY.YELLOW:
                if (camZone === 'grid' && cameras[camTile]) {
                    openEditor(cameras[camTile]);
                } else {
                    toggleEditMode();
                }
                break;
            case KEY.RETURN:
            case KEY.EXIT:
                exitApp();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    function handlePlayerKey(event) {
        switch (event.keyCode) {
            case KEY.RETURN:
                stopAndReturnToList();
                break;
            case KEY.EXIT:
                exitApp();
                break;
            case KEY.ENTER:
                toggleOverlay();
                break;
            case KEY.CH_UP:
            case KEY.UP:
                switchCamera(1);
                break;
            case KEY.CH_DOWN:
            case KEY.DOWN:
                switchCamera(-1);
                break;
            case KEY.PLAY_PAUSE:
            case KEY.PLAY:
            case KEY.PAUSE:
                togglePlayPause();
                break;
            case KEY.STOP:
                stopAndReturnToList();
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    document.addEventListener('keydown', function (event) {
        // A held key repeats keydown: one press must never act twice.
        if (event.keyCode === KEY.ENTER && (event.repeat || (enterDown && Date.now() - enterDownAt < 3000))) {
            event.preventDefault();
            return;
        }
        // On a camera tile OK is "tap = watch, hold = options": decided on release, or when the hold time is up.
        // Until the TV has delivered any key release, OK keeps acting at once, so nothing can get stuck.
        if (event.keyCode === KEY.ENTER && keyupSeen && currentView === 'cameras' && !menu && !moveState &&
                !editMode && camZone === 'grid' && cameras[camTile]) {
            event.preventDefault();
            enterDown = true;
            enterDownAt = Date.now();
            holdFired = false;
            clearTimeout(holdTimer);
            holdTimer = setTimeout(function () {
                if (enterDown && currentView === 'cameras' && !menu && !moveState && cameras[camTile]) {
                    holdFired = true;
                    openCameraMenu(camTile);
                }
            }, HOLD_MS);
            return;
        }
        if (currentView === 'player') {
            handlePlayerKey(event);
        } else if (currentView === 'about') {
            handleAboutKey(event);
        } else if (currentView === 'cameras') {
            handleCameraKey(event);
        } else {
            handleSetupKey(event);
        }
    });

    document.addEventListener('keyup', function (event) {
        keyupSeen = true;
        if (event.keyCode !== KEY.ENTER || !enterDown) {
            return;
        }
        enterDown = false;
        clearTimeout(holdTimer);
        var wasHold = holdFired;
        holdFired = false;
        event.preventDefault();
        if (!wasHold && currentView === 'cameras' && !menu && !moveState) {
            activateCamera();
        }
    });

    // Mouse / pointer support (Tizen pointer remote, or a desktop browser during development).
    rows.forEach(function (row) {
        row.addEventListener('click', function (event) {
            setFocus(row);
            if (event.target.tagName !== 'INPUT') {
                activateRow(row);
            }
        });
    });
    Array.prototype.slice.call(el.form.querySelectorAll('input')).forEach(function (input) {
        input.addEventListener('blur', function () {
            commitInput(input);
        });
    });
    el.camAdd.addEventListener('click', function () { openEditor(null); });
    el.camEdit.addEventListener('click', toggleEditMode);
    el.camLive.addEventListener('click', cycleLive);
    el.showPass.addEventListener('click', function (event) {
        event.stopPropagation();   // ticking the box must not also start editing the password
        toggleShowPassword();
    });
    el.camView.addEventListener('click', cycleView);
    el.camAbout.addEventListener('click', openAbout);
    el.about.addEventListener('click', showCameras);
    el.overlay.addEventListener('click', toggleOverlay);
    el.video.addEventListener('click', toggleOverlay);

    function registerTvKeys() {
        try {
            ['MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop', 'ChannelUp', 'ChannelDown', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue']
                .forEach(function (name) {
                    window.tizen.tvinputdevice.registerKey(name);
                });
        } catch (e) {
            // Not on a Tizen TV; the standard keys still work.
        }
    }

    // Free the decoder (and the camera's viewer slot) when the app goes to the
    // background; reconnect when it comes back.
    window.addEventListener('pagehide', function () { setLiveGuard(false); });

    document.addEventListener('visibilitychange', function () {
        if (currentView === 'cameras') {
            if (document.hidden) {
                stopLiveTiles();
            } else {
                startLiveTiles();
            }
            return;
        }
        if (currentView !== 'player') {
            return;
        }
        if (document.hidden) {
            clearTimeout(reconnectTimer);
            destroyPlayer();
        } else {
            reconnectAttempt = 0;
            startPlayer();
        }
    });

    // ------------------------------------------------------------------ boot

    registerTvKeys();
    checkLiveGuard();
    initVault(function () {
        loadCameras(function (list, info) {
            cameras = list;
            if (info.resave) {
                saveCameras();   // plain-text logins from before encryption: store them encrypted now
            }
            if (info.unreadable) {
                pendingNotice = 'Saved logins could not be read on this TV. Edit the cameras and enter the username and password again.';
            } else if (!pendingNotice && !vault.encrypted && cameras.length) {
                pendingNotice = 'This TV cannot encrypt saved logins, so they are stored as plain text.';
            }
            showCameras();
            document.body.classList.add('ready');   // start-up is done (the screen tests wait for this)

            // A camera set to connect on launch goes straight to its picture; RETURN then lands on the list.
            var autoIndex = -1;
            cameras.forEach(function (cam, index) {
                if (autoIndex < 0 && cam.autoconnect === 'on' && cam.host) {
                    autoIndex = index;
                }
            });
            if (autoIndex >= 0) {
                camTile = autoIndex;
                openPlayer(autoIndex);
            }
        });
    });
}());
