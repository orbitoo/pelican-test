// src/scenes/index.js
// Central scene dispatcher mapping each of the 20 eras to its dedicated renderer
// (falling back to the structured animatic placeholder if an id is unrecognized or mid-edit).

import { renderPlaceholderPanel } from './placeholder.js';
import * as s01 from './s01_sahara.js';
import * as s02 from './s02_egypt.js';
import * as s03 from './s03_han.js';
import * as s04 from './s04_tang.js';
import * as s05 from './s05_song.js';
import * as s06 from './s06_qingming.js';
import * as s07 from './s07_maya.js';
import * as s08 from './s08_mughal.js';
import * as s09 from './s09_bada.js';
import * as s10 from './s10_wayang.js';
import * as s11 from './s11_ukiyoe.js';
import * as s12 from './s12_starry.js';
import * as s13 from './s13_scream.js';
import * as s14 from './s14_nosferatu.js';
import * as s15 from './s15_oscilloscope.js';
import * as s16 from './s16_8bit.js';
import * as s17 from './s17_chat.js';
import * as s18 from './s18_vaporwave.js';
import * as s19 from './s19_shortvideo.js';
import * as s20 from './s20_code.js';

const SCENE_MODULES = {
  s01_sahara: s01,
  s02_egypt: s02,
  s03_han: s03,
  s04_tang: s04,
  s05_song: s05,
  s06_qingming: s06,
  s07_maya: s07,
  s08_mughal: s08,
  s09_bada: s09,
  s10_wayang: s10,
  s11_ukiyoe: s11,
  s12_starry: s12,
  s13_scream: s13,
  s14_nosferatu: s14,
  s15_oscilloscope: s15,
  s16_8bit: s16,
  s17_chat: s17,
  s18_vaporwave: s18,
  s19_shortvideo: s19,
  s20_code: s20,
};

const CUSTOM_SCENE_RENDERERS = {};

export function registerSceneRenderer(sceneId, fn) {
  CUSTOM_SCENE_RENDERERS[sceneId] = fn;
}

export function renderScenePanel(kit, slot, scene, params) {
  const customFn = CUSTOM_SCENE_RENDERERS[scene.id] || SCENE_MODULES[scene.id]?.render;
  if (typeof customFn === 'function') {
    try {
      if (params?.isOutroThumbnail) {
        slot.usedFb = false;
        slot.g2d.clear();
        if (scene.id === 's04_tang') {
          const res = customFn(kit, slot, scene, {
            ...params,
            isOutroThumbnail: false,
            pelicanLocalX: 515,
          });
          const ctx = slot.g2d.drawingContext;
          const ps = kit.PANEL_SIZE || 1000;
          ctx.save();
          ctx.fillStyle = 'rgba(15, 14, 12, 0.74)';
          ctx.fillRect(0, ps - 96, ps, 96);
          ctx.fillStyle = '#f5f0e6';
          ctx.font = '700 48px "PelicanSerif", serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${String(scene.num).padStart(2, '0')} ${scene.zh}`, 36, ps - 48);
          ctx.restore();
          return res;
        }
      }
      return customFn(kit, slot, scene, params);
    } catch (err) {
      console.error(`[scene-error:${scene.id}] ${err?.stack || err}`);
      slot.g2d.clear();
      return renderPlaceholderPanel(kit, slot, scene, params);
    }
  }
  return renderPlaceholderPanel(kit, slot, scene, params);
}
