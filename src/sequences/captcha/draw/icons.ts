import { drawRocketBody } from './rocket';
import { C, TAU, poly, sparkStroke } from './style';

/**
 * The nine festive tile illustrations, as canvas vector paths. Each draws
 * centred on (0, 0) inside a ±95 box. One visual system: flat fills, a single
 * stepped shadow band (a flat blue-tinted overlay, so every shade is a palette
 * derivative), small hard highlights, and a restrained deep-blue outline.
 */
export type IconDraw = (ctx: CanvasRenderingContext2D) => void;

const OUTLINE = 5;
/** Flat shadow tone: palette blue over the base colour (result is a solid, stepped tone). */
const SHADE = 'rgba(26, 0, 217, 0.17)';

function outline(ctx: CanvasRenderingContext2D, w = OUTLINE) {
  ctx.lineWidth = w;
  ctx.strokeStyle = C.blue;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** Fill a path, add a clipped shadow region, then outline it. */
function shape(ctx: CanvasRenderingContext2D, path: () => void, fill: string, shadow?: () => void, stroke = true) {
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  if (shadow) {
    ctx.save();
    path();
    ctx.clip();
    shadow();
    ctx.fillStyle = SHADE;
    ctx.fill();
    ctx.restore();
  }
  if (stroke) {
    path();
    outline(ctx);
  }
}

const ellipse = (ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot = 0) => {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
};
const circle = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
};

/** Teardrop flame (base at (x, y), pointing up), three cel layers. */
function flame(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, w: number, stroke = true) {
  const drop = (s: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - w * s, y - h * s * 0.3, x - w * s * 0.55, y - h * s * 0.72, x + w * s * 0.08, y - h * s);
    ctx.bezierCurveTo(x + w * s * 0.62, y - h * s * 0.7, x + w * s, y - h * s * 0.3, x, y);
    ctx.closePath();
  };
  shape(ctx, () => drop(1), C.orange, undefined, stroke);
  drop(0.7);
  ctx.fillStyle = C.yellow;
  ctx.fill();
  drop(0.38);
  ctx.fillStyle = C.hot;
  ctx.fill();
}

/** A round sweet (ladoo): saffron ball, crescent shadow, hard highlight, a few grain dots. */
function ladoo(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, base = C.saffron) {
  shape(ctx, () => circle(ctx, x, y, r), base, () => {
    ctx.beginPath();
    ctx.rect(x - r - 4, y - r - 4, 2 * r + 8, 2 * r + 8);
    ctx.arc(x - r * 0.24, y - r * 0.24, r * 1.02, 0, TAU, true);
  });
  ellipse(ctx, x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.13, -0.7);
  ctx.fillStyle = C.hot;
  ctx.fill();
  if (base === C.saffron) {
    ctx.fillStyle = C.orangeShade;
    for (const [dx, dy] of [[0.25, -0.1], [-0.15, 0.3], [0.45, 0.35], [-0.5, 0.05]]) {
      circle(ctx, x + dx * r, y + dy * r, Math.max(2, r * 0.07));
      ctx.fill();
    }
  }
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string) {
  poly(ctx, [[x, y - s], [x + s * 0.38, y], [x, y + s], [x - s * 0.38, y]]);
  ctx.fillStyle = fill;
  ctx.fill();
}

// ── 1. Diya ───────────────────────────────────────────────────────────────
const diya: IconDraw = (ctx) => {
  ctx.translate(-8, 14);
  shape(ctx, () => poly(ctx, [[-36, 50], [16, 50], [10, 70], [-30, 70]]), C.orangeShade);
  const bowl = () => {
    ctx.beginPath();
    ctx.moveTo(-86, 0);
    ctx.bezierCurveTo(-84, 56, 22, 64, 58, 24);
    ctx.lineTo(90, -12);
    ctx.lineTo(44, 4);
    ctx.quadraticCurveTo(-20, 18, -86, 0);
    ctx.closePath();
  };
  shape(ctx, bowl, C.orange, () => ellipse(ctx, -14, 66, 120, 34));
  ellipse(ctx, -24, 5, 54, 7);
  ctx.fillStyle = C.orangeDeep;
  ctx.fill();
  ctx.fillStyle = C.yellow;
  for (const [x, y] of [[-56, 26], [-26, 34], [6, 32]]) {
    circle(ctx, x, y, 6);
    ctx.fill();
  }
  flame(ctx, 80, -14, 80, 26);
};

// ── 2. Ladoo / sweets ─────────────────────────────────────────────────────
const sweets: IconDraw = (ctx) => {
  shape(ctx, () => ellipse(ctx, 0, 64, 92, 20), C.off, () => ellipse(ctx, 0, 76, 100, 18));
  ladoo(ctx, -38, 30, 36);
  ladoo(ctx, 38, 30, 36);
  ladoo(ctx, 0, -26, 36);
};

// ── 3. Rocket firecracker ─────────────────────────────────────────────────
const rocket: IconDraw = (ctx) => {
  ctx.rotate(0.62);
  ctx.scale(0.7, 0.7);
  ctx.translate(-6, -20);
  drawRocketBody(ctx, { flame: 46, flicker: 1, stick: 120 });
};

// ── 4. Flowerpot (anar) ───────────────────────────────────────────────────
const flowerpot: IconDraw = (ctx) => {
  const rays = 9;
  for (let i = 0; i < rays; i++) {
    const a = -1.05 + (2.1 * i) / (rays - 1);
    const L = i % 2 ? 62 : 84;
    sparkStroke(ctx, Math.sin(a) * L, -6 - Math.cos(a) * L, Math.sin(a) * 12, -10 - Math.cos(a) * 12, 9);
  }
  ctx.fillStyle = C.orange;
  for (const [x, y] of [[-70, -40], [66, -50], [-30, -88], [34, -84], [0, -100]]) {
    diamond(ctx, x, y, 9, C.orange);
  }
  const pot = () => {
    ctx.beginPath();
    ctx.moveTo(-20, -4);
    ctx.lineTo(20, -4);
    ctx.bezierCurveTo(26, 30, 46, 58, 58, 82);
    ctx.lineTo(-58, 82);
    ctx.bezierCurveTo(-46, 58, -26, 30, -20, -4);
    ctx.closePath();
  };
  pot();
  ctx.fillStyle = C.orange;
  ctx.fill();
  ctx.save();
  pot();
  ctx.clip();
  ctx.fillStyle = C.yellow;
  ctx.fillRect(-70, 38, 140, 16);
  ctx.fillStyle = SHADE;
  ctx.fillRect(18, -10, 60, 100);
  ctx.restore();
  pot();
  outline(ctx);
  shape(ctx, () => ellipse(ctx, 0, -5, 22, 6), C.offShade);
};

// ── 5. Sparkler ───────────────────────────────────────────────────────────
const sparkler: IconDraw = (ctx) => {
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-74, 88);
  ctx.lineTo(22, -8);
  ctx.strokeStyle = C.blue;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-74, 88);
  ctx.lineTo(-44, 58);
  ctx.lineWidth = 14;
  ctx.strokeStyle = C.blueMuted;
  ctx.stroke();
  const cx = 26;
  const cy = -16;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + 0.13;
    const L = k % 2 ? 40 : 68;
    sparkStroke(ctx, cx + Math.cos(a) * L, cy + Math.sin(a) * L, cx + Math.cos(a) * 14, cy + Math.sin(a) * 14, 8);
  }
  const star: [number, number][] = [];
  for (let k = 0; k < 16; k++) {
    const r = k % 2 ? 13 : 30;
    const a = (k / 16) * TAU;
    star.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  poly(ctx, star);
  ctx.fillStyle = C.yellow;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.orange;
  ctx.lineJoin = 'round';
  ctx.stroke();
  circle(ctx, cx, cy, 10);
  ctx.fillStyle = C.hot;
  ctx.fill();
  for (const [x, y, s] of [[-40, -50, 12], [78, 40, 11], [74, -72, 9], [-12, 36, 8]]) diamond(ctx, x, y, s, C.orange);
};

// ── 6. Sweets box ─────────────────────────────────────────────────────────
const sweetsBox: IconDraw = (ctx) => {
  ctx.translate(0, 8);
  shape(ctx, () => poly(ctx, [[-80, -8], [-66, -30], [66, -30], [80, -8]]), C.orangeDeep);
  ladoo(ctx, -46, -22, 24);
  ladoo(ctx, 46, -22, 24);
  shape(ctx, () => poly(ctx, [[0, -56], [30, -28], [0, 0], [-30, -28]]), C.off, () => {
    ctx.beginPath();
    ctx.rect(0, -60, 40, 70);
  });
  diamond(ctx, -6, -34, 6, C.offShade);
  const front = () => {
    ctx.beginPath();
    ctx.roundRect(-88, -8, 176, 86, 8);
  };
  front();
  ctx.fillStyle = C.orange;
  ctx.fill();
  ctx.save();
  front();
  ctx.clip();
  ctx.fillStyle = C.yellow;
  ctx.fillRect(-90, 18, 180, 16);
  ctx.fillStyle = SHADE;
  ctx.fillRect(-90, 56, 180, 30);
  ctx.restore();
  front();
  outline(ctx);
  for (const x of [-56, 0, 56]) {
    circle(ctx, x, 26, 6);
    ctx.fillStyle = C.orange;
    ctx.fill();
  }
};

// ── 7. Chakri spinner ─────────────────────────────────────────────────────
const chakri: IconDraw = (ctx) => {
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * TAU + 0.3;
    sparkStroke(ctx, Math.cos(a + 0.32) * 94, Math.sin(a + 0.32) * 94, Math.cos(a) * 72, Math.sin(a) * 72, 9);
  }
  shape(ctx, () => circle(ctx, 0, 0, 66), C.yellow, () => {
    ctx.beginPath();
    ctx.rect(-80, -80, 160, 160);
    ctx.arc(-8, -8, 66, 0, TAU, true);
  });
  ctx.beginPath();
  for (let i = 0; i <= 140; i++) {
    const s = i / 140;
    const r = 10 + 50 * s;
    const a = s * 3 * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.lineWidth = 10;
  ctx.strokeStyle = C.orange;
  ctx.lineCap = 'round';
  ctx.stroke();
  shape(ctx, () => circle(ctx, 0, 0, 11), C.orangeDeep);
  circle(ctx, 0, 0, 66);
  outline(ctx);
};

// ── 8. Festive dessert bowl (gulab jamun) ────────────────────────────────
const dessertBowl: IconDraw = (ctx) => {
  ctx.translate(0, 10);
  shape(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(-30, 54, 60, 16, 4);
  }, C.offShade);
  const bowl = () => {
    ctx.beginPath();
    ctx.moveTo(-90, 2);
    ctx.bezierCurveTo(-88, 74, 88, 74, 90, 2);
    ctx.closePath();
  };
  bowl();
  ctx.fillStyle = C.off;
  ctx.fill();
  ctx.save();
  bowl();
  ctx.clip();
  ctx.fillStyle = C.orange;
  ctx.fillRect(-100, 24, 200, 13);
  ctx.fillStyle = SHADE;
  circle(ctx, 78, 70, 78);
  ctx.fill();
  ctx.restore();
  bowl();
  outline(ctx);
  shape(ctx, () => ellipse(ctx, 0, 2, 90, 14), C.gold);
  ladoo(ctx, -36, -14, 27, C.orangeDeep);
  ladoo(ctx, 34, -16, 27, C.orangeDeep);
  ladoo(ctx, -2, -40, 26, C.orangeDeep);
  ctx.fillStyle = C.yellow;
  for (const [x, y, a] of [[-12, -60, -0.5], [12, -58, 0.6], [44, -38, 1.1]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.beginPath();
    ctx.roundRect(-7, -3, 14, 6, 3);
    ctx.fill();
    ctx.restore();
  }
};

// ── 9. Firecracker assortment ────────────────────────────────────────────
const assortment: IconDraw = (ctx) => {
  ctx.translate(0, 6);
  const cracker = (x: number, top: number, w: number, fill: string, band: string, bands: [number, number][], fuseDir: number) => {
    ctx.beginPath();
    ctx.moveTo(x, top - 3);
    ctx.bezierCurveTo(x + 14 * fuseDir, top - 14, x - 6 * fuseDir, top - 22, x + 10 * fuseDir, top - 34);
    ctx.strokeStyle = C.blue;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.stroke();
    const body = () => {
      ctx.beginPath();
      ctx.roundRect(x - w / 2, top, w, 82 - top, 5);
    };
    body();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.save();
    body();
    ctx.clip();
    ctx.fillStyle = band;
    for (const [y0, y1] of bands) ctx.fillRect(x - w, y0, 2 * w, y1 - y0);
    ctx.fillStyle = SHADE;
    ctx.fillRect(x + w * 0.2, top - 2, w, 90);
    ctx.restore();
    body();
    outline(ctx);
    shape(ctx, () => ellipse(ctx, x, top, w / 2, 6), C.offShade);
  };
  cracker(-50, -18, 38, C.orange, C.off, [[8, 20], [44, 54]], -1);
  cracker(50, 2, 36, C.off, C.orange, [[22, 34]], 1);
  cracker(0, -56, 42, C.yellow, C.orange, [[-30, -18], [24, 36]], 1);
  // the middle fuse is lit
  diamond(ctx, 10, -92, 12, C.orange);
  diamond(ctx, 10, -92, 6, C.hot);
  shape(ctx, () => {
    ctx.beginPath();
    ctx.roundRect(-76, 56, 152, 13, 4);
  }, C.blueMuted);
};

/** Row-major order: diya, ladoo, rocket / flowerpot, sparkler, sweets box / chakri, dessert bowl, assortment. */
export const ICONS: IconDraw[] = [diya, sweets, rocket, flowerpot, sparkler, sweetsBox, chakri, dessertBowl, assortment];
export const ICON_NAMES = ['Diya', 'Ladoo', 'Rocket firecracker', 'Flowerpot', 'Sparkler', 'Sweets box', 'Chakri', 'Dessert bowl', 'Firecracker assortment'];
