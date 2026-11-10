# Third-Party Notices

This project (`《鹈鹕测试》 / Pelican Test`) is written from scratch as an original procedural animation work. No source code, rendered frames, cover art, voice samples, audio tracks, or art briefs were copied from any external short-film repository.

## Bundled / Runtime Open-Source Components

1. **p5.js (`^2.3.4`)**
   - License: GNU Lesser General Public License v2.1 (`LGPL-2.1`)
   - Upstream: https://p5js.org / https://github.com/processing/p5.js
   - Usage: Loaded unmodified as an external library (`public/vendor/p5.min.js`).

2. **p5.brush (`^3.0.0`)**
   - License: MIT License (`MIT`)
   - Copyright (c) Alejandro Campos Uribe
   - Upstream: https://github.com/acamposuribe/p5.brush
   - Transitive dependency: `simplex-noise` (MIT License, Copyright (c) Jonas Wagner)
   - Usage: Loaded as `public/vendor/p5.brush.js`.

3. **puppeteer-core (`^24.x`)**
   - License: Apache License 2.0 (`Apache-2.0`)
   - Upstream: https://github.com/puppeteer/puppeteer
   - Usage: Development/build-time frame & audio capture client connecting to an existing Chrome DevTools Protocol endpoint (`127.0.0.1:19222`). No browser binaries are downloaded or bundled.

4. **Open-Source Fonts (`public/fonts/`)**
   - **Noto Serif SC** & **Noto Sans SC** — SIL Open Font License 1.1 (`OFL-1.1`), Copyright Google LLC / Adobe.
   - **LXGW WenKai Screen (霞鹜文楷)** — SIL Open Font License 1.1 (`OFL-1.1`), Copyright LXGW & Fontworks Inc. (derived from Klee One).
   - **JetBrains Mono** — SIL Open Font License 1.1 (`OFL-1.1`), Copyright JetBrains s.r.o.

5. **External Build Tooling (Not Bundled)**
   - **FFmpeg** — LGPL/GPL (invoked via system CLI in `tools/encode.sh` to mux rendered PNG sequences and procedurally synthesized WAV audio).

## Public-Domain Art Homage & Fictional UI Notice

- Historical art movements and works referenced across scenes (Tassili n'Ajjer rock art, Ancient Egyptian tomb painting, Eastern Han stone reliefs, Tang dynasty *baimiao*, Northern Song monumental landscape after Fan Kuan's *Travelers Among Mountains and Streams*, Zhang Zeduan's *Along the River During the Qingming Festival*, Maya codices, Mughal court miniatures, Bada Shanren's ink wash, Javanese *Wayang Kulit*, Hiroshige's *Fifty-three Stations of the Tōkaidō*, Vincent van Gogh's *The Starry Night* [1889], Edvard Munch's *The Scream* [1893], and F. W. Murnau's *Nosferatu* [1922]) are in the public domain.
- All software interfaces, 8-bit game stages, instant-messaging windows, vaporwave visuals, vertical short-video interfaces, and press-conference props are 100% original fictional designs containing no real brand names, logos, icons, copyrighted characters, level layouts, or sampled audio.
