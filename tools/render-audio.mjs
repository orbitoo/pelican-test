// tools/render-audio.mjs
// Renders the bit-exact 137.000000s (6,576,000 stereo frames @ 48000 Hz) procedural
// master soundtrack + foley WAV via Chrome's Web Audio `OfflineAudioContext` over
// the persistent CDP bridge (`http://127.0.0.1:19222`).
//
// Usage:
//   node tools/render-audio.mjs [outputPath] [--sr 48000]

import fs from 'node:fs';
import path from 'node:path';
import { startStaticServer, PROJECT_ROOT } from './serve.mjs';
import { withCDPBrowser } from './cdp.mjs';

async function main() {
  const args = process.argv.slice(2);
  let sampleRate = 48000;
  let outPath = path.resolve(
    PROJECT_ROOT,
    'out/stage4/pelican_soundtrack_48k.wav'
  );

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sr' && args[i + 1]) {
      sampleRate = parseInt(args[++i], 10) || 48000;
    } else if (args[i] === '--out' && args[i + 1]) {
      outPath = path.resolve(PROJECT_ROOT, args[++i]);
    } else if (!args[i].startsWith('--')) {
      outPath = path.resolve(PROJECT_ROOT, args[i]);
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const srv = await startStaticServer(0, '127.0.0.1', {
    guardMidEditScenes: true,
  });

  try {
    await withCDPBrowser(async ({ browser }) => {
      const page = await browser.newPage();
      try {
        const pageErrors = [];
        page.on('pageerror', (err) => {
          const msg = err.stack || err.message || String(err);
          pageErrors.push(msg);
          console.error('[render-audio pageerror]:', msg);
        });
        page.on('console', (msg) => {
          const txt = msg.text();
          if (msg.type() === 'error') {
            pageErrors.push(txt);
            console.error('[render-audio console.error]:', txt);
          } else if (txt.startsWith('[engine]')) {
            console.log(' ', txt);
          }
        });

        await page.goto(`${srv.baseUrl}/render.html`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        });

        console.log(
          `[render-audio] Rendering 137.0s procedural master soundtrack @ ${sampleRate} Hz via OfflineAudioContext...`
        );
        const tStart = performance.now();

        const meta = await page.evaluate(async (sr) => {
          const mod = await import(`/src/audio/engine.js?t=${Date.now()}`);
          if (typeof window.__pelicanPrepareMasterWav === 'function') {
            return await window.__pelicanPrepareMasterWav(sr, true);
          }
          const bytes = await mod.exportMasterWavBytes({ sampleRate: sr });
          window.__pelicanWavBytes = bytes;
          return {
            byteLength: bytes.byteLength,
            sampleRate: sr,
            numFrames: (bytes.byteLength - 44) / 4,
            durationSec: (bytes.byteLength - 44) / 4 / sr,
            renderMs: 0,
            encodeMs: 0,
          };
        }, sampleRate);

        if (pageErrors.length > 0) {
          throw new Error(
            `Audio synthesis encountered ${pageErrors.length} browser error(s): ${pageErrors[0]}`
          );
        }

        // Stream WAV bytes in 4 MiB chunks over CDP
        const CHUNK_BYTES = 4 * 1024 * 1024;
        const buffers = [];
        for (let offset = 0; offset < meta.byteLength; offset += CHUNK_BYTES) {
          const b64 = await page.evaluate(
            (off, len) => window.__pelicanReadMasterWavChunk(off, len),
            offset,
            CHUNK_BYTES
          );
          buffers.push(Buffer.from(b64, 'base64'));
        }

        await page.evaluate(() => {
          delete window.__pelicanWavBytes;
        });

        const fullWav = Buffer.concat(buffers);
        if (fullWav.byteLength !== meta.byteLength) {
          throw new Error(
            `WAV byte mismatch: got ${fullWav.byteLength}, expected ${meta.byteLength}`
          );
        }

        fs.writeFileSync(outPath, fullWav);
        const totalMs = (performance.now() - tStart).toFixed(1);

        console.log(
          `[render-audio] SUCCESS: ${outPath}\n` +
            `  frames=${meta.numFrames} (${meta.durationSec.toFixed(6)}s @ ${meta.sampleRate} Hz)\n` +
            `  size=${(fullWav.byteLength / (1024 * 1024)).toFixed(2)} MiB (${fullWav.byteLength} bytes)\n` +
            `  offlineRender=${meta.renderMs.toFixed(1)}ms, wavEncode=${meta.encodeMs.toFixed(1)}ms, wallTotal=${totalMs}ms`
        );
      } finally {
        if (!page.isClosed()) {
          await page.close();
        }
      }
    });
  } finally {
    await srv.close();
  }
}

main().catch((err) => {
  console.error('[render-audio] FAILED:', err);
  process.exit(1);
});
