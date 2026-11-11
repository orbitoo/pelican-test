// src/main.js
// Master pure-function frame scheduler `renderAt(t)` for 《鹈鹕测试》 (Pelican Test).
// Supports both real-time interactive browser preview (index.html) and
// deterministic frame-by-frame / contact-sheet capture via CDP (render.html).

import {
  TOTAL_DURATION,
  INTRO_SEC,
  SCENES_TOTAL_SEC,
  PANEL_SIZE,
  ROAD_EDGE_Y,
  SCENES,
  clamp,
  lerp,
  smootherstep,
  getBeatState,
  getPelicanWorldState,
} from './beat/timeline.js';
import {
  VIEW_W,
  VIEW_H,
  getCameraState,
  getVisiblePanelIndices,
} from './beat/camera.js';
import { createKit } from './kit/kit.js';
import { drawPanelFrame } from './kit/frame.js';
import { renderThresholdMicroPhysics } from './kit/transitions.js';
import { computePelicanRig, drawRig2D } from './rig/pelican.js';
import { renderIntroOverlay } from './scenes/intro.js';
import { renderScenePanel } from './scenes/index.js';
import { renderOutro } from './scenes/outro.js';
import { createAudioEngine } from './audio/engine.js';

const params = new URLSearchParams(window.location.search);
const IS_RENDER_MODE = window.__PELICAN_RENDER_MODE__ === true || params.get('render') === '1';
const INITIAL_T = parseFloat(params.get('t') || '0') || 0;

let kit = null;
let overlay2D = null;
let audioEngine = null;
let currentT = clamp(INITIAL_T, 0, TOTAL_DURATION);
let isPlaying = false;
let lastWallMs = 0;

/**
 * Pure deterministic render of the entire 1920x1080 film frame at time `t` in [0, 137.0].
 */
function renderFilmFrame(p, brush, t) {
  const clampedT = clamp(t, 0, TOTAL_DURATION);
  const beatState = getBeatState(clampedT);

  // Reset seed per quantized millisecond so scrubbing or parallel rendering is 100% deterministic
  const frameSeed = ((Math.round(clampedT * 1000) + 1) * 2654435761) >>> 0;
  p.randomSeed(frameSeed);
  p.noiseSeed(frameSeed);

  // ---------------------------------------------------------------------------
  // Case A: Pure Outro (> 125.16s -> 137.0s) — 7x3 Exhibition Wall & Press Conference
  //         (124.86s..125.16s cross-dissolves live #20 into 1:1 registered Tile #20 via Case B below!)
  // ---------------------------------------------------------------------------
  const outroStart = INTRO_SEC + SCENES_TOTAL_SEC; // 125.0s
  if (clampedT > outroStart + 0.16) {
    overlay2D.clear();
    renderOutro(kit, overlay2D, clampedT, renderScenePanel);
    p.background(20, 18, 16);
    p.push();
    p.imageMode(p.CORNER);
    p.noTint();
    p.image(overlay2D, -VIEW_W / 2, -VIEW_H / 2, VIEW_W, VIEW_H);
    p.pop();
    return beatState;
  }

  // ---------------------------------------------------------------------------
  // Case B: Scroll World (0.0s -> 125.35s) + Intro Match-Cut & Outro Cross-Dissolve
  // ---------------------------------------------------------------------------
  const cam = getCameraState(clampedT);
  const pelWorld = getPelicanWorldState(clampedT);
  const visibleIndices = getVisiblePanelIndices(cam);

  // 1. Render each visible 1000x1000 era panel into a pooled slot BEFORE drawing main world
  const renderedPanels = visibleIndices.map((panelIdx, slotIdx) => {
    const scene = SCENES[panelIdx];
    const slot = kit.getSlot(slotIdx);
    slot.usedFb = false;
    slot.g2d.clear();

    const rawLocalT = clampedT - scene.t0;
    const panelLocalT = clamp(rawLocalT, 0, 6.0);
    const pelicanLocalX = pelWorld.worldX - scene.worldX0;

    renderScenePanel(kit, slot, scene, {
      t: clampedT,
      localT: panelLocalT,
      rawLocalT,
      pelicanLocalX,
      pedalAngle: pelWorld.pedalAngle,
      speedScale: pelWorld.speedScale,
      isOutroThumbnail: false,
    });

    return { scene, slot };
  });

  // 2. Gallery Wall Backdrop on 1920x1080 WEBGL canvas
  p.background(28, 25, 22);

  p.push();
  // Camera transform: world (cam.camX, cam.camY) maps to screen center (0, 0) in WEBGL!
  p.scale(cam.scale);
  p.translate(-cam.camX, -cam.camY);

  // Warm museum gallery wainscoting / wall band behind frames
  p.noStroke();
  p.fill(38, 34, 29);
  p.rect(-1400, -180, 22500, 1360);
  p.stroke(66, 58, 48);
  p.strokeWeight(2);
  p.line(-1400, 1028, 21200, 1028);

  // Pre-Frame-1 Entry Road (worldX in [-900, 0]) so Intro -> Frame #1 crossing is continuous!
  if (cam.camX < 1200) {
    p.stroke(118, 96, 68);
    p.strokeWeight(4);
    p.line(-900, ROAD_EDGE_Y, 0, ROAD_EDGE_Y);

    // If pelican's rear half is still in [-240, 0] while entering Frame #1, draw pre-frame half clipped to x < 0!
    if (pelWorld.visibleInScroll && pelWorld.worldX < 220) {
      const preSlot = kit.getSlot(3);
      preSlot.g2d.clear();
      const preCtx = preSlot.g2d.drawingContext;
      preCtx.save();
      const preRig = computePelicanRig({
        x: pelWorld.worldX + PANEL_SIZE, // map [-1000..0] -> [0..1000]
        y: ROAD_EDGE_Y,
        pedalAngle: pelWorld.pedalAngle,
        wheelAngle: pelWorld.worldX / 46, // exact spoke phase match to Intro & #01!
        scale: 1.0,
        speedScale: pelWorld.speedScale,
        time: clampedT,
      });
      drawRig2D(preCtx, preRig, {
        featherFill: '#f4ecdc',
        featherShade: '#d8ccb4',
        beakFill: '#d9912b',
        pouchFill: '#c96224',
        frameStroke: '#6d3920',
        inkOutline: '#292018',
      });
      preCtx.restore();
      p.imageMode(p.CORNER);
      p.image(preSlot.g2d, -PANEL_SIZE, 0, PANEL_SIZE, PANEL_SIZE);
    }
  }

  // 3. Composite visible 1000x1000 panel canvases onto the gallery wall
  p.imageMode(p.CORNER);
  p.noTint();
  for (const { scene, slot } of renderedPanels) {
    if (slot.usedFb) {
      p.image(slot.fb, scene.worldX0, 0, PANEL_SIZE, PANEL_SIZE);
    }
    p.image(slot.g2d, scene.worldX0, 0, PANEL_SIZE, PANEL_SIZE);
  }

  // 4. Period-Authentic Mountings & Borders (`画框/装裱/硬件外框`) drawn over panel seams
  for (const { scene } of renderedPanels) {
    const isActive = beatState.sceneIndex === scene.index;
    if (scene.id === 's19_shortvideo' && cam.surroundDim > 0.6) continue;
    drawPanelFrame(p, scene, isActive, cam.framePulse, kit);
  }

  // 5. Smooth Global Cinema Velvet Curtains (`16:9 -> 9:16 -> 16:9` around Panel #19 = x[18000..19000])
  if (cam.surroundDim > 0.005) {
    const panel19X0 = SCENES[18].worldX0; // 18000 — never snaps across 113.0s or 119.0s!
    const halfViewWorldW = (VIEW_W * 0.56) / cam.scale;
    const curtainSlide = smootherstep(0.0, 0.72, cam.curtainProgress ?? 1);
    const leftEdgeX = lerp(cam.camX - halfViewWorldW, panel19X0, curtainSlide);
    const rightEdgeX = lerp(cam.camX + halfViewWorldW, panel19X0 + PANEL_SIZE, curtainSlide);
    const curtainAlpha = Math.round(cam.surroundDim * 252);

    p.noStroke();
    p.fill(5, 5, 8, curtainAlpha);
    p.rect(leftEdgeX - 3000, -500, 3000, 2000);
    p.rect(rightEdgeX, -500, 3000, 2000);
    p.rect(leftEdgeX, -500, rightEdgeX - leftEdgeX, 500);
    p.rect(leftEdgeX, PANEL_SIZE, rightEdgeX - leftEdgeX, 500);
  }

  // 6. Localized Cross-Frame Medium Micro-Physics (`k = 0..19`, `t_cross = 5.0 + 6.0 * k`)
  renderThresholdMicroPhysics(p, kit, clampedT, cam, pelWorld);

  p.pop();

  // 7. Intro Archival Documentary Overlay & 1:1 Single-Pelican Match-Cut (0.0s -> 5.0s)
  if (clampedT < INTRO_SEC) {
    overlay2D.clear();
    const drewIntro = renderIntroOverlay(kit, overlay2D, clampedT, cam, pelWorld);
    if (drewIntro) {
      p.push();
      p.imageMode(p.CORNER);
      p.noTint();
      p.image(overlay2D, -VIEW_W / 2, -VIEW_H / 2, VIEW_W, VIEW_H);
      p.pop();
    }
  }

  // 8. #20 -> Outro 1:1 Registered Live-Continuation Cross-Dissolve (124.86s -> 125.14s)
  if (clampedT >= outroStart - 0.14) {
    const outroBlend = smootherstep(outroStart - 0.14, outroStart + 0.14, clampedT);
    if (outroBlend > 0.002) {
      overlay2D.clear();
      renderOutro(kit, overlay2D, clampedT, renderScenePanel);
      p.push();
      p.imageMode(p.CORNER);
      p.tint(255, Math.round(outroBlend * 255));
      p.image(overlay2D, -VIEW_W / 2, -VIEW_H / 2, VIEW_W, VIEW_H);
      p.noTint();
      p.pop();
    }
  }

  return beatState;
}

// =============================================================================
// Bootstrapping p5.js + p5.brush & UI Binding
// =============================================================================
async function boot() {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }

  const brush = window.brush;
  const P5 = window.p5;

  const sketch = (p) => {
    if (brush?.instance) {
      brush.instance(p);
    }

    p.setup = () => {
      p.pixelDensity(1);
      const cnv = p.createCanvas(VIEW_W, VIEW_H, p.WEBGL);
      const host = document.getElementById('canvas-host');
      if (host) cnv.parent(host);

      kit = createKit(p, brush);
      window.__PELICAN_KIT__ = kit;
      overlay2D = p.createGraphics(VIEW_W, VIEW_H);
      overlay2D.pixelDensity(1);

      if (IS_RENDER_MODE) {
        p.noLoop();
      } else {
        p.frameRate(60);
      }

      // Initial deterministic render
      const st = renderFilmFrame(p, brush, currentT);
      updatePreviewHUD(st);
      window.__PELICAN_READY__ = true;
    };

    p.draw = () => {
      if (!IS_RENDER_MODE && isPlaying) {
        if (audioEngine && audioEngine.isPlaying()) {
          currentT = audioEngine.getCurrentTime();
          lastWallMs = performance.now();
        } else {
          const now = performance.now();
          const dt = Math.min(0.1, (now - lastWallMs) / 1000);
          lastWallMs = now;
          currentT += dt;
        }
        if (currentT >= TOTAL_DURATION) {
          currentT = TOTAL_DURATION;
          setPlaying(false, { fromEnded: true });
        }
      }
      const st = renderFilmFrame(p, brush, currentT);
      if (!IS_RENDER_MODE) {
        updatePreviewHUD(st);
      }
    };

    // Offscreen 2D readout canvas so frame capture reads pure WebGL pixels synchronously
    // right after `await p.redraw()` — immune to browser extensions and WebGL buffer swap!
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = VIEW_W;
    exportCanvas.height = VIEW_H;
    const exportCtx = exportCanvas.getContext('2d');

    // Deterministic external API for Puppeteer CDP tools (`shot.mjs`, `sheet.mjs`, `render.mjs`)
    window.renderAt = async (t) => {
      currentT = clamp(Number(t) || 0, 0, TOTAL_DURATION);
      if (!IS_RENDER_MODE && audioEngine) {
        audioEngine.seek(currentT);
      }
      await p.redraw();
      return getBeatState(currentT);
    };

    window.renderFrameAt = async (t) => {
      currentT = clamp(Number(t) || 0, 0, TOTAL_DURATION);
      await p.redraw();
      const gl = p.drawingContext;
      if (gl?.finish) gl.finish();
      exportCtx.clearRect(0, 0, VIEW_W, VIEW_H);
      exportCtx.drawImage(p.canvas, 0, 0, VIEW_W, VIEW_H);
      return getBeatState(currentT);
    };

    window.captureFrameAt = async (t, mime = 'image/png', quality = 0.94) => {
      await window.renderFrameAt(t);
      const dataUrl = exportCanvas.toDataURL(mime, quality);
      return dataUrl.split(',')[1];
    };

    window.__PELICAN_EXPORT_CANVAS__ = exportCanvas;
  };

  // eslint-disable-next-line no-new
  new P5(sketch);
  if (!IS_RENDER_MODE) {
    audioEngine = createAudioEngine();
    window.__pelicanAudioEngine = audioEngine;
    if (currentT > 0) {
      audioEngine.seek(currentT);
    }
    initPreviewControls();
    updateAudioHUD();
    audioEngine.onReady(() => updateAudioHUD());
    audioEngine.onEnded(() => {
      currentT = TOTAL_DURATION;
      setPlaying(false, { fromEnded: true });
    });
    audioEngine.init().catch((err) => {
      console.warn('[audio] background soundtrack hydration warning:', err);
    });
  }
}

function formatMMSS(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
}

function updateAudioHUD() {
  const muteBtn = document.getElementById('btn-mute');
  const volSlider = document.getElementById('volume-slider');
  const statusEl = document.getElementById('audio-status');
  if (!audioEngine) return;

  const muted = audioEngine.isMuted();
  const vol = audioEngine.getVolume();
  if (muteBtn) {
    const icon = muted || vol <= 0.001 ? '🔇' : vol < 0.45 ? '🔉' : '🔊';
    muteBtn.textContent = muted || vol <= 0.001 ? `${icon} 静音` : `${icon} 音量`;
  }
  if (volSlider && document.activeElement !== volSlider) {
    volSlider.value = muted ? '0' : vol.toFixed(2);
  }
  if (statusEl) {
    if (audioEngine.isReady()) {
      statusEl.textContent = '合成音轨就绪';
      statusEl.classList.remove('is-loading');
      statusEl.classList.add('is-ready');
    } else {
      statusEl.textContent = '音轨合成中…';
      statusEl.classList.add('is-loading');
      statusEl.classList.remove('is-ready');
    }
  }
}

function setPlaying(nextState, opts = {}) {
  if (nextState && currentT >= TOTAL_DURATION - 0.01) {
    currentT = 0;
    if (audioEngine) audioEngine.seek(0);
  }
  isPlaying = nextState;
  lastWallMs = performance.now();
  const btn = document.getElementById('btn-play');
  if (btn) btn.textContent = isPlaying ? '暂停 ⏸' : '播放 ▶';

  if (audioEngine) {
    if (isPlaying) {
      audioEngine.play(currentT).catch((err) => {
        console.warn('[audio] play warning:', err);
      });
    } else if (!opts.fromEnded) {
      audioEngine.pause();
    }
  }
}

function updatePreviewHUD(beatState) {
  const scrubber = document.getElementById('scrubber');
  const timeEl = document.getElementById('time-readout');
  const badgeEl = document.getElementById('era-badge');
  if (scrubber && document.activeElement !== scrubber) {
    scrubber.value = beatState.t.toFixed(3);
  }
  if (timeEl) {
    timeEl.textContent = `${formatMMSS(beatState.t)} / 02:17.0`;
  }
  if (badgeEl) {
    if (beatState.section === 'intro') {
      badgeEl.textContent = 'Intro · 鹈鹕骑行艺术通史';
    } else if (beatState.section === 'outro') {
      badgeEl.textContent = 'Outro · 新闻发布会（20 份答卷）';
    } else if (beatState.scene) {
      const s = beatState.scene;
      badgeEl.textContent = `#${String(s.num).padStart(2, '0')} ${s.zh} (${s.era}) · 第${beatState.barInScene + 1}小节`;
    }
  }
}

function initPreviewControls() {
  const btn = document.getElementById('btn-play');
  const scrubber = document.getElementById('scrubber');
  const jump = document.getElementById('scene-jump');
  const muteBtn = document.getElementById('btn-mute');
  const volSlider = document.getElementById('volume-slider');
  const fsBtn = document.getElementById('btn-fullscreen');
  const stageWrap = document.getElementById('stage-wrap');

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }
  if (fsBtn) {
    fsBtn.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => {
      fsBtn.textContent = document.fullscreenElement ? '⛶ 退出全屏' : '⛶ 全屏';
    });
  }
  if (stageWrap) {
    stageWrap.addEventListener('click', () => setPlaying(!isPlaying));
  }

  if (jump) {
    const optIntro = document.createElement('option');
    optIntro.value = '0';
    optIntro.textContent = '00 · Intro (0:00)';
    jump.appendChild(optIntro);

    for (const s of SCENES) {
      const opt = document.createElement('option');
      opt.value = String(s.t0);
      opt.textContent = `${String(s.num).padStart(2, '0')} · ${s.zh} (${formatMMSS(s.t0)})`;
      jump.appendChild(opt);
    }

    const optOutro = document.createElement('option');
    optOutro.value = '125';
    optOutro.textContent = '21 · Outro 发布会 (2:05)';
    jump.appendChild(optOutro);

    jump.addEventListener('change', () => {
      const targetT = parseFloat(jump.value) || 0;
      window.renderAt(targetT);
    });
  }

  if (btn) {
    btn.addEventListener('click', () => setPlaying(!isPlaying));
  }
  if (scrubber) {
    scrubber.max = String(TOTAL_DURATION);
    scrubber.addEventListener('input', () => {
      if (isPlaying) setPlaying(false);
      window.renderAt(parseFloat(scrubber.value) || 0);
    });
  }
  if (muteBtn) {
    muteBtn.addEventListener('click', () => {
      if (!audioEngine) return;
      audioEngine.toggleMute();
      updateAudioHUD();
    });
  }
  if (volSlider) {
    volSlider.addEventListener('input', () => {
      if (!audioEngine) return;
      const v = parseFloat(volSlider.value);
      audioEngine.setVolume(Number.isFinite(v) ? v : 0.9);
      if (v <= 0.001) audioEngine.setMuted(true);
      updateAudioHUD();
    });
  }
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const inFormControl = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (e.code === 'Space' && !inFormControl) {
      e.preventDefault();
      setPlaying(!isPlaying);
    } else if (e.code === 'KeyF' && !inFormControl && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      toggleFullscreen();
    } else if (e.code === 'KeyM' && !inFormControl) {
      e.preventDefault();
      if (audioEngine) {
        audioEngine.toggleMute();
        updateAudioHUD();
      }
    } else if (e.code === 'ArrowRight' && !inFormControl) {
      e.preventDefault();
      const target = clamp(currentT + (e.shiftKey ? 2.0 : 0.5), 0, TOTAL_DURATION);
      if (isPlaying) {
        currentT = target;
        audioEngine?.seek(target);
      } else {
        window.renderAt(target);
      }
    } else if (e.code === 'ArrowLeft' && !inFormControl) {
      e.preventDefault();
      const target = clamp(currentT - (e.shiftKey ? 2.0 : 0.5), 0, TOTAL_DURATION);
      if (isPlaying) {
        currentT = target;
        audioEngine?.seek(target);
      } else {
        window.renderAt(target);
      }
    }
  });
}

boot();
