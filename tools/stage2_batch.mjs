// tools/stage2_batch.mjs
// Fast single-session CDP batch renderer for Stage 2 QA:
// Renders both the 12-beat contact sheet (`out/stage2/sXX_rK_sheet.png`) and
// the 3 native 1920x1080 shots (`out/stage2/sXX_rK/shot_XXXXXXs.png`) per scene
// in one shared render.html page, isolating per-scene errors and warmed-up frame ms.
//
// Usage:
//   node tools/stage2_batch.mjs 3:1 4:1 17:1 18:1

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';
import { SCENES } from '../src/beat/timeline.js';

async function main() {
  const specs = process.argv.slice(2).map((arg) => {
    const [nStr, rStr] = arg.split(':');
    const num = parseInt(nStr, 10);
    const round = parseInt(rStr || '1', 10);
    const sc = SCENES[num - 1];
    if (!sc) throw new Error(`Invalid scene spec "${arg}" (expected N:K with N in 1..20)`);
    return { num, round, sc };
  });

  if (specs.length === 0) {
    console.error('Usage: node tools/stage2_batch.mjs <sceneNum>:<round> [...]');
    process.exit(1);
  }

  const strictScenes = new Set();
  for (const { num, sc } of specs) {
    const fname = `${sc.id}.js`;
    strictScenes.add(fname);
    const fpath = path.resolve(PROJECT_ROOT, 'src/scenes', fname);
    const chk = spawnSync(process.execPath, ['--check', fpath], { encoding: 'utf8' });
    if (chk.status !== 0) {
      console.error(`[batch] SYNTAX ERROR in requested scene #${num} (${fname}):\n${chk.stderr}`);
      process.exit(2);
    }
  }

  const srv = await startStaticServer(0, '127.0.0.1', {
    guardMidEditScenes: true,
    strictScenes,
  });
  try {
    await withCDPBrowser(async ({ openRenderPage }) => {
      const page = await openRenderPage(`${srv.baseUrl}/render.html`);
      const bootErrors = [...(page.__pelicanErrors || [])];
      if (bootErrors.length > 0) {
        console.error('[batch] BOOT ERRORS:', bootErrors);
      }

      for (const { num, round, sc } of specs) {
        const pad = String(num).padStart(2, '0');
        const rTag = `r${round}`;
        const sheetOut = path.resolve(PROJECT_ROOT, `out/stage2/s${pad}_${rTag}_sheet.png`);
        const shotDir = path.resolve(PROJECT_ROOT, `out/stage2/s${pad}_${rTag}`);
        fs.mkdirSync(path.dirname(sheetOut), { recursive: true });
        fs.mkdirSync(shotDir, { recursive: true });

        const errStart = page.__pelicanErrors ? page.__pelicanErrors.length : 0;

        // 1. 12-beat contact sheet
        const sheetCfg = {
          cols: 4,
          rows: 3,
          tileW: 480,
          tileH: 270,
          timestamps: Array.from({ length: 12 }, (_, k) => sc.t0 + k * 0.5 + (k === 0 ? 0.02 : 0)),
          title: `#${pad} ${sc.zh} (${sc.en} · ${sc.era}) — 12 拍逐拍接触表`,
        };

        const { b64Png, timings } = await page.evaluate(async (cfg) => {
          const padPx = 16;
          const headerH = 56;
          const labelH = 28;
          const cellW = cfg.tileW;
          const cellH = cfg.tileH + labelH;
          const sheetW = padPx * 2 + cfg.cols * cellW + (cfg.cols - 1) * 12;
          const sheetH = headerH + padPx + cfg.rows * cellH + (cfg.rows - 1) * 12 + padPx;

          const sheet = document.createElement('canvas');
          sheet.width = sheetW;
          sheet.height = sheetH;
          const sctx = sheet.getContext('2d');

          sctx.fillStyle = '#121110';
          sctx.fillRect(0, 0, sheetW, sheetH);

          sctx.fillStyle = '#f3ece0';
          sctx.font = '700 24px "PelicanSerif", serif';
          sctx.textBaseline = 'middle';
          sctx.fillText(cfg.title, padPx, headerH / 2 + 2);

          const mainCanvas = window.__PELICAN_EXPORT_CANVAS__;
          const frameMs = [];

          for (let i = 0; i < cfg.timestamps.length; i++) {
            const t = cfg.timestamps[i];
            const t0 = performance.now();
            const st = await window.renderFrameAt(t);
            frameMs.push(performance.now() - t0);

            const col = i % cfg.cols;
            const row = Math.floor(i / cfg.cols);
            const x = padPx + col * (cellW + 12);
            const y = headerH + padPx + row * (cellH + 12);

            sctx.fillStyle = '#22201c';
            sctx.fillRect(x, y, cellW, cellH);
            sctx.drawImage(mainCanvas, 0, 0, 1920, 1080, x, y, cfg.tileW, cfg.tileH);

            sctx.strokeStyle = 'rgba(212, 163, 115, 0.45)';
            sctx.lineWidth = 1.5;
            sctx.strokeRect(x, y, cfg.tileW, cfg.tileH);

            let tag = `t=${t.toFixed(2)}s`;
            if (st.section === 'intro') tag += ' · Intro';
            else if (st.section === 'outro') tag += ' · Outro';
            else if (st.scene) {
              tag += ` · #${String(st.scene.num).padStart(2, '0')} ${st.scene.zh} [B${st.barInScene + 1}.${(Math.floor(st.beatInScene) % 4) + 1}]`;
            }

            sctx.fillStyle = '#dfd7c8';
            sctx.font = '500 14px "PelicanMono", "PelicanSans", sans-serif';
            sctx.textBaseline = 'middle';
            sctx.fillText(tag, x + 8, y + cfg.tileH + labelH / 2);
          }

          return { b64Png: sheet.toDataURL('image/png').split(',')[1], timings: frameMs };
        }, sheetCfg);

        fs.writeFileSync(sheetOut, Buffer.from(b64Png, 'base64'));

        // 2. 3 native 1080p shots: t0+1.0, t0+2.8, t0+4.8
        const shotTimes = [sc.t0 + 1.0, sc.t0 + 2.8, sc.t0 + 4.8];
        const shotFiles = [];
        const shotRenderMs = [];
        for (const t of shotTimes) {
          const { b64, rMs } = await page.evaluate(async (sec) => {
            const r0 = performance.now();
            await window.renderFrameAt(sec);
            const dt = performance.now() - r0;
            const dataUrl = window.__PELICAN_EXPORT_CANVAS__.toDataURL('image/png');
            return { b64: dataUrl.split(',')[1], rMs: dt };
          }, t);
          const targetPath = path.join(shotDir, `shot_${t.toFixed(2).padStart(6, '0')}s.png`);
          fs.writeFileSync(targetPath, Buffer.from(b64, 'base64'));
          shotFiles.push(targetPath);
          shotRenderMs.push(rMs);
        }

        const allNewErrors = (page.__pelicanErrors || []).slice(errStart);
        // Filter errors belonging to THIS scene (or untagged pageerrors), ignoring mid-edit neighbor scene errors
        const sceneErrors = allNewErrors.filter(
          (msg) => !msg.startsWith('[scene-error:') || msg.startsWith(`[scene-error:${sc.id}]`)
        );
        const neighborErrors = allNewErrors.filter(
          (msg) => msg.startsWith('[scene-error:') && !msg.startsWith(`[scene-error:${sc.id}]`)
        );
        const warmupMs = timings[0] ?? 0;
        const warmSlice = [...timings.slice(1), ...shotRenderMs];
        const avgWarmMs = warmSlice.reduce((a, b) => a + b, 0) / Math.max(1, warmSlice.length);
        const maxWarmMs = Math.max(...warmSlice);

        console.log(
          JSON.stringify({
            num,
            id: sc.id,
            zh: sc.zh,
            round: rTag,
            warmupMs: Number(warmupMs.toFixed(1)),
            warmAvgMs: Number(avgWarmMs.toFixed(1)),
            warmMaxMs: Number(maxWarmMs.toFixed(1)),
            errors: sceneErrors,
            neighborMidEditCount: neighborErrors.length,
            sheet: sheetOut,
            shots: shotFiles,
          })
        );
      }
    });
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[batch] FAILED:', err);
  process.exit(1);
});
