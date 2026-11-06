#!/usr/bin/env python3
"""
Side-by-side comparison sheets from two scripts/capture-closeups.mjs runs.

  python scripts/compare-closeups.py captures/refine/original captures/refine/revised captures/refine

Writes compare-transition-30fps.png, compare-transition-60fps.png and compare-rim.png:
row A = first capture, row B = second capture, columns = the same timestamps.
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

a_dir, b_dir, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
labels = (sys.argv[4], sys.argv[5]) if len(sys.argv) > 5 else ('original', 'revised')
try:
    FONT = ImageFont.truetype('consola.ttf', 14)
except Exception:
    FONT = ImageFont.load_default()
meta = json.load(open(os.path.join(a_dir, 'meta.json'), encoding='utf-8'))
os.makedirs(out_dir, exist_ok=True)


def sheet(name, files, times, tile, out):
    cols = len(files)
    img = Image.new('RGB', (110 + cols * tile, 2 * (tile + 22) + 4), (14, 14, 18))
    dr = ImageDraw.Draw(img)
    for row, (label, d) in enumerate(((labels[0], a_dir), (labels[1], b_dir))):
        y = 4 + row * (tile + 22)
        dr.text((8, y + tile // 2 - 8), label, fill=(230, 230, 236), font=FONT)
        for c, f in enumerate(files):
            im = Image.open(os.path.join(d, name, f)).convert('RGB').resize((tile, tile), Image.LANCZOS)
            img.paste(im, (110 + c * tile, y))
            if row == 1:
                dr.text((110 + c * tile + 4, y + tile + 3), f'{times[c]:.3f}s', fill=(170, 170, 180), font=FONT)
    img.save(os.path.join(out_dir, out))


for name in ('transition-30fps', 'transition-60fps'):
    files = sorted(os.listdir(os.path.join(a_dir, name)))
    sheet(name, files, meta[name], 150, f'compare-{name}.png')
rim_files = [f'r{i}.png' for i in range(len(meta['rim']))]
sheet('rim', rim_files, [r['t'] for r in meta['rim']], 420, 'compare-rim.png')
print('wrote comparison sheets to', out_dir)
