// src/beat/camera.js
// Disciplined 60fps C2-continuous dolly camera along the 20-panel museum scroll.
// Zero roll, zero whip-pan, zero zoom-pumping ("严禁印度运镜"); smooth match-cut landings
// at Intro -> #01 (t=5.0s), #05 Song peak-to-trail zoom, #18->#19->#20 cinema curtains,
// and #20 -> Outro (t=125.0s).

import {
  INTRO_SEC,
  SCENE_SEC,
  NUM_SCENES,
  SCENES_TOTAL_SEC,
  PANEL_SIZE,
  clamp,
  lerp,
  smootherstep,
  getPelicanWorldState,
} from './timeline.js';

export const VIEW_W = 1920;
export const VIEW_H = 1080;
export const BASE_PANEL_SCALE = 0.95; // 950x950px framed artwork centered at (960, 540) when camY=500

/**
 * Ultra-subtle C3-smooth musical micro-breath (`<= 0.0045`, i.e. 0.45% max, zero bounce/pumping)
 * across interior frame crossings k = 1..19 (`t_cross = 5.0 + 6.0 * k`).
 * Strictly 0 at k = 0 (Intro -> #01) and k = 20 (#20 -> Outro).
 */
export function getFrameCrossingPulse(t) {
  let pulse = 0;
  for (let k = 1; k < NUM_SCENES; k++) {
    const tc = INTRO_SEC + k * SCENE_SEC;
    const dt = t - tc;
    if (dt > -0.24 && dt < 0.36) {
      const w = (dt + 0.24) / 0.6; // [0..1]
      const s = Math.sin(Math.PI * w);
      const s2 = s * s;
      pulse = Math.max(pulse, 0.0045 * s2 * s2);
    }
  }
  return pulse;
}

/**
 * Computes world-to-screen camera state for global time `t`:
 * - `camX, camY`: world coordinate placed at screen center (960, 540)
 * - `scale`: pixels per world unit
 * - `surroundDim`: [0..1] darkening outside Panel #19 during 9:16 cinema mode
 * - `curtainProgress`: [0..1] global C2 envelope for 16:9 -> 9:16 -> 16:9 velvet curtains
 * - `framePulse`: [0..0.0045] subtle musical micro-breath
 */
export function getCameraState(t) {
  const pel = getPelicanWorldState(t);

  // 1. Intro -> #01 C2-matched arrival (0.0s -> 5.0s):
  //    Starts calmly at camX = -100, then C2-accelerates from 3.80s -> 5.00s to hit
  //    camX(5.0) = 0, camX'(5.0) = 1000/6 px/s, camX''(5.0) = 0 — zero snap at t = 5.0s!
  if (t < INTRO_SEC) {
    const tcStart = 3.8;
    const dur = INTRO_SEC - tcStart; // 1.2s
    const s = clamp((t - tcStart) / dur, 0, 1);
    const s2 = s * s;
    const mCam = (PANEL_SIZE / SCENE_SEC) * dur; // 200px
    const camX = mCam * (-0.5 + s2 * s - 0.5 * s2 * s2); // -100 -> 0
    return {
      camX,
      camY: 500,
      scale: BASE_PANEL_SCALE,
      surroundDim: 0,
      curtainProgress: 0,
      framePulse: 0,
      introBlend: smootherstep(3.95, 4.96, t),
    };
  }

  // 2. Continuous Scroll Tracking (5.0s -> 125.0s+, extending cleanly through 125.4s cross-dissolve)
  const st = t - INTRO_SEC;
  let pulse = getFrameCrossingPulse(t);

  // Smooth C∞ harmonic framing lead that centers each 1000x1000 panel around Bar 2
  // while vanishing cleanly (with zero 1st & 2nd derivatives) at t = 5.0s and before #20's end.
  const framingEnv = smootherstep(5.0, 6.2, t) * (1 - smootherstep(122.0, 123.6, t));
  const framingOffset = 36 * Math.sin((2 * Math.PI * st) / SCENE_SEC) * framingEnv;
  let camX = pel.worldX + framingOffset;
  let camY = 500;
  let zoomMult = 1.0;
  let surroundDim = 0.0;

  // 3. #05 Northern Song Monumental Landscape (t ∈ [29.0, 35.0]):
  //    Compactly supported C2 quintic push-in/pull-back inside localT ∈ [0.82s, 5.22s]
  //    so both t = 29.0s (#04->#05) and t = 35.0s (#05->#06) are 100% kink-free at 1.0x!
  const songLocalT = t - (INTRO_SEC + 4 * SCENE_SEC); // t - 29.0
  if (songLocalT > 0.82 && songLocalT < 5.22) {
    const zoomEnv = smootherstep(0.82, 2.32, songLocalT) * (1 - smootherstep(3.88, 5.22, songLocalT));
    zoomMult = lerp(1.0, 2.95, zoomEnv);
    camX = lerp(camX, pel.worldX, zoomEnv * 0.94);
    camY = lerp(500, 745, zoomEnv * 0.88);
    pulse *= 1 - zoomEnv;
  }

  // 4. #18 -> #19 -> #20 Global Cinema Velvet Curtain (t ∈ [112.55s, 119.45s]):
  //    Smoothly closes 16:9 -> 9:16 across x = 18000 (113.0s) and re-opens 9:16 -> 16:9 across x = 19000 (119.0s)!
  const vertEnv = smootherstep(112.55, 113.35, t) * (1 - smootherstep(118.65, 119.45, t));
  if (vertEnv > 0) {
    const panel19Center = 18 * PANEL_SIZE + 500; // 18500
    camX = lerp(camX, panel19Center, vertEnv * 0.86);
    zoomMult *= lerp(1.0, 1.05, vertEnv);
    surroundDim = Math.max(surroundDim, 0.95 * vertEnv);
    pulse *= 1 - vertEnv;
  }

  // 5. #20 -> Outro Sub-Pixel Match-Cut Landing (t >= 122.2s):
  //    Settles C2-smoothly onto Panel #20's exact geometric center (19500, 500, scale=0.95)
  //    by t = 124.80s so Panel #20 maps to [485..1435] x [65..1015] with zero jump into Outro!
  const outroSettle = smootherstep(122.2, 124.8, t);
  if (outroSettle > 0) {
    const panel20Center = 19 * PANEL_SIZE + 500; // 19500
    camX = lerp(camX, panel20Center, outroSettle);
    pulse *= 1 - outroSettle;
  }

  const scale = BASE_PANEL_SCALE * zoomMult * (1 + pulse);

  return {
    camX,
    camY,
    scale,
    surroundDim,
    curtainProgress: vertEnv,
    framePulse: pulse,
    introBlend: 1,
  };
}

/**
 * Returns the indices of panels [0..19] whose framed bounds intersect the current 1920x1080 viewport.
 */
export function getVisiblePanelIndices(cam) {
  const halfW = (VIEW_W * 0.5) / cam.scale + 180; // generous margin for period mountings & scroll rollers
  const minWorldX = cam.camX - halfW;
  const maxWorldX = cam.camX + halfW;
  const i0 = clamp(Math.floor(minWorldX / PANEL_SIZE), 0, NUM_SCENES - 1);
  const i1 = clamp(Math.floor(maxWorldX / PANEL_SIZE), 0, NUM_SCENES - 1);
  const list = [];
  for (let i = i0; i <= i1; i++) list.push(i);
  return list;
}
