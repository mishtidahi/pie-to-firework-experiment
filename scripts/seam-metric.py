#!/usr/bin/env python3
"""
Radial-discontinuity ("seam") metric for transition close-ups from scripts/capture-closeups.mjs.

  python scripts/seam-metric.py captures/refine/original captures/refine/revised

For each frame, the disc is unwrapped around its centre (720 angle steps × 60 radii
between 0.25 R and 0.95 R). For every angular step, the score is the share of
radii whose colour jumps across that step. A straight radial seam or edge gives one
step with a high share; spirals, arcs and rings spread their changes across many
steps and score low. Pie-shaped frames score high legitimately (sector edges are
radial); the morph frames are what matter.
"""
import json
import math
import os
import sys
from PIL import Image

R = 195.0  # pie radius in the 1080p close-up crops (scale 1 during the transition)


def score(path):
    im = Image.open(path).convert('RGB')
    px = im.load()
    cx, cy = im.width / 2, im.height / 2
    angles, radii = 720, 60
    rs = [R * (0.25 + 0.7 * j / (radii - 1)) for j in range(radii)]
    def col(a, r):
        return px[int(cx + r * math.cos(a)), int(cy + r * math.sin(a))]
    best = 0.0
    prev = [col(0.0, r) for r in rs]
    for i in range(1, angles + 1):
        a = 2 * math.pi * i / angles
        cur = [col(a, r) for r in rs]
        changes = sum(1 for p, c in zip(prev, cur) if max(abs(p[k] - c[k]) for k in range(3)) > 40)
        best = max(best, changes / radii)
        prev = cur
    return best


for d in sys.argv[1:]:
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
    frames = sorted(os.listdir(os.path.join(d, 'transition-60fps')))
    row = [(t, score(os.path.join(d, 'transition-60fps', f))) for t, f in zip(meta['transition-60fps'], frames)]
    name = os.path.basename(os.path.normpath(d))
    print(name.ljust(9), ' '.join(f'{t:.3f}:{s:.2f}' for t, s in row))


def churn(a_path, b_path):
    """Share of disc pixels (r ≤ R) whose colour changes between two consecutive frames."""
    a = Image.open(a_path).convert('RGB').load()
    b = Image.open(b_path).convert('RGB').load()
    n = changed = 0
    for y in range(45, 435, 2):
        for x in range(45, 435, 2):
            if (x - 240) ** 2 + (y - 240) ** 2 > R * R:
                continue
            n += 1
            pa, pb = a[x, y], b[x, y]
            if max(abs(pa[k] - pb[k]) for k in range(3)) > 40:
                changed += 1
    return changed / n


print('\nframe-to-frame churn (share of disc pixels changing colour between consecutive frames)')
for fps_dir in ('transition-30fps', 'transition-60fps'):
    for d in sys.argv[1:]:
        meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
        frames = sorted(os.listdir(os.path.join(d, fps_dir)))
        vals = [churn(os.path.join(d, fps_dir, frames[i]), os.path.join(d, fps_dir, frames[i + 1])) for i in range(len(frames) - 1)]
        times = meta[fps_dir]
        hi = [f'{times[i + 1]:.3f}' for i, v in enumerate(vals) if v > 0.2]
        print(f'{fps_dir} {os.path.basename(os.path.normpath(d)).ljust(9)} mean {sum(vals) / len(vals):.3f}  max {max(vals):.3f}  frames >20% churn: {len(hi)} {hi}')
