#!/usr/bin/env python3
"""
Side-by-side sheets of two spark captures from scripts/capture-sparks.mjs.

  python scripts/compare-sparks.py <before> <after> <out-dir> [label-before] [label-after]

For every stage and set (progression, 30 fps run, 60 fps run) writes
<out-dir>/compare-<stage>-<set>.png: the "before" frames on the top row, the
"after" frames below, labelled with their timestamps. Ignition sets are cropped
around the body (detail); the others show the whole frame, since the shower
reaches far beyond the body.
"""
import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

a_dir, b_dir, out = sys.argv[1:4]
labels = (sys.argv[4] if len(sys.argv) > 4 else 'before', sys.argv[5] if len(sys.argv) > 5 else 'after')
os.makedirs(out, exist_ok=True)
try:
    FONT = ImageFont.truetype('consola.ttf', 15)
except Exception:
    FONT = ImageFont.load_default()

meta = json.load(open(os.path.join(b_dir, 'meta.json'), encoding='utf-8'))


def tile(path, stage):
    im = Image.open(path).convert('RGB')
    w, h = im.size
    if stage.startswith('1-'):
        s = int(h * 0.62)  # body + concentrated spray, at full resolution
        im = im.crop((w // 2 - s // 2, h // 2 - s // 2, w // 2 + s // 2, h // 2 + s // 2)).resize((420, 420), Image.LANCZOS)
    else:
        im = im.resize((480, 270), Image.LANCZOS)
    return im


for stage, sets in meta.items():
    for name, times in sets.items():
        rows = []
        for d in (a_dir, b_dir):
            folder = os.path.join(d, stage, name)
            files = sorted(f for f in os.listdir(folder) if f.endswith('.png'))
            rows.append([tile(os.path.join(folder, f), stage) for f in files])
        tw, th = rows[0][0].size
        cols = len(times)
        sheet = Image.new('RGB', (110 + cols * tw, 2 * (th + 22)), (14, 14, 18))
        dr = ImageDraw.Draw(sheet)
        for r, (row, label) in enumerate(zip(rows, labels)):
            y = r * (th + 22)
            dr.text((8, y + th // 2 - 8), label, fill=(235, 235, 240), font=FONT)
            for c, im in enumerate(row):
                sheet.paste(im, (110 + c * tw, y))
                dr.text((110 + c * tw + 5, y + th + 3), f'{times[c]:.3f}s', fill=(200, 200, 210), font=FONT)
        path = os.path.join(out, f'compare-{stage}-{name}.png')
        sheet.save(path)
        print(path, sheet.size)
