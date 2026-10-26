# Lays out test/screens/*.png in a grid with captions.
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

src, out = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(src, '*.png')))
captions = {
    '01-start': 'Start', '02-typing': '2+3× typed', '03-result': '2+3×4 = 14',
    '04-pressed-7': 'Holding 7', '05-pressed-eq': 'Holding =', '06-error': '8÷0',
    '07-twelve-digits': '12-digit limit', '08-widest': 'Widest number', '09-long-expression': 'Long expression',
    '10-exponent': 'Exponent result', '11-secret': 'AC x5 (secret)', '12-repeat-equals': '2+3= then = =', '13-operator-page': 'Operator page', '14-pressed-ac': 'Holding AC',
}
ims = [Image.open(f).convert('RGB') for f in files]
w, h = ims[0].size
scale = 0.5
tw, th = int(w * scale), int(h * scale)
cols = 5
pad, cap = 16, 30
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (tw + pad) + pad, rows * (th + cap + pad) + pad + 34), (24, 24, 24))
d = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('DejaVuSans.ttf', 15)
    big = ImageFont.truetype('DejaVuSans-Bold.ttf', 17)
except OSError:
    font = big = ImageFont.load_default()
d.text((pad, 10), 'Calc+ on a 212x520 Band 10 screen (headless Chromium harness, 2x). Grey = outside the capsule; dashed = 103 px safe outline.', fill=(220, 220, 220), font=font)
for i, (f, im) in enumerate(zip(files, ims)):
    r, c = divmod(i, cols)
    x = pad + c * (tw + pad)
    y = 34 + pad + r * (th + cap + pad)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y))
    name = os.path.splitext(os.path.basename(f))[0]
    d.text((x, y + th + 6), captions.get(name, name), fill=(235, 235, 235), font=big)
sheet.save(out, optimize=True)
print(out, sheet.size)
