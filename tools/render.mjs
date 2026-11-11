// tools/render.mjs
// Deterministic parallel frame-sequence exporter connecting to 127.0.0.1:19222 via puppeteer-core.
// Usage:
//   node tools/render.mjs --fps 30 --from 0 --to 137 --out frames_30fps --workers 4
//   node tools/render.mjs --fps 60 --from 4.5 --to 12.5 --out frames_pan_60fps --workers 4

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';
import { TOTAL_DURATION } from '../src/beat/timeline.js';

function parseArgs(argv) {
  const opts = {
    fps: 30,
    from: 0,
    to: TOTAL_DURATION,
    out: 'frames',
    workers: 4,
    format: 'png', // 'png' | 'jpeg'
    quality: 94,
    globalIndex: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fps' && argv[i + 1]) opts.fps = Number(argv[++i]);
    else if (a === '--from' && argv[i + 1]) opts.from = Number(argv[++i]);
    else if (a === '--to' && argv[i + 1]) opts.to = Number(argv[++i]);
    else if (a === '--out' && argv[i + 1]) opts.out = argv[++i];
    else if (a === '--workers' && argv[i + 1]) opts.workers = Math.max(1, parseInt(argv[++i], 10));
    else if (a === '--format' && argv[i + 1]) opts.format = argv[++i];
    else if (a === '--quality' && argv[i + 1]) opts.quality = parseInt(argv[++i], 10);
    else if (a === '--global-index') opts.globalIndex = true;
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outDir = path.resolve(PROJECT_ROOT, opts.out);
  fs.mkdirSync(outDir, { recursive: true });

  const startFrame = Math.round(opts.from * opts.fps);
  const endFrame = Math.max(startFrame, Math.round(opts.to * opts.fps) - 1);
  const totalFrames = endFrame - startFrame + 1;
  const ext = opts.format === 'jpeg' ? 'jpg' : 'png';

  console.log(
    `[render] Exporting ${totalFrames} frames (${opts.from.toFixed(2)}s -> ${opts.to.toFixed(2)}s @ ${opts.fps}fps, ${opts.workers} tabs) -> ${outDir}`
  );

  const srv = await startStaticServer(0);
  const tStart = performance.now();
  let completed = 0;
  let nextIdx = 0;

  try {
    await withCDPBrowser(async ({ openRenderPage }) => {
      // Cap concurrent WebGL2 tabs at 3 (3 tabs * 3 p5/p5.brush WebGL contexts = 9 < Blink's 16-context limit)
      const workerCount = Math.min(opts.workers, 3, totalFrames);
      const pages = [];
      for (let w = 0; w < workerCount; w++) {
        pages.push(await openRenderPage(`${srv.baseUrl}/render.html`));
      }

      const CHUNK_SIZE = 120; // 2.0s contiguous slices minimize duplicate scene/outro FBO bakes across tabs
      await Promise.all(
        pages.map(async (page) => {
          const mime = opts.format === 'jpeg' ? 'image/jpeg' : 'image/png';
          const q = (opts.quality || 94) / 100;
          while (true) {
            const chunkStart = nextIdx;
            if (chunkStart >= totalFrames) break;
            nextIdx += CHUNK_SIZE;
            const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalFrames);

            for (let localIdx = chunkStart; localIdx < chunkEnd; localIdx++) {
              const globalFrame = startFrame + localIdx;
              const t = globalFrame / opts.fps;
              const b64 = await page.evaluate(
                ({ sec, m, qual }) => window.captureFrameAt(sec, m, qual),
                { sec: t, m: mime, qual: q }
              );
              if (page.__pelicanErrors?.length) {
                throw new Error(`Render page error at frame ${localIdx} (t=${t.toFixed(3)}s): ${page.__pelicanErrors[0]}`);
              }

              // Output sequential 0-based numbering (`frame_000000.png`) inside `outDir` so ffmpeg
              // `-start_number 0` works seamlessly even for mid-film test slices!
              const fileIdx = opts.globalIndex ? globalFrame : localIdx;
              const filename = `frame_${String(fileIdx).padStart(6, '0')}.${ext}`;
              const filePath = path.join(outDir, filename);
              await fs.promises.writeFile(filePath, Buffer.from(b64, 'base64'));

              completed++;
              if (completed % 120 === 0 || completed === totalFrames) {
                const elapsed = (performance.now() - tStart) / 1000;
                const rate = (completed / elapsed).toFixed(1);
                console.log(`[render] ${completed}/${totalFrames} frames (${rate} fps effective)`);
              }
            }
          }
        })
      );
    });
  } finally {
    await srv.close();
  }

  const totalSec = ((performance.now() - tStart) / 1000).toFixed(1);
  console.log(`[render] Done in ${totalSec}s -> ${outDir}`);
}

main().catch((err) => {
  console.error('[render] FAILED:', err);
  process.exit(1);
});
