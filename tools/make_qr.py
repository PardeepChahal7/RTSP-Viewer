"""Makes ../qr-repo.png, the QR code on the About screen that points to the project page.
Run from this folder: python3 make_qr.py   (needs Pillow and reportlab)
To point it somewhere else, change URL and run it again."""
from PIL import Image
from reportlab.graphics.barcode import qrencoder

URL = 'https://github.com/PardeepChahal7/RTSP-Viewer'
SCALE = 10        # pixels per module
QUIET = 4         # empty modules around the code, as the QR standard asks

code = qrencoder.QRCode(None, qrencoder.QRErrorCorrectLevel.M)   # version chosen to fit the text
code.addData(URL)
code.make()
n = code.getModuleCount()
size = (n + 2 * QUIET) * SCALE
img = Image.new('L', (size, size), 255)
px = img.load()
for r in range(n):
    for c in range(n):
        if code.isDark(r, c):
            for y in range(SCALE):
                for x in range(SCALE):
                    px[(c + QUIET) * SCALE + x, (r + QUIET) * SCALE + y] = 0
img.convert('1').save('../qr-repo.png', optimize=True)
print('qr-repo.png: %d modules, %dx%d px' % (n, size, size))
