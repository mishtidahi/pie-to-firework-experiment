import type { CaptchaParams } from '../config';
import type { CaptchaState } from '../engine';
import { drawExplosion } from './explosion';
import { drawPanel } from './panel';
import { drawRocketFlight } from './rocket';
import { C, DESIGN_W } from './style';

/**
 * Render one frame. The canvas is W × H device pixels; drawing happens in the
 * 1080-wide design space (scale W / 1080), so the composition is identical at
 * any output size. Pure function of (params, state, t).
 */
export function drawFrame(ctx: CanvasRenderingContext2D, W: number, H: number, p: CaptchaParams, st: CaptchaState, t: number) {
  const s = W / DESIGN_W;
  const h = H / s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  if (t >= p.fillAt) {
    // Fully covered: the hold is exactly #ffde59, nothing else.
    ctx.fillStyle = C.yellow;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = C.blue;
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  drawPanel(ctx, p, st, t);
  drawRocketFlight(ctx, p, t);
  drawExplosion(ctx, p, t, h);
}
