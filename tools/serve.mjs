// tools/serve.mjs
// Lightweight zero-dependency static HTTP server for /home/elbert/pelican-test.
// Can be imported programmatically by shot/sheet/render tools or run standalone (`pnpm serve`).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '..');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
};

const STUB_SCENE_JS =
  "import { renderPlaceholderPanel } from './placeholder.js'; export function render(kit, slot, scene, params) { return renderPlaceholderPanel(kit, slot, scene, params); }\n";

export function startStaticServer(port = 0, host = '127.0.0.1', options = {}) {
  const strictScenes = options.strictScenes || null; // Set of scene basenames (e.g. 's01_sahara.js') that MUST NOT fallback
  const guardMidEditScenes = Boolean(options.guardMidEditScenes);

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', `http://${host}`);
        let pathname = decodeURIComponent(reqUrl.pathname);
        if (pathname === '/favicon.ico') {
          res.writeHead(204);
          res.end();
          return;
        }
        if (pathname === '/') pathname = '/index.html';

        const filePath = path.resolve(PROJECT_ROOT, '.' + pathname);
        if (!filePath.startsWith(PROJECT_ROOT)) {
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }

        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) {
            res.writeHead(404);
            res.end(`Not found: ${pathname}`);
            return;
          }
          const ext = path.extname(filePath).toLowerCase();
          const base = path.basename(filePath);
          if (
            guardMidEditScenes &&
            pathname.startsWith('/src/scenes/s') &&
            ext === '.js' &&
            (!strictScenes || !strictScenes.has(base))
          ) {
            const chk = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
            if (chk.status !== 0) {
              res.writeHead(200, {
                'Content-Type': MIME_TYPES['.js'],
                'Cache-Control': 'no-cache',
                'Access-Control-Allow-Origin': '*',
              });
              res.end(STUB_SCENE_JS);
              return;
            }
          }
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          const range = req.headers.range;
          if (range && ext === '.mp4') {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const start = m && m[1] ? parseInt(m[1], 10) : 0;
            const end = m && m[2] ? Math.min(stat.size - 1, parseInt(m[2], 10)) : stat.size - 1;
            if (start >= stat.size || start > end) {
              res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
              res.end();
              return;
            }
            res.writeHead(206, {
              'Content-Range': `bytes ${start}-${end}/${stat.size}`,
              'Accept-Ranges': 'bytes',
              'Content-Length': end - start + 1,
              'Content-Type': contentType,
              'Cache-Control': 'no-cache',
              'Access-Control-Allow-Origin': '*',
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
            return;
          }
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': stat.size,
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-cache',
            'Access-Control-Allow-Origin': '*',
          });
          fs.createReadStream(filePath).pipe(res);
        });
      } catch (e) {
        res.writeHead(500);
        res.end(String(e));
      }
    });

    server.on('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      resolve({
        server,
        port: actualPort,
        baseUrl: `http://${host}:${actualPort}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

// Run standalone if invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = parseInt(process.env.PORT || process.argv[2] || '4173', 10);
  startStaticServer(port).then(({ baseUrl }) => {
    console.log(`[pelican-test] Preview server running at ${baseUrl}/index.html`);
  });
}
