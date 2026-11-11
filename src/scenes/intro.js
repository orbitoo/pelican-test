// src/scenes/intro.js
// Intro (0.0s - 5.0s, 2.5 bars @ 120 BPM):
// Archival paper texture, corner facsimile sketch "图一 鹈鹕骑行图（摹本）",
// deadpan documentary serif subtitles hitting the strong beat, and a 1:1 world-projected
// single-pelican match-cut dissolving from sepia manuscript study directly into Frame #1!

import { VIEW_W, VIEW_H, BASE_PANEL_SCALE } from '../beat/camera.js';
import { ROAD_EDGE_Y, smoothstep, smootherstep, lerp } from '../beat/timeline.js';
import { computePelicanRig, drawRig2D } from '../rig/pelican.js';

/**
 * Bakes the 1920x1080 archival documentary paper + corner facsimile plate once.
 */
function getIntroBackdrop(kit) {
  return kit.bake2D('intro_archival_backdrop_s3', (g, ctx, rng, w, h) => {
    // Warm museum rag-paper gradient
    const bg = ctx.createRadialGradient(w * 0.45, h * 0.45, 80, w * 0.5, h * 0.5, w * 0.78);
    bg.addColorStop(0, '#f6efe0');
    bg.addColorStop(0.65, '#ebe0c9');
    bg.addColorStop(1, '#d8c8a8');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // Subtle laid-paper horizontal chain lines & cotton fibers
    for (let y = 0; y < h; y += 5) {
      ctx.strokeStyle = `rgba(110, 88, 58, ${(0.022 + rng() * 0.018).toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    for (let i = 0; i < 1600; i++) {
      const fx = rng() * w;
      const fy = rng() * h;
      const len = 5 + rng() * 18;
      const a = rng() * Math.PI * 2;
      ctx.strokeStyle =
        rng() > 0.4
          ? `rgba(255, 252, 245, ${(0.14 + rng() * 0.16).toFixed(3)})`
          : `rgba(108, 84, 54, ${(0.04 + rng() * 0.07).toFixed(3)})`;
      ctx.lineWidth = 0.7 + rng() * 0.8;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + Math.cos(a) * len, fy + Math.sin(a) * len);
      ctx.stroke();
    }

    // Subtle archival double border around page margin
    ctx.strokeStyle = 'rgba(88, 70, 48, 0.32)';
    ctx.lineWidth = 2;
    ctx.strokeRect(56, 48, w - 112, h - 96);
    ctx.lineWidth = 0.8;
    ctx.strokeRect(64, 56, w - 128, h - 112);

    // Corner Plate Box (top-right archival facsimile plate: "图一 鹈鹕骑行图（摹本）")
    const px = 1285;
    const py = 116;
    const pw = 490;
    const ph = 408;

    ctx.fillStyle = 'rgba(240, 230, 208, 0.85)';
    ctx.strokeStyle = 'rgba(78, 60, 40, 0.62)';
    ctx.lineWidth = 1.8;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeRect(px, py, pw, ph);

    ctx.strokeStyle = 'rgba(78, 60, 40, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 8, py + 8, pw - 16, ph - 56);

    // Cross-hatched sepia ground lines inside the facsimile sketch
    ctx.strokeStyle = 'rgba(92, 71, 48, 0.32)';
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 42; i++) {
      const lx = px + 36 + i * 10;
      const ly = py + 298 + (rng() - 0.5) * 6;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx - 14, ly + 18);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(px + 28, py + 296);
    ctx.lineTo(px + pw - 28, py + 296);
    ctx.stroke();

    // Facsimile pencil-and-sepia anatomical sketch of pelican on archaic velocipede
    const sketchRig = computePelicanRig({
      x: px + pw * 0.5 - 6,
      y: py + 296,
      pedalAngle: 0.65,
      wheelAngle: 0.3,
      scale: 0.9,
      speedScale: 0.2,
    });

    // Construction measurement callouts (book-plate authenticity!)
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(110, 82, 52, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sketchRig.frontWheel.x, sketchRig.frontWheel.y, sketchRig.frontWheel.r + 14, 0, Math.PI * 2);
    ctx.moveTo(px + 42, sketchRig.head.y);
    ctx.lineTo(px + pw - 42, sketchRig.head.y);
    ctx.stroke();
    ctx.restore();

    // Multi-pass graphite/sepia sketch strokes
    for (let pass = 0; pass < 2; pass++) {
      ctx.save();
      ctx.translate((pass - 0.5) * 1.3, (0.5 - pass) * 1.1);
      drawRig2D(ctx, sketchRig, {
        featherFill: pass === 0 ? 'rgba(232, 220, 195, 0.55)' : 'transparent',
        featherShade: 'rgba(186, 166, 134, 0.42)',
        wingTipDark: 'rgba(72, 56, 38, 0.7)',
        beakFill: 'rgba(205, 168, 118, 0.38)',
        pouchFill: 'rgba(188, 145, 96, 0.38)',
        legFill: 'rgba(110, 84, 56, 0.65)',
        frameStroke: 'rgba(76, 58, 40, 0.78)',
        metalStroke: 'rgba(86, 68, 48, 0.68)',
        tireStroke: 'rgba(62, 48, 34, 0.82)',
        inkOutline: pass === 0 ? 'rgba(58, 44, 30, 0.85)' : 'rgba(92, 70, 48, 0.42)',
        lineScale: pass === 0 ? 0.82 : 0.48,
      });
      ctx.restore();
    }

    // Small plate index annotations "α", "β"
    ctx.fillStyle = 'rgba(82, 62, 42, 0.72)';
    ctx.font = 'italic 16px "PelicanSerif", serif';
    ctx.fillText('fig. α', sketchRig.beakTip.x + 8, sketchRig.beakTip.y - 6);
    ctx.fillText('fig. β', sketchRig.bb.x - 14, sketchRig.bb.y + 32);

    // Caption: 图一 鹈鹕骑行图（摹本）
    ctx.fillStyle = '#3b2e20';
    ctx.font = '600 21px "PelicanSerif", serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('图一　鹈鹕骑行图（摹本）', px + pw / 2, py + ph - 24);
  }, VIEW_W, VIEW_H);
}

/**
 * Renders the Intro overlay (0.0s -> 5.0s) onto a 1920x1080 2D overlay canvas.
 * Locks the departing manuscript pelican 1:1 onto the exact world-to-screen camera projection
 * of `(pelWorld.worldX, ROAD_EDGE_Y)` so there is ONE single continuous pelican morphing from
 * sepia sketch into Frame #1's prehistoric ochre rock art!
 */
export function renderIntroOverlay(kit, overlayG, t, cam = null, pelWorld = null) {
  if (t >= 5.0) return false;
  const ctx = overlayG.drawingContext;
  ctx.clearRect(0, 0, VIEW_W, VIEW_H);

  const pageAlpha = 1 - smootherstep(4.28, 4.96, t);
  const sketchPelAlpha = smoothstep(3.05, 3.45, t) * (1 - smootherstep(4.22, 4.92, t));
  if (pageAlpha <= 0.002 && sketchPelAlpha <= 0.002) return false;

  const camX = cam?.camX ?? -100;
  const camY = cam?.camY ?? 500;
  const scale = cam?.scale ?? BASE_PANEL_SCALE;

  // 1. Archival Rag-Paper Page + Documentary Typography (parting smoothly to unveil Frame #1 on the right)
  if (pageAlpha > 0.002) {
    const backdrop = getIntroBackdrop(kit);
    ctx.save();
    ctx.globalAlpha = pageAlpha;
    ctx.drawImage(backdrop.canvas, 0, 0);

    // Subtle opening fade-from-sepia-dark (0.0s -> 0.45s)
    const openFade = 1 - smoothstep(0.0, 0.45, t);
    if (openFade > 0.001) {
      ctx.fillStyle = `rgba(22, 18, 14, ${(openFade * 0.65).toFixed(3)})`;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    }

    // Documentary Subtitles (Left-aligned editorial column, crisp 1080p serif)
    const textX = 142;

    // Line 1: Fades in across Bar 1 downbeat (1.0s)
    const a1 = smoothstep(0.65, 1.08, t);
    if (a1 > 0.001) {
      ctx.save();
      ctx.globalAlpha = pageAlpha * a1;
      ctx.fillStyle = '#1f1913';
      ctx.font = '700 50px "PelicanSerif", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('「人类自古以来就痴迷于画鹈鹕骑自行车。」', textX, 398);
      ctx.restore();
    }

    // Line 2: Lands crisply on Bar 2 STRONG BEAT (t = 3.0s)
    const a2 = smoothstep(2.92, 3.12, t);
    if (a2 > 0.001) {
      const beatBump = t >= 2.98 && t < 3.45 ? Math.exp(-(t - 3.0) * 9) * 3.0 : 0;
      ctx.save();
      ctx.globalAlpha = pageAlpha * a2;
      ctx.fillStyle = '#241c15';
      ctx.font = '700 50px "PelicanSerif", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('「——早在自行车被发明之前。」', textX + 26, 488 - beatBump);
      ctx.restore();
    }

    // Citation small print: fades in right after Line 2 (3.06s -> 3.28s)
    const aCite = smoothstep(3.06, 3.28, t);
    if (aCite > 0.001) {
      ctx.save();
      ctx.globalAlpha = pageAlpha * aCite;
      ctx.fillStyle = '#3d2f20';
      ctx.font = '600 26px "PelicanSerif", serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText('——《鹈鹕骑行艺术通史》，卷一', textX + 400, 560);
      ctx.restore();
    }

    // Smooth right-to-left soft archival page reveal starting at 3.85s so Frame #1's
    // sandstone border & Sahara rock face emerge ahead of the approaching bicycle!
    const wipeU = smootherstep(3.85, 4.94, t);
    if (wipeU > 0.002) {
      const edgeCenter = lerp(VIEW_W + 240, -260, wipeU);
      const featherHalf = 260;
      const gWipe = ctx.createLinearGradient(edgeCenter - featherHalf, 0, edgeCenter + featherHalf, 0);
      gWipe.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gWipe.addColorStop(0.5, 'rgba(0, 0, 0, 0.52)');
      gWipe.addColorStop(1, 'rgba(0, 0, 0, 1)');
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = gWipe;
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }

    ctx.restore();
  }

  // 2. 1:1 World-Projected Sepia Manuscript Study Pelican & Road Line (3.05s -> 4.92s)
  //    Uses the EXACT camera transform of `main.js` (`translate(960,540) -> scale(cam.scale) -> translate(-camX,-camY)`)
  //    and clips to `worldX < 0` so any wheel segment inside Frame #1 (`worldX >= 0`) immediately shows Tassili pigment!
  if (sketchPelAlpha > 0.002 && pelWorld) {
    ctx.save();
    ctx.translate(VIEW_W * 0.5, VIEW_H * 0.5);
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);

    // Clip manuscript ink overlay strictly to pre-frame world space (`x < 0`)
    ctx.beginPath();
    ctx.rect(-1400, -400, 1400, 1800);
    ctx.clip();

    // Archival sepia ink ground line aligned to exact ROAD_EDGE_Y = 680
    ctx.globalAlpha = sketchPelAlpha * 0.72;
    ctx.strokeStyle = 'rgba(72, 56, 38, 0.68)';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-900, ROAD_EDGE_Y);
    ctx.lineTo(0, ROAD_EDGE_Y);
    ctx.stroke();

    // Sepia cross-hatch ticks along the manuscript ground line
    ctx.lineWidth = 1.0;
    ctx.strokeStyle = 'rgba(92, 71, 48, 0.36)';
    for (let hx = -620; hx <= -12; hx += 18) {
      ctx.beginPath();
      ctx.moveTo(hx, ROAD_EDGE_Y);
      ctx.lineTo(hx - 9, ROAD_EDGE_Y + 12);
      ctx.stroke();
    }

    // Exact pixel-and-spoke-locked rig matching `main.js` `preRig` & `s01_sahara`!
    const worldX = pelWorld.worldX;
    const msRig = computePelicanRig({
      x: worldX,
      y: ROAD_EDGE_Y,
      pedalAngle: pelWorld.pedalAngle,
      wheelAngle: worldX / 46,
      scale: 1.0,
      speedScale: pelWorld.speedScale,
      time: t,
    });

    // Subtle construction dashed guide fading out as the sketch comes alive
    const guideAlpha = sketchPelAlpha * (1 - smoothstep(3.6, 4.35, t));
    if (guideAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha = guideAlpha;
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(110, 82, 52, 0.42)';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(msRig.frontWheel.x, msRig.frontWheel.y, msRig.frontWheel.r + 10, 0, Math.PI * 2);
      ctx.arc(msRig.rearWheel.x, msRig.rearWheel.y, msRig.rearWheel.r + 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Dual-pass sepia & graphite manuscript rig dissolving directly into the solid pigment rig below
    ctx.globalAlpha = sketchPelAlpha;
    for (let pass = 0; pass < 2; pass++) {
      ctx.save();
      ctx.translate((pass - 0.5) * 1.1, (0.5 - pass) * 0.9);
      drawRig2D(ctx, msRig, {
        featherFill: pass === 0 ? '#efe4cf' : 'transparent',
        featherShade: 'rgba(186, 166, 134, 0.65)',
        wingTipDark: 'rgba(72, 56, 38, 0.82)',
        beakFill: 'rgba(212, 162, 92, 0.68)',
        pouchFill: 'rgba(196, 132, 76, 0.65)',
        legFill: 'rgba(110, 84, 56, 0.78)',
        frameStroke: '#5c4228',
        metalStroke: '#6e5438',
        tireStroke: '#3e2e1e',
        inkOutline: pass === 0 ? '#2f2317' : 'rgba(92, 70, 48, 0.45)',
        lineScale: pass === 0 ? 0.92 : 0.5,
      });
      ctx.restore();
    }

    ctx.restore();
  }

  return true;
}
