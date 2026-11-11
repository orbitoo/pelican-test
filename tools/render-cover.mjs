// tools/render-cover.mjs
// Renders museum/cinema-grade video covers (16:9 1920x1080, 4:3 1600x1200, and 1280x720 OG card)
// directly from the live `r3` procedural scene renderers over the persistent Chrome CDP bridge.

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';

async function main() {
  const outDir = path.resolve(PROJECT_ROOT, 'out');
  const publicDir = path.resolve(PROJECT_ROOT, 'public');
  fs.mkdirSync(outDir, { recursive: true });

  const srv = await startStaticServer(0, '127.0.0.1', { guardMidEditScenes: false });
  try {
    await withCDPBrowser(async ({ openRenderPage }) => {
      const page = await openRenderPage(`${srv.baseUrl}/render.html`, 1920, 1080);

      const results = await page.evaluate(async () => {
        const { SCENES } = await import('./src/beat/timeline.js');
        const { renderScenePanel } = await import('./src/scenes/index.js');
        const kit = window.__PELICAN_KIT__;
        const p = kit.p;

        if (document.fonts?.ready) {
          await document.fonts.ready;
        }

        // Helper: render any scene into a standalone 1000x1000 2D canvas
        function bakeSceneCanvas(sceneId, opts = {}) {
          const scene = SCENES.find((s) => s.id === sceneId);
          const slot = kit.getSlot(0);
          slot.usedFb = false;
          slot.g2d.clear();

          const localT = opts.localT ?? 3.0;
          const pelicanLocalX = opts.pelicanLocalX ?? 500;
          const pedalAngle = opts.pedalAngle ?? 0.72;
          const speedScale = opts.speedScale ?? 1.0;
          const t = scene.t0 + localT;

          const frameSeed = ((Math.round(t * 1000) + 1) * 2654435761) >>> 0;
          p.randomSeed(frameSeed);
          p.noiseSeed(frameSeed);

          renderScenePanel(kit, slot, scene, {
            t,
            localT,
            rawLocalT: localT,
            barIndex: Math.min(2, Math.floor(localT / 2.0)),
            barPhase: (localT % 2.0) / 2.0,
            pelicanLocalX,
            pedalAngle,
            speedScale,
            isOutroThumbnail: Boolean(opts.isOutroThumbnail),
          });

          const cnv = document.createElement('canvas');
          cnv.width = 1000;
          cnv.height = 1000;
          const c = cnv.getContext('2d');
          if (slot.usedFb && slot.fb) {
            const tmp = p.createGraphics(1000, 1000);
            tmp.pixelDensity(1);
            tmp.image(slot.fb, 0, 0, 1000, 1000);
            c.drawImage(tmp.canvas, 0, 0);
            tmp.remove();
          }
          c.drawImage(slot.g2d.canvas, 0, 0);
          return { canvas: cnv, scene };
        }

        // 1. Render the 4 co-registered Hero Shards (`pelicanLocalX = 500`, `pedalAngle = 0.72`)
        // - #04 Tang (`localT = 2.65`): full billowing "吴带当风" silk ribbons trailing behind rear wheel
        // - #11 Ukiyo-e (`localT = 1.45`): crisp Hokusai Prussian-blue wave foam & woodblock rear triangle
        // - #12 Starry Night (`localT = 3.05`): rich swirling cobalt sky & golden impasto pelican head/eye
        // - #20 Code (`localT = 4.95`): Act III 100% solid Delaunay amber beak + titanium wheel + harmonic orbits (no clipped tooltip!)
        const heroTang = bakeSceneCanvas('s04_tang', { localT: 2.65, pelicanLocalX: 500, pedalAngle: 0.72 });
        const heroUkiyoe = bakeSceneCanvas('s11_ukiyoe', { localT: 1.45, pelicanLocalX: 500, pedalAngle: 0.72 });
        const heroStarry = bakeSceneCanvas('s12_starry', { localT: 3.05, pelicanLocalX: 500, pedalAngle: 0.72 });
        const heroCodeAct3 = bakeSceneCanvas('s20_code', { localT: 4.95, pelicanLocalX: 500, pedalAngle: 0.72 });

        // Enhance Shard 4 (`#20`) around beak tip `(628, 526)` & front wheel `(586, 634)` with crisp
        // harmonic Fourier epicycle circles + rotating vector chain (`Σ c_k · exp(i k ω t)`)!
        const heroCode = document.createElement('canvas');
        heroCode.width = 1000;
        heroCode.height = 1000;
        {
          const cc = heroCode.getContext('2d');
          cc.drawImage(heroCodeAct3.canvas, 0, 0);

          // Draw multi-harmonic Fourier epicycle vector chain converging precisely onto the beak hook `(636, 520)`
          const epicycleRadii = [88, 46, 25, 14, 8, 4.5];
          const epicycleAngles = [-0.52, 1.18, -2.05, 0.64, 2.45, -1.1];
          // Work backwards from tip `(636, 522)` so the vector chain lands on the exact beak tip!
          const tipX = 636;
          const tipY = 522;
          let sumDx = 0;
          let sumDy = 0;
          for (let k = 0; k < epicycleRadii.length; k++) {
            sumDx += epicycleRadii[k] * Math.cos(epicycleAngles[k]);
            sumDy += epicycleRadii[k] * Math.sin(epicycleAngles[k]);
          }
          let cx = tipX - sumDx;
          let cy = tipY - sumDy;

          cc.save();
          for (let k = 0; k < epicycleRadii.length; k++) {
            const r = epicycleRadii[k];
            const ang = epicycleAngles[k];
            const nx = cx + r * Math.cos(ang);
            const ny = cy + r * Math.sin(ang);

            // Harmonic orbit circle
            cc.strokeStyle = k === 0 ? 'rgba(110, 232, 255, 0.46)' : 'rgba(255, 214, 122, 0.52)';
            cc.lineWidth = k === 0 ? 1.6 : 1.25;
            cc.setLineDash(k % 2 === 1 ? [4, 3] : []);
            cc.beginPath();
            cc.arc(cx, cy, r, 0, Math.PI * 2);
            cc.stroke();
            cc.setLineDash([]);

            // Rotating harmonic vector arrow
            cc.strokeStyle = 'rgba(155, 245, 255, 0.90)';
            cc.lineWidth = 1.8;
            cc.beginPath();
            cc.moveTo(cx, cy);
            cc.lineTo(nx, ny);
            cc.stroke();

            cc.fillStyle = k === epicycleRadii.length - 1 ? '#fff7d6' : '#7aeaff';
            cc.beginPath();
            cc.arc(nx, ny, k === epicycleRadii.length - 1 ? 4.2 : 2.4, 0, Math.PI * 2);
            cc.fill();

            cx = nx;
            cy = ny;
          }

          // Glowing gold-cyan Fourier trace arc sweeping from the beak tip
          cc.shadowColor = 'rgba(115, 238, 255, 0.85)';
          cc.shadowBlur = 12;
          cc.strokeStyle = '#fff2be';
          cc.lineWidth = 2.4;
          cc.beginPath();
          for (let s = 0; s <= 40; s++) {
            const th = (s / 40) * 1.35;
            const px = tipX + 42 * Math.sin(th * 1.7) + 14 * Math.cos(th * 3.2) - 14;
            const py = tipY + 36 * (1 - Math.cos(th * 1.4)) - 8 * Math.sin(th * 2.6);
            if (s === 0) cc.moveTo(px, py);
            else cc.lineTo(px, py);
          }
          cc.stroke();
          cc.shadowBlur = 0;
          cc.restore();
        }

        // 2. Render 10 miniature exhibition thumbnails for the archival filmstrip
        const stripIds = [
          's01_sahara',
          's02_egypt',
          's05_song',
          's06_qingming',
          's08_mughal',
          's09_bada',
          's10_wayang',
          's14_nosferatu',
          's16_8bit',
          's18_vaporwave',
        ];
        const stripTiles = stripIds.map((id) =>
          bakeSceneCanvas(id, {
            localT: 3.0,
            pelicanLocalX: id === 's16_8bit' ? 320 : 500,
            pedalAngle: 0.72,
          })
        );

        function drawCinnabarSeal(ctx, x, y, size, chars) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(-0.025);
          ctx.fillStyle = '#b22a1d';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
          ctx.shadowBlur = 10;
          ctx.shadowOffsetY = 3;
          ctx.beginPath();
          ctx.roundRect(0, 0, size, size, 4);
          ctx.fill();
          ctx.shadowColor = 'transparent';

          ctx.strokeStyle = 'rgba(252, 236, 214, 0.88)';
          ctx.lineWidth = 2.2;
          ctx.strokeRect(3.5, 3.5, size - 7, size - 7);

          ctx.fillStyle = '#faefe0';
          ctx.font = `700 ${Math.round(size * 0.36)}px "PelicanSerif", serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const q1 = size * 0.31;
          const q2 = size * 0.70;
          ctx.fillText(chars[0], q2, q1);
          ctx.fillText(chars[1], q2, q2);
          ctx.fillText(chars[2], q1, q1);
          ctx.fillText(chars[3], q1, q2);
          ctx.restore();
        }

        function fillTrackedText(ctx, text, x, y, trackingPx) {
          let curX = x;
          for (const ch of text) {
            ctx.fillText(ch, curX, y);
            curX += ctx.measureText(ch).width + trackingPx;
          }
          return curX - x;
        }

        function drawDiagonalHeroStage(ctx, dstX, dstY, dstW, dstH, opts = {}) {
          const zoom = opts.zoom ?? 1.84;
          const focusPanelX = opts.focusPanelX ?? 505;
          const focusPanelY = opts.focusPanelY ?? 548;
          const pelicanScreenX = dstX + dstW * (opts.pelicanRelX ?? 0.54);
          const pelicanScreenY = dstY + dstH * (opts.pelicanRelY ?? 0.55);

          const shards = [
            {
              canvas: heroTang.canvas,
              roadDy: -2.4,
              label: '04 · 吴道子白描',
            },
            {
              canvas: heroUkiyoe.canvas,
              roadDy: -14.0,
              label: '11 · 江户浮世绘',
            },
            {
              canvas: heroStarry.canvas,
              roadDy: +8.0,
              label: '12 · 梵高星月夜',
            },
            {
              canvas: heroCode,
              roadDy: 0.0,
              label: '20 · 傅立叶代码',
            },
          ];

          // Carefully tuned diagonal shard splits:
          // - Shard 1 (`< -96*zoom`): Rear wheel rim + sweeping Tang Baimiao ribbons
          // - Shard 2 (`-96..-24*zoom`): Rear frame + Hokusai Prussian-blue wave foam
          // - Shard 3 (`-24..+56*zoom`): Unified Pelican head, eye, neck, torso & impasto handlebars
          // - Shard 4 (`> +56*zoom`): Front half of beak/pouch morphing into Delaunay amber mesh + Fourier epicycles + titanium front wheel!
          const slantSlope = -0.18;
          const s1Mid = pelicanScreenX - 96 * zoom;
          const s2Mid = pelicanScreenX - 24 * zoom;
          const s3Mid = pelicanScreenX + 56 * zoom;

          function seamXAtY(midX, y) {
            return midX + (y - pelicanScreenY) * slantSlope;
          }

          const bounds = [
            { leftFn: () => dstX - 20, rightFn: (y) => seamXAtY(s1Mid, y) },
            { leftFn: (y) => seamXAtY(s1Mid, y), rightFn: (y) => seamXAtY(s2Mid, y) },
            { leftFn: (y) => seamXAtY(s2Mid, y), rightFn: (y) => seamXAtY(s3Mid, y) },
            { leftFn: (y) => seamXAtY(s3Mid, y), rightFn: () => dstX + dstW + 20 },
          ];

          ctx.save();
          ctx.beginPath();
          ctx.rect(dstX, dstY, dstW, dstH);
          ctx.clip();

          for (let i = 0; i < shards.length; i++) {
            const sh = shards[i];
            const b = bounds[i];
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(b.leftFn(dstY), dstY);
            ctx.lineTo(b.rightFn(dstY), dstY);
            ctx.lineTo(b.rightFn(dstY + dstH), dstY + dstH);
            ctx.lineTo(b.leftFn(dstY + dstH), dstY + dstH);
            ctx.closePath();
            ctx.clip();

            const drawW = 1000 * zoom;
            const drawH = 1000 * zoom;
            const dx = pelicanScreenX - focusPanelX * zoom;
            const dy = pelicanScreenY - (focusPanelY + sh.roadDy) * zoom;
            ctx.drawImage(sh.canvas, dx, dy, drawW, drawH);
            if (i === 3) {
              // Screen-space right-aligned Fourier formula safely inside the right margin
              const fx = dstX + dstW - 34;
              const fy = dstY + Math.round(dstH * 0.27);
              ctx.fillStyle = 'rgba(170, 238, 255, 0.82)';
              ctx.font = '600 18px "PelicanMono", monospace';
              ctx.textAlign = 'right';
              ctx.textBaseline = 'alphabetic';
              ctx.fillText('f(t) = Σ c_k · exp(i·k·ω·t)', fx, fy);
              ctx.fillStyle = 'rgba(245, 212, 138, 0.68)';
              ctx.font = '500 13px "PelicanMono", monospace';
              ctx.fillText('K = 36 HARMONICS · PURE JS', fx, fy + 24);
            }
            ctx.restore();
          }

          // Luminous fracture hairlines along the 3 era seams
          const seamMids = [
            { mid: s1Mid, col: 'rgba(235, 198, 132, 0.88)', glow: 'rgba(235, 198, 132, 0.36)' },
            { mid: s2Mid, col: 'rgba(250, 222, 158, 0.92)', glow: 'rgba(250, 222, 158, 0.44)' },
            { mid: s3Mid, col: 'rgba(118, 236, 255, 0.94)', glow: 'rgba(80, 215, 255, 0.52)' },
          ];
          for (const sm of seamMids) {
            ctx.save();
            ctx.strokeStyle = sm.glow;
            ctx.lineWidth = 6;
            ctx.beginPath();
            ctx.moveTo(seamXAtY(sm.mid, dstY), dstY);
            ctx.lineTo(seamXAtY(sm.mid, dstY + dstH), dstY + dstH);
            ctx.stroke();

            ctx.strokeStyle = sm.col;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(seamXAtY(sm.mid, dstY), dstY);
            ctx.lineTo(seamXAtY(sm.mid, dstY + dstH), dstY + dstH);
            ctx.stroke();
            ctx.restore();
          }

          if (opts.showTopBadges !== false) {
            const badgeY = dstY + 26;
            const x1 = seamXAtY(s1Mid, badgeY);
            const x2 = seamXAtY(s2Mid, badgeY);
            const x3 = seamXAtY(s3Mid, badgeY);
            const shardCenters = [
              x1 - 76,
              (x1 + x2) * 0.5,
              (x2 + x3) * 0.5,
              x3 + 84,
            ];
            ctx.font = '600 13px "PelicanSans", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            for (let i = 0; i < shards.length; i++) {
              const cx = shardCenters[i];
              const label = shards[i].label;
              const tw = ctx.measureText(label).width + 18;
              ctx.fillStyle = 'rgba(14, 12, 10, 0.80)';
              ctx.strokeStyle = i === 3 ? 'rgba(110, 232, 255, 0.58)' : 'rgba(226, 188, 125, 0.54)';
              ctx.lineWidth = 1.1;
              ctx.beginPath();
              ctx.roundRect(cx - tw / 2, badgeY - 12, tw, 24, 12);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = i === 3 ? '#c6f6ff' : '#f5e8cf';
              ctx.fillText(label, cx, badgeY + 0.5);
            }
          }

          ctx.restore();
        }

        // =====================================================================
        // COVER A: 16:9 Master Cover (`1920 x 1080`)
        // =====================================================================
        const c16 = document.createElement('canvas');
        c16.width = 1920;
        c16.height = 1080;
        {
          const ctx = c16.getContext('2d');
          ctx.fillStyle = '#0c0a09';
          ctx.fillRect(0, 0, 1920, 1080);

          drawDiagonalHeroStage(ctx, 540, 0, 1380, 916, {
            zoom: 1.84,
            focusPanelX: 505,
            focusPanelY: 548,
            pelicanRelX: 0.55,
            pelicanRelY: 0.55,
            showTopBadges: true,
          });

          // Velvet obsidian left & bottom vignette
          const leftGrad = ctx.createLinearGradient(0, 0, 1030, 0);
          leftGrad.addColorStop(0.0, '#0b0908');
          leftGrad.addColorStop(0.55, 'rgba(11, 9, 8, 0.95)');
          leftGrad.addColorStop(0.76, 'rgba(11, 9, 8, 0.58)');
          leftGrad.addColorStop(1.0, 'rgba(11, 9, 8, 0.0)');
          ctx.fillStyle = leftGrad;
          ctx.fillRect(0, 0, 1050, 925);

          const botGrad = ctx.createLinearGradient(0, 770, 0, 930);
          botGrad.addColorStop(0.0, 'rgba(11, 9, 8, 0.0)');
          botGrad.addColorStop(0.72, 'rgba(11, 9, 8, 0.90)');
          botGrad.addColorStop(1.0, '#0b0908');
          ctx.fillStyle = botGrad;
          ctx.fillRect(0, 770, 1920, 310);

          // Museum outer gilt hairline
          ctx.strokeStyle = 'rgba(218, 178, 115, 0.30)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(22, 20, 1876, 1040);

          const leftX = 86;

          // Eyebrow pill
          ctx.fillStyle = 'rgba(218, 174, 108, 0.14)';
          ctx.strokeStyle = 'rgba(218, 174, 108, 0.48)';
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.roundRect(leftX, 92, 412, 34, 17);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#e5be82';
          ctx.font = '700 14px "PelicanMono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText('100% PURE CODE FILM  ·  p5.js + WEB AUDIO', leftX + 18, 109.5);

          // Main Title: 鹈鹕测试
          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
          ctx.shadowBlur = 28;
          ctx.shadowOffsetY = 8;
          const titleGrad = ctx.createLinearGradient(leftX, 165, leftX, 315);
          titleGrad.addColorStop(0.0, '#fffaf0');
          titleGrad.addColorStop(0.62, '#f7ebd4');
          titleGrad.addColorStop(1.0, '#dfc092');
          ctx.fillStyle = titleGrad;
          ctx.font = '900 138px "PelicanSerif", serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          fillTrackedText(ctx, '鹈鹕测试', leftX - 4, 292, 6);
          ctx.restore();

          drawCinnabarSeal(ctx, leftX + 594, 186, 68, ['纯', '码', '造', '像']);

          ctx.fillStyle = '#d6ac6e';
          ctx.font = '600 22px "PelicanSerif", serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          fillTrackedText(ctx, 'THE PELICAN TEST', leftX + 4, 344, 8.5);

          const ruleGrad = ctx.createLinearGradient(leftX, 0, leftX + 560, 0);
          ruleGrad.addColorStop(0.0, 'rgba(226, 186, 120, 0.85)');
          ruleGrad.addColorStop(0.75, 'rgba(226, 186, 120, 0.32)');
          ruleGrad.addColorStop(1.0, 'rgba(226, 186, 120, 0.0)');
          ctx.strokeStyle = ruleGrad;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(leftX + 16, 382);
          ctx.lineTo(leftX + 560, 382);
          ctx.stroke();

          ctx.fillStyle = '#e5be82';
          ctx.beginPath();
          ctx.moveTo(leftX + 6, 376);
          ctx.lineTo(leftX + 12, 382);
          ctx.lineTo(leftX + 6, 388);
          ctx.lineTo(leftX, 382);
          ctx.closePath();
          ctx.fill();

          ctx.save();
          ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
          ctx.shadowBlur = 16;
          ctx.fillStyle = '#f6ecda';
          ctx.font = '700 40px "PelicanWenKai", "PelicanSerif", serif';
          ctx.fillText('一只骑单车的鹈鹕', leftX + 2, 448);

          ctx.fillStyle = '#edd5ab';
          ctx.font = '700 36px "PelicanWenKai", "PelicanSerif", serif';
          ctx.fillText('横穿 6000 年艺术史的 20 道画框', leftX + 2, 504);
          ctx.restore();

          const specs = ['零外部图片与音频素材', '20 时代原声合成', '60fps 实时渲染'];
          let pillX = leftX;
          const pillY = 554;
          ctx.font = '600 17px "PelicanSans", sans-serif';
          ctx.textBaseline = 'middle';
          for (const sp of specs) {
            const pw = ctx.measureText(sp).width + 28;
            ctx.fillStyle = 'rgba(30, 25, 20, 0.82)';
            ctx.strokeStyle = 'rgba(216, 174, 110, 0.42)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(pillX, pillY, pw, 36, 6);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#ead8ba';
            ctx.textAlign = 'left';
            ctx.fillText(sp, pillX + 14, pillY + 18.5);
            pillX += pw + 12;
          }

          // Bottom 10-Era Exhibition Filmstrip (`x = 86..1634`, keeping bottom-right badge area clear!)
          ctx.fillStyle = '#b99968';
          ctx.font = '600 13px "PelicanMono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('EXHIBITION INDEX  ·  20 ERAS FROM 4000 BCE TO 2020s', leftX + 2, 874);

          const tileW = 144;
          const tileH = 118;
          const tileGap = 12;
          const stripY = 894;
          for (let i = 0; i < stripTiles.length; i++) {
            const tx = leftX + i * (tileW + tileGap);
            const { canvas: tCanvas, scene } = stripTiles[i];

            ctx.save();
            ctx.fillStyle = '#171411';
            ctx.beginPath();
            ctx.roundRect(tx, stripY, tileW, tileH, 4);
            ctx.fill();
            ctx.clip();

            ctx.drawImage(tCanvas, 140, 175, 720, 590, tx, stripY, tileW, tileH);

            const tg = ctx.createLinearGradient(0, stripY + tileH - 34, 0, stripY + tileH);
            tg.addColorStop(0, 'rgba(10, 9, 8, 0.0)');
            tg.addColorStop(1, 'rgba(10, 9, 8, 0.88)');
            ctx.fillStyle = tg;
            ctx.fillRect(tx, stripY + tileH - 34, tileW, 34);

            ctx.fillStyle = '#f3e7d0';
            ctx.font = '600 12px "PelicanSans", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(
              `${String(scene.num).padStart(2, '0')} ${scene.zh}`,
              tx + 7,
              stripY + tileH - 7
            );
            ctx.restore();

            ctx.strokeStyle = 'rgba(218, 178, 115, 0.48)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(tx, stripY, tileW, tileH, 4);
            ctx.stroke();
          }
        }

        // =====================================================================
        // COVER B: 4:3 Dedicated Bilibili Feed Cover (`1600 x 1200`)
        // =====================================================================
        const c43 = document.createElement('canvas');
        c43.width = 1600;
        c43.height = 1200;
        {
          const ctx = c43.getContext('2d');
          ctx.fillStyle = '#0c0a09';
          ctx.fillRect(0, 0, 1600, 1200);

          drawDiagonalHeroStage(ctx, 48, 272, 1504, 738, {
            zoom: 1.74,
            focusPanelX: 500,
            focusPanelY: 545,
            pelicanRelX: 0.52,
            pelicanRelY: 0.56,
            showTopBadges: true,
          });

          ctx.strokeStyle = 'rgba(222, 182, 118, 0.62)';
          ctx.lineWidth = 2;
          ctx.strokeRect(48, 272, 1504, 738);

          ctx.strokeStyle = 'rgba(218, 178, 115, 0.28)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(20, 20, 1560, 1160);

          ctx.fillStyle = '#dcb274';
          ctx.font = '700 15px "PelicanMono", monospace';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('100% PURE CODE SHORT FILM  ·  p5.js + WEB AUDIO', 54, 72);

          const titleGrad = ctx.createLinearGradient(54, 90, 54, 225);
          titleGrad.addColorStop(0.0, '#fffaf0');
          titleGrad.addColorStop(0.65, '#f6ead2');
          titleGrad.addColorStop(1.0, '#dfc092');
          ctx.fillStyle = titleGrad;
          ctx.font = '900 124px "PelicanSerif", serif';
          fillTrackedText(ctx, '鹈鹕测试', 50, 206, 6);

          drawCinnabarSeal(ctx, 592, 110, 64, ['纯', '码', '造', '像']);

          ctx.textAlign = 'right';
          ctx.fillStyle = '#f5ead6';
          ctx.font = '700 36px "PelicanWenKai", "PelicanSerif", serif';
          ctx.fillText('一只骑单车的鹈鹕 · 横穿 20 道艺术史画框', 1548, 146);

          ctx.fillStyle = '#d8b278';
          ctx.font = '600 20px "PelicanSans", sans-serif';
          ctx.fillText('6000 年视觉通史  ·  20 时代原声合成  ·  零外部素材', 1548, 198);

          ctx.fillStyle = '#b99662';
          ctx.font = '600 16px "PelicanSerif", serif';
          ctx.fillText('THE PELICAN TEST', 1548, 72);

          // Bottom 9-Era Strip spanning cleanly across `x = 48..1400` (leaving right badge safe)
          const subTiles = stripTiles.slice(0, 9);
          const tw = 140;
          const th = 118;
          const gap = 12;
          for (let i = 0; i < subTiles.length; i++) {
            const tx = 48 + i * (tw + gap);
            const ty = 1036;
            const { canvas: tc, scene } = subTiles[i];
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(tx, ty, tw, th, 4);
            ctx.clip();
            ctx.drawImage(tc, 140, 175, 720, 590, tx, ty, tw, th);
            const tg = ctx.createLinearGradient(0, ty + th - 32, 0, ty + th);
            tg.addColorStop(0, 'rgba(10,9,8,0)');
            tg.addColorStop(1, 'rgba(10,9,8,0.88)');
            ctx.fillStyle = tg;
            ctx.fillRect(tx, ty + th - 32, tw, 32);
            ctx.fillStyle = '#f3e7d0';
            ctx.font = '600 12px "PelicanSans", sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`${String(scene.num).padStart(2, '0')} ${scene.zh}`, tx + 7, ty + th - 7);
            ctx.restore();

            ctx.strokeStyle = 'rgba(218, 178, 115, 0.48)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.roundRect(tx, ty, tw, th, 4);
            ctx.stroke();
          }
        }

        // =====================================================================
        // OG Social Share Card (`1280 x 720` lightweight JPEG for web sharing)
        // =====================================================================
        const cOg = document.createElement('canvas');
        cOg.width = 1280;
        cOg.height = 720;
        cOg.getContext('2d').drawImage(c16, 0, 0, 1280, 720);

        return {
          png16: c16.toDataURL('image/png').split(',')[1],
          jpg16: c16.toDataURL('image/jpeg', 0.93).split(',')[1],
          png43: c43.toDataURL('image/png').split(',')[1],
          jpg43: c43.toDataURL('image/jpeg', 0.93).split(',')[1],
          jpgOg: cOg.toDataURL('image/jpeg', 0.88).split(',')[1],
        };
      });

      const files = [
        [path.join(outDir, 'pelican_cover_16x9.png'), results.png16],
        [path.join(outDir, 'pelican_cover_16x9.jpg'), results.jpg16],
        [path.join(outDir, 'pelican_cover_4x3.png'), results.png43],
        [path.join(outDir, 'pelican_cover_4x3.jpg'), results.jpg43],
        [path.join(publicDir, 'og-cover.jpg'), results.jpgOg],
      ];

      for (const [fp, b64] of files) {
        const buf = Buffer.from(b64, 'base64');
        fs.writeFileSync(fp, buf);
        console.log(`[cover] wrote ${fp} (${(buf.length / 1024).toFixed(1)} KiB)`);
      }
    });
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[cover] FAILED:', err);
  process.exit(1);
});
