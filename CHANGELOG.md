# Changelog

## 1.0.0

First release of RTSP Viewer by Pardeep
([project page](https://github.com/PardeepChahal7/RTSP-Viewer)), built on
[Apps2Samsung/ReolinkViewer](https://github.com/Apps2Samsung/ReolinkViewer).

- RTSP is the default connection (HTTP-FLV is still there; the legacy package,
  which has no relay, starts new cameras as HTTP-FLV).
- Hold OK on a camera tile for its options: edit, move (through the list, across
  pages) or remove.
- Camera user names and passwords are encrypted (AES-256-GCM, non-extractable
  key) before they are stored; TVs that cannot do this say so.
- **Show** checkbox next to the password field on the add / edit screen.
- About screen (button in the toolbar, or the Blue key) with the version, the
  project page and a QR code for it, credits and tips; the app icon sits next to
  the title on the main screen.
- Screenshots of the screens in the README (`docs/screenshots/`, retaken with `tools/make_screenshots.py`).
- Save, edit, move and delete any number of cameras.
- NVR-style main screen with **View: 2 / 4 / 8 / 16**, filling the screen, with
  pages for more cameras (CH ▲ / ▼).
- Open a camera full screen and flip through the saved cameras with CH ▲ / ▼.
- RTSP through a relay service that now serves several cameras at once
  (separate slots for the full-screen player and each live tile); HTTP-FLV as before.
- Optional live video in the tiles (**Live view**: off, 2, 4 or focus), off by
  default; the app detects how many streams the TV can play, and starts with
  Live view off after a crash.
- New name, icon and app identity.
