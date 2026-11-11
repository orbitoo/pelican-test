// tools/build-cf.mjs
// Builds a clean, standalone, player-only static bundle in `/home/elbert/pelican-test/dist`
// ready for Cloudflare Pages (`< 25 MiB` per-file limit, zero backend, WOFF2 subsetted fonts).

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

function walkFiles(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function copyDirRecursive(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, ent.name);
    const d = path.join(dstDir, ent.name);
    if (ent.isDirectory()) {
      copyDirRecursive(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function collectUsedCodepoints() {
  const cps = new Set();

  // 1. Full printable ASCII + Latin-1 Supplement
  for (let cp = 0x0020; cp <= 0x00ff; cp++) cps.add(cp);
  // 2. Greek & Math symbols (`Σ`, `π`, `ω`, `φ`, `θ`, arrows, geometric shapes, dingbats, box drawing)
  for (let cp = 0x0370; cp <= 0x03ff; cp++) cps.add(cp);
  for (let cp = 0x2000; cp <= 0x27bf; cp++) cps.add(cp);
  // 3. CJK Symbols & Punctuation + Hiragana + Katakana + Halfwidth/Fullwidth Forms
  for (let cp = 0x3000; cp <= 0x30ff; cp++) cps.add(cp);
  for (let cp = 0xff00; cp <= 0xffef; cp++) cps.add(cp);

  // 4. Every single character appearing anywhere in `index.html`, `public/style.css`, and `src/**`
  const sourceFiles = [
    path.join(ROOT, 'index.html'),
    path.join(ROOT, 'public/style.css'),
    ...walkFiles(path.join(ROOT, 'src')).filter((f) => /\.(js|mjs|json|css)$/i.test(f)),
  ];

  for (const file of sourceFiles) {
    const txt = fs.readFileSync(file, 'utf8');
    for (const ch of txt) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x20) cps.add(cp);
    }
  }

  return Array.from(cps).sort((a, b) => a - b);
}

function ensureSubsetWoff2Fonts() {
  const fontsDir = path.join(ROOT, 'public/fonts');
  const fontBasenames = [
    'NotoSerifSC',
    'NotoSansSC',
    'LXGWWenKai',
    'JetBrainsMono-Regular',
    'JetBrainsMono-Bold',
  ];

  // Check if `uv` is available to freshly subset `.ttf -> .woff2`
  const uvCheck = spawnSync('uv', ['--version'], { stdio: 'ignore' });
  if (uvCheck.status === 0) {
    const codepoints = collectUsedCodepoints();
    const charsText = codepoints.map((cp) => String.fromCodePoint(cp)).join('');
    const tmpCharsFile = path.join(ROOT, 'public/fonts/.subset-chars.txt');
    fs.writeFileSync(tmpCharsFile, charsText, 'utf8');

    console.log(`[build-cf] Subsetting 5 fonts across ${codepoints.length} unique codepoints -> WOFF2...`);
    const pyScript = `
import sys, os
from fontTools.subset import main as subset_main

fonts_dir = sys.argv[1]
chars_file = sys.argv[2]
names = sys.argv[3:]

for name in names:
    ttf_path = os.path.join(fonts_dir, name + ".ttf")
    woff2_path = os.path.join(fonts_dir, name + ".woff2")
    if not os.path.exists(ttf_path):
        continue
    subset_main([
        ttf_path,
        f"--text-file={chars_file}",
        "--flavor=woff2",
        f"--output-file={woff2_path}",
        "--layout-features=*",
        "--glyph-names",
        "--notdef-glyph",
        "--notdef-outline",
    ])
`;
    const res = spawnSync(
      'uv',
      [
        'run',
        '--with',
        'fonttools',
        '--with',
        'brotli',
        'python3',
        '-c',
        pyScript,
        fontsDir,
        tmpCharsFile,
        ...fontBasenames,
      ],
      { stdio: 'inherit' }
    );
    try {
      fs.unlinkSync(tmpCharsFile);
    } catch (_e) {
      // ignore
    }
    if (res.status !== 0) {
      throw new Error(`Font subsetting failed with exit code ${res.status}`);
    }
  } else {
    console.log('[build-cf] `uv` not found in PATH — reusing prebuilt `public/fonts/*.woff2`.');
  }

  for (const name of fontBasenames) {
    const w2 = path.join(fontsDir, `${name}.woff2`);
    if (!fs.existsSync(w2)) {
      throw new Error(`Missing required WOFF2 font: ${w2}`);
    }
  }
  return fontBasenames;
}

function main() {
  const fontBasenames = ensureSubsetWoff2Fonts();

  // Clean and recreate `dist/`
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'public/fonts'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'public/vendor'), { recursive: true });

  // 1. Copy standalone player `index.html`
  fs.copyFileSync(path.join(ROOT, 'index.html'), path.join(DIST, 'index.html'));

  // 2. Copy `src/` ES modules
  copyDirRecursive(path.join(ROOT, 'src'), path.join(DIST, 'src'));

  // 3. Copy `public/vendor/` & `public/og-cover.jpg`
  copyDirRecursive(path.join(ROOT, 'public/vendor'), path.join(DIST, 'public/vendor'));
  const ogSrc = path.join(ROOT, 'public/og-cover.jpg');
  if (fs.existsSync(ogSrc)) {
    fs.copyFileSync(ogSrc, path.join(DIST, 'public/og-cover.jpg'));
  }

  // 4. Copy compact `.woff2` fonts ONLY (zero 24MB `.ttf` files in `dist/`!)
  for (const name of fontBasenames) {
    fs.copyFileSync(
      path.join(ROOT, 'public/fonts', `${name}.woff2`),
      path.join(DIST, 'public/fonts', `${name}.woff2`)
    );
  }

  // 5. Rewrite `dist/public/style.css` so `@font-face` points exclusively to `./fonts/*.woff2`
  let css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  css = css.replace(
    /src:\s*url\("\.\/fonts\/([^"]+?)\.woff2"\)\s*format\("woff2"\)\s*,\s*url\("\.\/fonts\/[^"]+?\.ttf"\)\s*format\("truetype"\);/g,
    'src: url("./fonts/$1.woff2") format("woff2");'
  );
  css = css.replace(
    /src:\s*url\("\.\/fonts\/([^"]+?)\.ttf"\)\s*format\("truetype"\);/g,
    'src: url("./fonts/$1.woff2") format("woff2");'
  );
  fs.writeFileSync(path.join(DIST, 'public/style.css'), css, 'utf8');

  // 6. Write Cloudflare Pages `_headers` for immutable font/vendor edge caching
  const cfHeaders = `/public/fonts/*
  Cache-Control: public, max-age=31536000, immutable

/public/vendor/*
  Cache-Control: public, max-age=31536000, immutable
`;
  fs.writeFileSync(path.join(DIST, '_headers'), cfHeaders, 'utf8');

  // 7. Audit file count, total bundle size, and Cloudflare Pages' 25 MiB per-file limit
  const distFiles = walkFiles(DIST);
  let totalBytes = 0;
  let maxFile = { path: '', bytes: 0 };
  const CF_MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MiB

  for (const f of distFiles) {
    const st = fs.statSync(f);
    totalBytes += st.size;
    if (st.size > maxFile.bytes) {
      maxFile = { path: path.relative(DIST, f), bytes: st.size };
    }
    if (st.size > CF_MAX_FILE_BYTES) {
      throw new Error(
        `File exceeds Cloudflare Pages 25 MiB limit: ${path.relative(DIST, f)} (${st.size} bytes)`
      );
    }
  }

  console.log(
    `[build-cf] SUCCESS -> ${DIST}\n` +
      `  Files: ${distFiles.length}\n` +
      `  Total bundle size: ${(totalBytes / (1024 * 1024)).toFixed(2)} MiB\n` +
      `  Largest single file: ${maxFile.path} (${(maxFile.bytes / 1024).toFixed(1)} KiB — well under CF 25 MiB limit!)`
  );
}

main();
