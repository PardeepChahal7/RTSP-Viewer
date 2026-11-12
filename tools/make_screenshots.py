"""Takes the screenshots used in the README (docs/screenshots/) from the real app, running in headless Chromium
with made-up cameras. Run from anywhere:  python3 tools/make_screenshots.py
Needs: pip install playwright pillow   and   playwright install chromium"""
import functools
import http.server
import json
import os
import threading

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'docs', 'screenshots')
NAMES = ['Front door', 'Garden', 'Garage', 'Living room', 'Driveway', 'Back yard', 'Side gate', 'Kitchen',
         'Hallway', 'Porch', 'Shed', 'Nursery', 'Office', 'Basement', 'Balcony', 'Pool']
K = dict(LEFT=37, UP=38, RIGHT=39, DOWN=40, ENTER=13, BACK=10009)   # the remote's key codes


def camera(n, name):
    return {'id': 'c%d' % n, 'name': name, 'host': '192.168.1.%d' % (20 + n), 'user': 'viewer', 'password': 'example',
            'channel': 0, 'port': '80', 'scheme': 'http', 'mode': 'rtsp', 'stream': 'sub', 'audio': 'off', 'player': 'auto',
            'rtspPort': '554', 'rtspPath': '/live0', 'rtspPlayer': 'auto', 'autoconnect': 'off'}


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    os.makedirs(OUT, exist_ok=True)
    server = serve()
    seed = json.dumps({'version': 2, 'encrypted': False, 'cameras': [camera(i + 1, n) for i, n in enumerate(NAMES)]})
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={'width': 1920, 'height': 1080})
        page.add_init_script("if (!localStorage.getItem('rtsp-viewer-cameras')) localStorage.setItem('rtsp-viewer-cameras', %s);" % json.dumps(seed))
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))

        def press(code, hold_ms=0):
            page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: c, bubbles: true}))", code)
            if hold_ms:
                page.wait_for_timeout(hold_ms)
            page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: c, bubbles: true}))", code)
            page.wait_for_timeout(120)

        def shot(name):
            page.wait_for_timeout(250)
            raw = os.path.join(OUT, name + '.raw.png')
            page.screenshot(path=raw)
            Image.open(raw).convert('RGB').resize((1280, 720), Image.LANCZOS).save(os.path.join(OUT, name + '.png'), optimize=True)
            os.remove(raw)
            print('saved', name)

        page.goto('http://127.0.0.1:%d/index.html' % server.server_address[1])
        page.wait_for_selector('body.ready', timeout=10000)
        press(K['RIGHT']); press(K['LEFT'])                 # the TV has now reported a key release, so hold-OK works

        # the camera screen in each view size
        shot('camera-screen')                               # View: 4
        for label, name in (('8', 'view-8'), ('16', 'view-16'), ('2', 'view-2')):
            page.click('#cam-view')
            shot(name)
        page.click('#cam-view')                             # back to View: 4

        # hold OK on a camera: its options, and moving it
        press(K['RIGHT'])
        page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: c, bubbles: true}))", K['ENTER'])
        page.wait_for_timeout(900)
        shot('options-menu')
        page.evaluate("c => document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: c, bubbles: true}))", K['ENTER'])
        press(K['DOWN']); press(K['ENTER'])                 # Move camera
        press(K['RIGHT'])
        shot('move-camera')
        press(K['BACK'])                                    # put it back

        # the add-camera form
        page.click('#cam-add')
        page.wait_for_timeout(250)
        for code_text in ('Front door', '192.168.1.40'):    # name, then address
            press(K['ENTER']); page.keyboard.type(code_text); press(K['ENTER']); press(K['DOWN'])
        press(K['DOWN'])                                    # username stays as it is
        press(K['ENTER']); page.keyboard.type('hunter2'); press(K['ENTER'])
        press(K['RIGHT'])                                   # tick Show
        shot('add-camera')
        for _ in range(8):                                  # down to the RTSP path
            if page.evaluate("(document.querySelector('.row.focused') || {getAttribute: () => ''}).getAttribute('data-field')") == 'rtspPath':
                break
            press(K['DOWN'])
        press(K['ENTER']); page.keyboard.type('/live0'); press(K['ENTER'])
        shot('add-camera-rtsp')
        press(K['BACK'])

        # about
        page.click('#cam-about')
        shot('about')
        print('page errors:', errors)
        browser.close()
    server.shutdown()


if __name__ == '__main__':
    main()
