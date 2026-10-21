# Render the app icon: rosewood tile, bone tuner scale, brass needle with a round head.
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
ROSE = (36, 22, 18); BONE = (241, 232, 218); BRASS = (217, 164, 65); JADE = (111, 203, 162)

def draw(size, maskable=False, rounded=False):
    S = size * 4  # supersample
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=ROSE)
    else:
        d.rectangle([0, 0, S, S], fill=ROSE)
    # content box: maskable icons keep content in the central 80% (safe zone)
    pad = S * (0.2 if maskable else 0.12)
    box = S - 2 * pad
    cx = S / 2
    base_y = pad + box * 0.70
    # scale ticks
    ticks = 9
    for i in range(ticks):
        x = pad + box * (0.08 + 0.84 * i / (ticks - 1))
        centre = i == ticks // 2
        major = i in (0, ticks // 2, ticks - 1)
        h = box * (0.20 if centre else 0.13 if major else 0.08)
        w = box * (0.030 if centre else 0.020)
        col = BONE if (centre or major) else (150, 120, 105)
        d.rounded_rectangle([x - w / 2, base_y - h, x + w / 2, base_y], radius=w / 2, fill=col)
    # in-tune zone under the centre
    zw = box * 0.10
    d.rounded_rectangle([cx - zw / 2, base_y - box * 0.20, cx + zw / 2, base_y], radius=box * 0.02, fill=tuple(int(r * 0.68 + j * 0.32) for r, j in zip(ROSE, JADE)))
    # needle, slightly right of centre (a string almost in tune)
    nx = cx + box * 0.07
    nw = box * 0.045
    top = pad + box * 0.16
    d.rounded_rectangle([nx - nw / 2, top, nx + nw / 2, base_y + box * 0.04], radius=nw / 2, fill=BRASS)
    r = box * 0.075
    d.ellipse([nx - r, top - r * 0.6, nx + r, top + r * 1.4], fill=BRASS)
    # base line
    d.rounded_rectangle([pad + box * 0.06, base_y + box * 0.07, pad + box * 0.94, base_y + box * 0.095], radius=box * 0.012, fill=(90, 62, 51))
    return im.resize((size, size), Image.LANCZOS)

draw(192).save(f'{OUT}/icon-192.png')
draw(512).save(f'{OUT}/icon-512.png')
draw(512, maskable=True).save(f'{OUT}/icon-maskable-512.png')
draw(180).convert('RGB').save(f'{OUT}/apple-touch-icon.png')   # iOS adds its own rounding; no transparency
draw(64, rounded=True).save('/tmp/fav64.png')
# preview sheet
prev = Image.new('RGB', (900, 300), (238, 240, 238))
prev.paste(draw(256, rounded=True), (20, 22), draw(256, rounded=True))
m = draw(256, maskable=True); circle = Image.new('L', (256, 256), 0); ImageDraw.Draw(circle).ellipse([0, 0, 255, 255], fill=255)
prev.paste(m, (310, 22), circle)
prev.paste(draw(180).convert('RGB'), (620, 60))
prev.save('/tmp/icon_preview.png')
print('ok')
