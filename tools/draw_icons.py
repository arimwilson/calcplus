# Draws src/common/logo.png (app icon) and src/common/back.png (backspace key).
import sys
from PIL import Image, ImageDraw

out = sys.argv[1]
SS = 8  # supersampling

def icon():
    n = 120 * SS
    img = Image.new('RGBA', (n, n), (0, 0, 0, 0))
    # vertical orange gradient disc
    grad = Image.new('RGBA', (n, n))
    gd = ImageDraw.Draw(grad)
    top, bot = (255, 160, 70), (255, 104, 10)
    for y in range(n):
        t = y / (n - 1)
        gd.line([(0, y), (n, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bot)) + (255,))
    mask = Image.new('L', (n, n), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, n - 1, n - 1], fill=255)
    img.paste(grad, (0, 0), mask)
    d = ImageDraw.Draw(img)
    w = 7 * SS  # stroke
    a = 13 * SS  # half glyph size
    white = (255, 255, 255, 255)
    def bar(x0, y0, x1, y1):
        d.rounded_rectangle([x0, y0, x1, y1], radius=w // 2, fill=white)
    cx1, cx2, cy1, cy2 = 41 * SS, 79 * SS, 41 * SS, 79 * SS
    # plus
    bar(cx1 - a, cy1 - w / 2, cx1 + a, cy1 + w / 2)
    bar(cx1 - w / 2, cy1 - a, cx1 + w / 2, cy1 + a)
    # minus
    bar(cx2 - a, cy1 - w / 2, cx2 + a, cy1 + w / 2)
    # times: rotated plus
    plus = Image.new('RGBA', (2 * a + 2 * w, 2 * a + 2 * w), (0, 0, 0, 0))
    pd = ImageDraw.Draw(plus)
    c = a + w
    pd.rounded_rectangle([c - a, c - w / 2, c + a, c + w / 2], radius=w // 2, fill=white)
    pd.rounded_rectangle([c - w / 2, c - a, c + w / 2, c + a], radius=w // 2, fill=white)
    plus = plus.rotate(45, resample=Image.BICUBIC)
    img.alpha_composite(plus, (int(cx1 - c), int(cy2 - c)))
    # equals
    bar(cx2 - a, cy2 - 6 * SS - w / 2, cx2 + a, cy2 - 6 * SS + w / 2)
    bar(cx2 - a, cy2 + 6 * SS - w / 2, cx2 + a, cy2 + 6 * SS + w / 2)
    img = img.resize((120, 120), Image.LANCZOS)
    img.save(out + '/logo.png', optimize=True)

def back():
    W, H = 26, 18
    n, m = W * SS, H * SS
    img = Image.new('RGBA', (n, m), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = int(1.8 * SS)  # stroke
    h = s / 2
    pts = [(h + 0.5, m / 2), (8 * SS, h), (n - h, h), (n - h, m - h), (8 * SS, m - h)]
    d.line(pts + [pts[0], pts[1]], fill=(255, 255, 255, 255), width=s, joint='curve')
    cx, cy, r = 16.5 * SS, m / 2, 3.6 * SS
    d.line([(cx - r, cy - r), (cx + r, cy + r)], fill=(255, 255, 255, 255), width=s)
    d.line([(cx - r, cy + r), (cx + r, cy - r)], fill=(255, 255, 255, 255), width=s)
    img = img.resize((W, H), Image.LANCZOS)
    img.save(out + '/back.png', optimize=True)

icon()
back()
