#!/usr/bin/env python3
"""
Builds review media from the frames written by scripts/verify-phase3.mjs.
Requires Python 3 + Pillow (no FFmpeg needed; FFmpeg-based export is Phase 4).

  python scripts/assemble-captures.py [captures/phase3]

Outputs (for every rec-<name> recording directory):
  <name>.webp                 real-time playback at the recorded resolution, 30 fps resample
  <name>.gif                  same, downscaled GIF for quick sharing
  contact-sheet.png           key transitional frames (deterministic seeks)
  strips-*.png                8 consecutive frames at 30/60 fps (aliasing review)
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

root = sys.argv[1] if len(sys.argv) > 1 else 'captures/phase3'
try:
    FONT = ImageFont.truetype('consola.ttf', 13)
except Exception:
    FONT = ImageFont.load_default()


def resample(rec_dir, fps):
    """Pick the captured frame nearest each 1/fps wall-clock tick (preserves real timing)."""
    ts = json.load(open(os.path.join(rec_dir, 'timing.json'), encoding='utf-8'))
    t0, j, picks = ts[0], 0, []
    for k in range(int((ts[-1] - t0) * fps) + 1):
        target = t0 + k / fps
        while j + 1 < len(ts) and abs(ts[j + 1] - target) <= abs(ts[j] - target):
            j += 1
        picks.append(os.path.join(rec_dir, f'frame_{j:04d}.jpg'))
    return picks


def save_anim(paths, out_webp, out_gif, fps, gif_width):
    frames = [Image.open(p).convert('RGB') for p in paths]
    frames[0].save(out_webp, save_all=True, append_images=frames[1:], duration=round(1000 / fps), loop=0, quality=82, method=4)
    gw = gif_width
    gh = round(frames[0].height * gw / frames[0].width)
    small = [f.resize((gw, gh), Image.LANCZOS).quantize(colors=96, method=Image.Quantize.MEDIANCUT) for f in frames]
    gif_fps = min(fps, 25)
    step = max(1, round(fps / gif_fps))
    small = small[::step]
    small[0].save(out_gif, save_all=True, append_images=small[1:], duration=round(1000 * step / fps), loop=0, optimize=True)


def contact_sheet():
    d = os.path.join(root, 'contact')
    meta = json.load(open(os.path.join(d, 'meta.json'), encoding='utf-8'))
    cols, tw = 6, 320
    th = 180
    rows = (len(meta) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw, rows * (th + 20)), (14, 14, 18))
    dr = ImageDraw.Draw(sheet)
    for i, m in enumerate(meta):
        im = Image.open(os.path.join(d, f'k{i:02d}.png')).convert('RGB').resize((tw, th), Image.LANCZOS)
        x, y = (i % cols) * tw, (i // cols) * (th + 20)
        sheet.paste(im, (x, y))
        dr.text((x + 5, y + th + 3), f"{m['t']:.2f}s  {m['phase']}", fill=(225, 225, 232), font=FONT)
    sheet.save(os.path.join(root, 'contact-sheet.png'))


def strips():
    sdir = os.path.join(root, 'strips')
    for name in sorted(os.listdir(sdir)):
        frames = [Image.open(os.path.join(sdir, name, f'f{i}.png')).convert('RGB') for i in range(8)]
        # Crop around the centre where the action is.
        w, h = frames[0].size
        box = (w // 2 - h // 3, h // 2 - h // 3, w // 2 + h // 3, h // 2 + h // 3)
        tiles = [f.crop(box).resize((300, 300), Image.LANCZOS) for f in frames]
        strip = Image.new('RGB', (300 * 8, 320), (14, 14, 18))
        dr = ImageDraw.Draw(strip)
        for i, t in enumerate(tiles):
            strip.paste(t, (i * 300, 0))
            dr.text((i * 300 + 5, 303), f'{name} #{i}', fill=(225, 225, 232), font=FONT)
        strip.save(os.path.join(root, f'strips-{name}.png'))


contact_sheet()
strips()
for rec in sorted(d for d in os.listdir(root) if d.startswith('rec-') and os.path.isdir(os.path.join(root, d))):
    name = rec[len('rec-'):]
    gif_width = 960 if '1080p' in name else 640
    save_anim(resample(os.path.join(root, rec), 30), os.path.join(root, f'{name}.webp'), os.path.join(root, f'{name}.gif'), 30, gif_width)
print('assembled into', root)
