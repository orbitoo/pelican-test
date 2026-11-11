// tools/sheet.mjs
// Generates a labeled Contact Sheet PNG for visual QA of a single scene, custom time range,
// or full-film milestone overview.
// Usage:
//   node tools/sheet.mjs --scene 1 --out out/sheet_s01.png
//   node tools/sheet.mjs --from 0 --to 137 --cols 5 --rows 5 --out out/sheet_overview.png

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';
import { SCENES, TOTAL_DURATION } from '../src/beat/timeline.js';

function parseArgs(argv) {
  const opts = {
    from: 0,
    to: TOTAL_DURATION,
    cols: 4,
    rows: 3,
    tileW: 480,
    tileH: 270,
    out: 'out/contact_sheet.png',
    timestamps: null,
    title: '《鹈鹕测试》Contact Sheet',
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--scene' && argv[i + 1]) {
      const num = parseInt(argv[++i], 10);
      const sc = SCENES[num - 1];
      if (!sc) throw new Error(`Invalid --scene ${num} (expected 1..20)`);
      opts.from = sc.t0;
      opts.to = sc.t1 - 0.04;
      opts.cols = 4;
      opts.rows = 3; // 12 beats of the 3-bar scene!
      opts.timestamps = Array.from({ length: 12 }, (_, k) => sc.t0 + k * 0.5 + (k === 0 ? 0.02 : 0));
      opts.title = `#${String(sc.num).padStart(2, '0')} ${sc.zh} (${sc.en} · ${sc.era}) — 12 拍逐拍接触表`;
      opts.out = `out/sheet_s${String(sc.num).padStart(2, '0')}.png`;
    } else if (a === '--from' && argv[i + 1]) {
      opts.from = parseFloat(argv[++i]);
    } else if (a === '--to' && argv[i + 1]) {
      opts.to = parseFloat(argv[++i]);
    } else if (a === '--cols' && argv[i + 1]) {
      opts.cols = parseInt(argv[++i], 10);
    } else if (a === '--rows' && argv[i + 1]) {
      opts.rows = parseInt(argv[++i], 10);
    } else if (a === '--tileW' && argv[i + 1]) {
      opts.tileW = parseInt(argv[++i], 10);
    } else if (a === '--tileH' && argv[i + 1]) {
      opts.tileH = parseInt(argv[++i], 10);
    } else if (a === '--times' && argv[i + 1]) {
      opts.timestamps = argv[++i].split(',').map(Number);
    } else if (a === '--title' && argv[i + 1]) {
      opts.title = argv[++i];
    } else if (a === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    }
  }

  const count = opts.cols * opts.rows;
  if (!opts.timestamps) {
    opts.timestamps = Array.from({ length: count }, (_, idx) =>
      count === 1 ? opts.from : opts.from + ((opts.to - opts.from) * idx) / (count - 1)
    );
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = path.resolve(PROJECT_ROOT, opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const srv = await startStaticServer(0, '127.0.0.1', { guardMidEditScenes: true });
  try {
    await withCDPBrowser(async ({ openRenderPage }) => {
      const page = await openRenderPage(`${srv.baseUrl}/render.html`);

      // Assemble contact sheet directly in an offscreen 2D canvas inside the browser page,
      // then return its lossless PNG buffer and per-frame render timings!
      const { b64Png, timings } = await page.evaluate(async (cfg) => {
        const pad = 16;
        const headerH = 56;
        const labelH = 28;
        const cellW = cfg.tileW;
        const cellH = cfg.tileH + labelH;
        const sheetW = pad * 2 + cfg.cols * cellW + (cfg.cols - 1) * 12;
        const sheetH = headerH + pad + cfg.rows * cellH + (cfg.rows - 1) * 12 + pad;

        const sheet = document.createElement('canvas');
        sheet.width = sheetW;
        sheet.height = sheetH;
        const sctx = sheet.getContext('2d');

        sctx.fillStyle = '#121110';
        sctx.fillRect(0, 0, sheetW, sheetH);

        sctx.fillStyle = '#f3ece0';
        sctx.font = '700 24px "PelicanSerif", serif';
        sctx.textBaseline = 'middle';
        sctx.fillText(cfg.title, pad, headerH / 2 + 2);

        const mainCanvas = window.__PELICAN_EXPORT_CANVAS__;
        const frameMs = [];

        for (let i = 0; i < cfg.timestamps.length; i++) {
          const t = cfg.timestamps[i];
          const t0 = performance.now();
          const st = await window.renderFrameAt(t);
          frameMs.push(performance.now() - t0);

          const col = i % cfg.cols;
          const row = Math.floor(i / cfg.cols);
          const x = pad + col * (cellW + 12);
          const y = headerH + pad + row * (cellH + 12);

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
      }, opts);

      fs.writeFileSync(outPath, Buffer.from(b64Png, 'base64'));
      const warmupMs = timings[0] ?? 0;
      const warmSlice = timings.length > 1 ? timings.slice(1) : timings;
      const avgWarmMs = warmSlice.reduce((a, b) => a + b, 0) / Math.max(1, warmSlice.length);
      const maxWarmMs = Math.max(...warmSlice);
      console.log(
        `[sheet] Saved ${opts.timestamps.length}-tile contact sheet -> ${outPath} | warmup=${warmupMs.toFixed(1)}ms, warmAvg=${avgWarmMs.toFixed(1)}ms, warmMax=${maxWarmMs.toFixed(1)}ms`
      );
    });
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[sheet] FAILED:', err);
  process.exit(1);
});
