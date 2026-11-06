#!/usr/bin/env python3
"""
Spark stroke thickness measured from captured frames (scripts/capture-sparks.mjs).

  python scripts/stroke-width.py <capture-dir> [<capture-dir> …]

In the peak-stage frames, vertical pixel columns are sampled left and right of the
body (2.0–2.7 R from the centre), where the strokes run close to horizontal, so a
column crosses each stroke roughly at right angles. Each run of stroke pixels
(clearly not the blue background) is one crossing; its length estimates the stroke
width there (crossings at an angle read a little wide, so the median is a slight
overestimate). For reference, the face's inner groove rings measure ≈ 4.5 px wide at
1080p (radial profile of the top face).
"""
import json
import os
import sys
from statistics import median
from PIL import Image

R = 195.0  # body radius in px at 1080p, scale 1


def is_stroke(p):
    r, g, b = p
    return b < 170 or r > 120  # anything clearly off the #1a00d9 background


for d in sys.argv[1:]:
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
    runs = []
    folder = os.path.join(d, '3-peak', 'progression')
    for f in sorted(os.listdir(folder)):
        im = Image.open(os.path.join(folder, f)).convert('RGB')
        px = im.load()
        cx, cy = im.width // 2, im.height // 2
        for side in (-1, 1):
            for k in range(0, 15):
                x = int(cx + side * R * (2.0 + 0.05 * k))
                run = 0
                for y in range(int(cy - 0.5 * R), int(cy + 0.5 * R)):
                    if is_stroke(px[x, y]):
                        run += 1
                    elif run:
                        runs.append(run)
                        run = 0
    runs.sort()
    q = lambda p: runs[int(len(runs) * p)]
    name = os.path.basename(os.path.normpath(d))
    print(f'{name:10s} crossings {len(runs):5d}  median {median(runs):.1f} px  p25 {q(0.25)} px  p75 {q(0.75)} px  (~{median(runs) / R:.4f} R)')
