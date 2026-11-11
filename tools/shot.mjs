// tools/shot.mjs
// Captures one or more 1920x1080 PNG screenshots at exact timestamps `t` (in seconds).
// Usage:
//   node tools/shot.mjs 3.2 out/intro_test.png
//   node tools/shot.mjs --times 0.8,3.1,5.0,8.0,130.0 --dir out/shots

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';

async function main() {
  const args = process.argv.slice(2);
  let times = [];
  let outDir = path.resolve(PROJECT_ROOT, 'out/shots');
  let singleOut = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--times' && args[i + 1]) {
      times = args[++i].split(',').map(Number);
    } else if (args[i] === '--dir' && args[i + 1]) {
      outDir = path.resolve(PROJECT_ROOT, args[++i]);
    } else if (!args[i].startsWith('--')) {
      if (times.length === 0) {
        times.push(Number(args[i]));
      } else if (!singleOut) {
        singleOut = path.resolve(PROJECT_ROOT, args[i]);
      }
    }
  }

  if (times.length === 0) times = [0];
  fs.mkdirSync(singleOut ? path.dirname(singleOut) : outDir, { recursive: true });

  const srv = await startStaticServer(0, '127.0.0.1', { guardMidEditScenes: true });
  try {
    await withCDPBrowser(async ({ openRenderPage }) => {
      const page = await openRenderPage(`${srv.baseUrl}/render.html`);
      for (const t of times) {
        const t0 = performance.now();
        const { b64, renderMs } = await page.evaluate(async (sec) => {
          const r0 = performance.now();
          await window.renderFrameAt(sec);
          const rMs = performance.now() - r0;
          const dataUrl = window.__PELICAN_EXPORT_CANVAS__.toDataURL('image/png');
          return { b64: dataUrl.split(',')[1], renderMs: rMs };
        }, t);
        const dtMs = (performance.now() - t0).toFixed(1);
        const targetPath =
          singleOut && times.length === 1
            ? singleOut
            : path.join(outDir, `shot_${t.toFixed(2).padStart(6, '0')}s.png`);
        fs.writeFileSync(targetPath, Buffer.from(b64, 'base64'));
        console.log(`[shot] t=${t.toFixed(2)}s (render=${renderMs.toFixed(1)}ms, total=${dtMs}ms) -> ${targetPath}`);
      }
    });
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[shot] FAILED:', err);
  process.exit(1);
});
