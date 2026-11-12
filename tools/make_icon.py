"""RTSP Viewer icon: house + camera, in the style of the reference, with 'RTSP' inside the house.
Drawn at 4x and scaled down, so edges are smooth. Output: ../icon.png (512x512).
Run from this folder: python3 make_icon.py  (needs Pillow, and the Inter font named below)"""
import math
from PIL import Image, ImageDraw, ImageFont

S = 4
SIZE = 512
W = SIZE * S
BG = (252, 252, 252)
C_LEFT = (249, 222, 74)     # yellow
C_RIGHT = (232, 98, 43)     # orange-red
FONT = '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf'

mask = Image.new('L', (W, W), 0)
d = ImageDraw.Draw(mask)

def P(pts):
    return [(x * S, y * S) for x, y in pts]

def stroke(pts, width):
    pts = P(pts)
    w = width * S
    d.line(pts, fill=255, width=int(round(w)), joint='curve')
    r = w / 2.0
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)

def arc(cx, cy, r, a0, a1, n=24):
    """points on a circle, angles in degrees (0 = right, 90 = down)"""
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

SW = 13       # house stroke
CW = 11.5     # camera stroke

# roof: two chevrons
stroke([(38, 232), (256, 58), (474, 232)], SW)
stroke([(84, 240), (256, 102), (428, 240)], SW)

# walls and floor, rounded bottom corners
R = 30
left, right, top, bottom = 117, 395, 213, 452
body = [(left, top), (left, bottom - R)] + arc(left + R, bottom - R, R, 180, 90) \
     + arc(right - R, bottom - R, R, 90, 0) + [(right, top)]
stroke(body, SW)

# camera: body with a raised top in the middle
L, Rr, T, B, rc = 178, 334, 196, 296, 14
bl, br, bt, rb = 212, 300, 180, 11      # raised part: left, right, top, corner radius
cam = [(L + rc, T), (bl - 4, T), (bl, T - 2)]
cam = [(L + rc, T), (bl, T), (bl, bt + rb)] + arc(bl + rb, bt + rb, rb, 180, 270) \
    + arc(br - rb, bt + rb, rb, 270, 360) + [(br, T), (Rr - rc, T)] \
    + arc(Rr - rc, T + rc, rc, 270, 360) + [(Rr, B - rc)] \
    + arc(Rr - rc, B - rc, rc, 0, 90) + [(L + rc, B)] \
    + arc(L + rc, B - rc, rc, 90, 180) + [(L, T + rc)] \
    + arc(L + rc, T + rc, rc, 180, 270)
stroke(cam, CW)
# lens: two rings
cx, cy = 256, 248
stroke(arc(cx, cy, 36, 0, 360, 60), CW)
stroke(arc(cx, cy, 20, 0, 360, 48), CW)

# RTSP, centred under the camera, letter-spaced
font = ImageFont.truetype(FONT, 84 * S)
text = 'RTSP'
track = 7 * S
widths = [d.textlength(ch, font=font) for ch in text]
total = sum(widths) + track * (len(text) - 1)
x = (W - total) / 2.0
asc_box = d.textbbox((0, 0), 'RTSP', font=font)
text_h = asc_box[3] - asc_box[1]
y_top = 346 * S - asc_box[1]
for ch, wch in zip(text, widths):
    d.text((x, y_top), ch, font=font, fill=255)
    x += wch + track

# gradient left -> right, as in the reference
grad_row = Image.new('RGB', (W, 1))
px = grad_row.load()
x0, x1 = 40 * S, 474 * S
for i in range(W):
    t = min(1.0, max(0.0, (i - x0) / float(x1 - x0)))
    px[i, 0] = tuple(int(round(a + (b - a) * t)) for a, b in zip(C_LEFT, C_RIGHT))
grad = grad_row.resize((W, W), Image.NEAREST)

canvas = Image.composite(grad, Image.new('RGB', (W, W), BG), mask)
icon = canvas.resize((SIZE, SIZE), Image.LANCZOS)
icon.save('../icon.png', optimize=True)
print('text height (px at 512):', text_h / S, ' text width:', total / S)
