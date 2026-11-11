// src/audio/foley.js
// Stage 4 — Continuous Speed-Synced Bicycle Groove, Frame-Crossing Transients & Outro Press-Conference Foley
//
// Exclusively owned by `audio-modern`.
// 100% procedural Web Audio synthesis (zero external samples):
//   1. Continuous Bicycle Groove (3.80..125.65s):
//      - Sample-accurate freehub pawl ratchet clicks + two-beat pedal/tire brush swishes
//        driven directly by `getPelicanWorldState(t)` (`speedScale` & `pedalAngle`), naturally
//        decelerating during Scene #02's Egyptian fresco Bar-2 freeze (`13.2..14.8s`) and
//        delicately ducked during contemplative ink scenes (#05 Northern Song, #09 Bada Shanren).
//   2. Picture-Frame Crossing Transients (5.0, 11.0, ..., 125.0s):
//      - Subtle gallery-frame boundary air ticks every 6.0s + delicate miniature brass bell
//        grace-tings on major structural chapter entries.
//   3. Outro Press-Conference Foley (128.75..137.00s):
//      - Xenon flash capacitor high-pitch charge whines + mechanical two-curtain SLR shutter
//        *ka-chak!* bursts synced to `outro.js` exact `flashTimes` (129.0, 130.0, 131.0, 131.5, 132.0s);
//      - Hushed expectant press-conference room floor (132.5..135.7s, strictly < -50 dBFS);
//      - Rapid stereo-panned Left (-0.94) -> Right (+0.94) bicycle tire/chain corridor streak (135.78..136.42s);
//      - ONE glorious, crystal-clear dual-mode spun-brass bicycle bell `叮铃！` right on the final
//        strong beat `t = 136.000s`, ringing cleanly to `136.985s`.

import {
  BEAT_SEC,
  INTRO_SEC,
  SCENE_SEC,
  NUM_SCENES,
  SCENES_TOTAL_SEC,
  TOTAL_DURATION,
  clamp,
  smoothstep,
  getPelicanWorldState,
} from '../beat/timeline.js';
import { createSeededRng } from './score.js';

/**
 * Returns per-era foley mix multiplier so tactile bicycle mechanics enhance rhythmic
 * propulsion without intruding on ultra-sparse solo ink meditations (#05, #09) or muffled tape (#18).
 */
function getBicycleEraDuckGain(t) {
  if (t < INTRO_SEC) {
    return smoothstep(3.75, 4.45, t) * 0.85;
  }
  const outroStart = INTRO_SEC + SCENES_TOTAL_SEC; // 125.0s
  if (t >= outroStart) {
    return 1.0 - smoothstep(125.05, 125.68, t);
  }

  const st = t - INTRO_SEC;
  const idx = clamp(Math.floor(st / SCENE_SEC), 0, NUM_SCENES - 1);
  const localT = st - idx * SCENE_SEC;

  const eraWeights = [
    0.78, // #01 Sahara: crisp bone/stone dry air
    0.92, // #02 Egypt: highlight Bar-2 freeze deceleration!
    0.75, // #03 Han stone rubbing
    0.70, // #04 Tang baimiao wind
    0.16, // #05 Northern Song monumental landscape: hushed contemplation!
    0.80, // #06 Qingming bustling bridge
    0.82, // #07 Maya codex pedal counter!
    0.72, // #08 Ukiyo-e wave spray
    0.15, // #09 Bada Shanren zen ink void: ultra-delicate!
    0.68, // #10 Guild oil portrait
    0.76, // #11 Impressionist dappled riverside
    0.72, // #12 Starry Night
    0.58, // #13 The Scream
    0.74, // #14 Nosferatu silent-film mechanical feel
    0.64, // #15 Oscilloscope lab
    0.70, // #16 8-bit pixel road
    0.68, // #17 2000s desktop
    0.42, // #18 Vaporwave slowed cassette warmth
    0.72, // #19 Short-video beat
    0.66, // #20 Code art epicycles
  ];

  const cur = eraWeights[idx] ?? 0.72;
  const prev = idx > 0 ? (eraWeights[idx - 1] ?? 0.72) : 0.85;
  const next = idx < NUM_SCENES - 1 ? (eraWeights[idx + 1] ?? 0.72) : 0.60;

  // Smooth 120ms crossfade across scene boundaries
  const fadeSec = 0.12;
  if (localT < fadeSec) {
    const u = 0.5 + 0.5 * (localT / fadeSec);
    return prev + (cur - prev) * u;
  }
  if (localT > SCENE_SEC - fadeSec) {
    const u = 0.5 * ((localT - (SCENE_SEC - fadeSec)) / fadeSec);
    return cur + (next - cur) * u;
  }
  return cur;
}

/**
 * Synthesizes a sample-accurate stereo AudioBuffer (`[3.70..125.75s]`) for the continuous
 * bicycle freehub ratchet clicks and 2-beat pedal/tire swishes synced to `getPelicanWorldState(t)`.
 */
function buildBicycleGrooveBuffer(ctx) {
  const sr = ctx.sampleRate;
  const startSec = 3.70;
  const endSec = 125.75;
  const durSec = endSec - startSec;
  const totalSamples = Math.ceil(durSec * sr);
  const buf = ctx.createBuffer(2, totalSamples, sr);
  const chL = buf.getChannelData(0);
  const chR = buf.getChannelData(1);

  const rng = createSeededRng(0x51c1eb1c);
  const dt = 1 / sr;

  // 8.0 pawls/sec = exact 16th-note metallic freehub ticks at 120 BPM (speedScale = 1.0)
  const basePawlsPerSec = 8.0;
  let pawlAccum = 0.0;
  let pawlCount = 0;

  // Track `pedalAngle / PI` integer crossings -> 1 crossing per beat (Left & Right pedal downstrokes!)
  const initState = getPelicanWorldState(startSec);
  let prevPedalStep = Math.floor(initState.pedalAngle / Math.PI);

  // Pre-compute short unit pawl click kernels (normal metallic vs #16 8-bit quantized)
  const clickLen = Math.round(0.0085 * sr);
  const clickNormal = new Float32Array(clickLen);
  const click8Bit = new Float32Array(clickLen);
  for (let k = 0; k < clickLen; k++) {
    const tau = k / sr;
    const env = Math.exp(-tau * 620);
    const body =
      0.62 * Math.sin(2 * Math.PI * 3720 * tau) +
      0.38 * Math.sin(2 * Math.PI * 6340 * tau + 0.4) +
      (k < 4 ? 0.55 * (1 - k / 4) : 0);
    clickNormal[k] = body * env;
    // Quantized 4-bit stepped crisp tick for Scene #16 (95.0..101.0s)
    const sq = Math.sin(2 * Math.PI * 3520 * tau) >= 0 ? 0.75 : -0.75;
    click8Bit[k] = Math.round(sq * env * 8) / 8;
  }

  // Soft pedal/tire air-brush kernel (~58ms filtered swish)
  const swishLen = Math.round(0.058 * sr);
  let pinkState = 0;

  for (let i = 0; i < totalSamples; i++) {
    const t = startSec + i * dt;
    const state = getPelicanWorldState(t);
    if (!state.visibleInScroll || state.speedScale <= 0.02) {
      prevPedalStep = Math.floor(state.pedalAngle / Math.PI);
      continue;
    }

    const duck = getBicycleEraDuckGain(t);
    if (duck <= 0.005) continue;

    // 1. Integrate instantaneous wheel speed for freehub ratchet clicks
    pawlAccum += state.speedScale * basePawlsPerSec * dt;
    if (pawlAccum >= 1.0) {
      pawlAccum -= Math.floor(pawlAccum);
      pawlCount++;

      const is8BitEra = t >= 95.0 && t < 101.0;
      const isVaporEra = t >= 107.0 && t < 113.0;
      const kernel = is8BitEra ? click8Bit : clickNormal;

      // Subtle groove accent on beat/off-beat pawls + micro humanization
      const accent = pawlCount % 4 === 0 ? 1.22 : pawlCount % 2 === 0 ? 0.96 : 0.78;
      const vel = (0.026 + 0.012 * clamp(state.speedScale, 0.15, 1.25)) *
        accent *
        duck *
        (0.92 + 0.16 * rng());

      // Slight right-of-center pan (+0.10) for drivetrain chainring side
      const gL = vel * (isVaporEra ? 0.62 : 0.90);
      const gR = vel * (isVaporEra ? 0.72 : 1.08);
      const maxK = Math.min(clickLen, totalSamples - i);
      for (let k = 0; k < maxK; k++) {
        const sVal = kernel[k];
        chL[i + k] += sVal * gL;
        chR[i + k] += sVal * gR;
      }
    }

    // 2. Two-beat crank revolution: Left/Right webbed foot downstroke tire/chain swish
    const curPedalStep = Math.floor(state.pedalAngle / Math.PI);
    if (curPedalStep > prevPedalStep) {
      prevPedalStep = curPedalStep;
      const isRightFoot = curPedalStep % 2 === 0;
      const swishAmp = 0.017 * clamp(state.speedScale, 0.2, 1.2) * duck;
      const panL = isRightFoot ? 0.84 : 1.12;
      const panR = isRightFoot ? 1.12 : 0.84;
      const maxS = Math.min(swishLen, totalSamples - i);
      for (let k = 0; k < maxS; k++) {
        const u = k / swishLen;
        const win = Math.sin(Math.PI * u) * Math.exp(-2.4 * u);
        const w = rng() * 2 - 1;
        pinkState = 0.76 * pinkState + 0.24 * w;
        const band = pinkState - 0.35 * w; // warm mid-band tire/spoke air brush
        const v = band * win * swishAmp;
        chL[i + k] += v * panL;
        chR[i + k] += v * panR;
      }
    }
  }

  return { buf, startSec };
}

/**
 * Schedules a delicate gallery picture-frame boundary crossing whisper (`t = 5.0 + 6.0 * k`),
 * plus a subtle miniature brass bell grace-ting on select milestone entries.
 */
function scheduleFrameCrossings(ctx, foleyBus, sharedAssets) {
  const noiseBuf = sharedAssets.pinkNoise || sharedAssets.whiteNoise;
  const milestoneCrossings = new Set([0, 5, 10, 15, 20]); // 5.0s, 35.0s, 65.0s, 95.0s, 125.0s

  for (let k = 0; k <= NUM_SCENES; k++) {
    const tCross = INTRO_SEC + k * SCENE_SEC; // 5.0, 11.0, ..., 125.0s
    // Duck heavily on quiet ink entries (#05 at 29.0s -> k=4, #09 at 53.0s -> k=8)
    const isQuietBorder = k === 4 || k === 5 || k === 8 || k === 9;
    const borderScale = isQuietBorder ? 0.28 : 1.0;

    // Soft wooden/canvas frame air pass (-0.18 -> +0.18 stereo brush)
    if (noiseBuf) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      const offset = (k * 0.43) % Math.max(0.2, noiseBuf.duration - 0.15);

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(920, tCross - 0.03);
      bp.frequency.exponentialRampToValueAtTime(1680, tCross + 0.045);
      bp.Q.value = 2.4;

      const pan = ctx.createStereoPanner();
      pan.pan.setValueAtTime(-0.22, tCross - 0.03);
      pan.pan.linearRampToValueAtTime(0.22, tCross + 0.05);

      const g = ctx.createGain();
      const peak = 0.024 * borderScale;
      g.gain.setValueAtTime(0.0001, tCross - 0.032);
      g.gain.linearRampToValueAtTime(peak, tCross);
      g.gain.exponentialRampToValueAtTime(0.0001, tCross + 0.055);

      src.connect(bp);
      bp.connect(pan);
      pan.connect(g);
      g.connect(foleyBus);

      src.start(tCross - 0.032, offset, 0.095);
      src.stop(tCross + 0.062);
    }

    // Delicate miniature brass bell grace-ting on 5 structural chapter milestones
    if (milestoneCrossings.has(k)) {
      const tingAmp = k === 0 || k === 20 ? 0.036 : 0.022;
      const freqs = [2349.32, 4712.4]; // D7 + bright spun-brass overtone
      for (let m = 0; m < freqs.length; m++) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freqs[m];

        const g = ctx.createGain();
        const a = tingAmp * (m === 0 ? 1.0 : 0.35);
        const dur = m === 0 ? 0.28 : 0.14;
        g.gain.setValueAtTime(0.0001, tCross);
        g.gain.linearRampToValueAtTime(a, tCross + 0.0025);
        g.gain.exponentialRampToValueAtTime(0.0001, tCross + dur);

        osc.connect(g);
        g.connect(foleyBus);
        osc.start(tCross);
        osc.stop(tCross + dur + 0.01);
      }
    }
  }
}

/**
 * Schedules a single press-photographer xenon flash + mechanical two-curtain SLR shutter *ka-chak!*
 * at exact timestamp `tFlash`.
 */
function schedulePressCameraFlash(ctx, destBus, reverbSend, sharedAssets, tFlash, panPos, intensity = 1.0) {
  const noiseBuf = sharedAssets.whiteNoise || sharedAssets.pinkNoise;

  const panner = ctx.createStereoPanner();
  panner.pan.setValueAtTime(panPos, tFlash - 0.24);
  panner.connect(destBus);
  if (reverbSend) {
    const sendGain = ctx.createGain();
    sendGain.gain.value = 0.16;
    panner.connect(sendGain);
    sendGain.connect(reverbSend);
  }

  // 1. High-voltage xenon flash capacitor charge whine (tFlash - 0.21s -> tFlash)
  const whineOsc = ctx.createOscillator();
  whineOsc.type = 'sine';
  whineOsc.frequency.setValueAtTime(3250, tFlash - 0.21);
  whineOsc.frequency.exponentialRampToValueAtTime(6950, tFlash - 0.003);

  const whineGain = ctx.createGain();
  whineGain.gain.setValueAtTime(0.0001, tFlash - 0.21);
  whineGain.gain.exponentialRampToValueAtTime(0.016 * intensity, tFlash - 0.012);
  whineGain.gain.linearRampToValueAtTime(0.0001, tFlash + 0.002);

  whineOsc.connect(whineGain);
  whineGain.connect(panner);
  whineOsc.start(tFlash - 0.21);
  whineOsc.stop(tFlash + 0.006);

  // 2. Mechanical SLR two-curtain shutter & mirror slap:
  //    - Curtain 1 + mirror flip up + xenon arc pop at `tFlash` ("ka-")
  //    - Curtain 2 + mirror return bounce at `tFlash + 0.036s` ("-chak!")
  const curtains = [
    { dt: 0.000, freq: 1580, hiFreq: 5400, amp: 0.19 * intensity, dur: 0.026 },
    { dt: 0.036, freq: 1240, hiFreq: 4100, amp: 0.15 * intensity, dur: 0.032 },
  ];

  for (const c of curtains) {
    const t0 = tFlash + c.dt;

    if (noiseBuf) {
      const nSrc = ctx.createBufferSource();
      nSrc.buffer = noiseBuf;
      const off = ((tFlash * 1.37 + c.dt * 7) % Math.max(0.2, noiseBuf.duration - 0.1));

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(c.freq, t0);
      bp.Q.value = 1.9;

      const hiShelf = ctx.createBiquadFilter();
      hiShelf.type = 'peaking';
      hiShelf.frequency.value = c.hiFreq;
      hiShelf.Q.value = 2.2;
      hiShelf.gain.value = 7.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(c.amp, t0 + 0.0012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + c.dur);

      nSrc.connect(bp);
      bp.connect(hiShelf);
      hiShelf.connect(g);
      g.connect(panner);

      nSrc.start(t0, off, c.dur + 0.01);
      nSrc.stop(t0 + c.dur + 0.012);
    }

    // Crisp metallic mirror-box spring transient
    const clickOsc = ctx.createOscillator();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(c.hiFreq * 0.55, t0);
    clickOsc.frequency.exponentialRampToValueAtTime(420, t0 + 0.014);

    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(c.amp * 0.55, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.015);

    clickOsc.connect(clickGain);
    clickGain.connect(panner);
    clickOsc.start(t0);
    clickOsc.stop(t0 + 0.018);
  }

  // 3. Xenon flash-tube plasma discharge micro-pop at exact `tFlash`
  const popOsc = ctx.createOscillator();
  popOsc.type = 'sine';
  popOsc.frequency.setValueAtTime(8200, tFlash);
  popOsc.frequency.exponentialRampToValueAtTime(1900, tFlash + 0.009);

  const popGain = ctx.createGain();
  popGain.gain.setValueAtTime(0.085 * intensity, tFlash);
  popGain.gain.exponentialRampToValueAtTime(0.0001, tFlash + 0.010);

  popOsc.connect(popGain);
  popGain.connect(panner);
  popOsc.start(tFlash);
  popOsc.stop(tFlash + 0.012);
}

/**
 * Schedules the rapid stereo-panned Left (-0.94) -> Right (+0.94) bicycle corridor streak
 * (`135.78..136.42s`, synced to `outro.js` `outroT = 10.78..11.42s`).
 */
function scheduleOutroBicycleStreak(ctx, foleyBus, sharedAssets) {
  const tStart = 135.78;
  const tEnd = 136.42;
  const dur = tEnd - tStart; // 0.64s
  const tPeak = 136.02;

  const streakPanner = ctx.createStereoPanner();
  streakPanner.pan.setValueAtTime(-0.94, tStart);
  streakPanner.pan.linearRampToValueAtTime(0.06, tPeak);
  streakPanner.pan.linearRampToValueAtTime(0.94, tEnd);
  streakPanner.connect(foleyBus);

  // 1. Aerodynamic slipstream Doppler whoosh
  const noiseBuf = sharedAssets.pinkNoise || sharedAssets.whiteNoise;
  if (noiseBuf) {
    const whooshSrc = ctx.createBufferSource();
    whooshSrc.buffer = noiseBuf;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(340, tStart);
    bp.frequency.exponentialRampToValueAtTime(1750, tPeak);
    bp.frequency.exponentialRampToValueAtTime(380, tEnd);
    bp.Q.value = 1.45;

    const whooshGain = ctx.createGain();
    whooshGain.gain.setValueAtTime(0.0001, tStart);
    whooshGain.gain.linearRampToValueAtTime(0.095, tPeak - 0.02);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

    whooshSrc.connect(bp);
    bp.connect(whooshGain);
    whooshGain.connect(streakPanner);

    whooshSrc.start(tStart, 0.35, dur + 0.03);
    whooshSrc.stop(tEnd + 0.02);
  }

  // 2. High-speed freehub ratchet clicks + spinning spoke hum across the streak
  const numTicks = 14;
  for (let i = 0; i < numTicks; i++) {
    const u = (i + 0.3) / numTicks;
    const tTick = tStart + u * dur;
    const envShape = Math.sin(Math.PI * u);
    // Slight Doppler pitch bend (+12% approaching -> -12% receding)
    const doppler = 1.10 - 0.22 * u;

    const tickOsc = ctx.createOscillator();
    tickOsc.type = 'triangle';
    tickOsc.frequency.setValueAtTime(4200 * doppler, tTick);
    tickOsc.frequency.exponentialRampToValueAtTime(2100 * doppler, tTick + 0.007);

    const tickGain = ctx.createGain();
    tickGain.gain.setValueAtTime(0.0001, tTick);
    tickGain.gain.linearRampToValueAtTime(0.048 * envShape, tTick + 0.0008);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, tTick + 0.0085);

    tickOsc.connect(tickGain);
    tickGain.connect(streakPanner);
    tickOsc.start(tTick);
    tickOsc.stop(tTick + 0.010);
  }
}

/**
 * Schedules the final solo dual-mode spun-brass bicycle bell `叮铃！` right on the final
 * strong beat `t = 136.000s` (`outroT = 11.00s`), ringing cleanly to `136.985s`.
 *
 * Physical acoustics of a classic mechanical thumb-lever brass bicycle bell:
 *   - Strike 1 (`叮`) at `136.000s`: internal rotary steel clapper strikes the brass dome;
 *   - Micro rotary rattle grace bounce at `136.034s`;
 *   - Strike 2 (`铃！`) at `136.076s`: spring-loaded return double-clapper blooms into full resonance!
 *   - Modal spectrum anchored on Home Tonic `D7` (`2349.32 Hz`) + orthogonal spin-beating
 *     doublet (`2353.95 Hz`, 4.6 Hz natural acoustic shimmer) + spun-brass shell overtones.
 */
function scheduleFinalSoloBrassBell(ctx, foleyBus, sharedAssets) {
  const tBell = 136.000;
  const tCut = 136.985; // Clean zero before 137.000s end-of-film!

  const bellMaster = ctx.createGain();
  bellMaster.gain.setValueAtTime(1.0, tBell - 0.005);
  bellMaster.gain.setValueAtTime(1.0, 136.88);
  bellMaster.gain.linearRampToValueAtTime(0.0, tCut);
  bellMaster.connect(foleyBus);

  // Subtle press-hall stereo acoustic bloom around the solo bell
  if (sharedAssets.roomReverbIR) {
    const bellVerb = ctx.createConvolver();
    bellVerb.normalize = false;
    bellVerb.buffer = sharedAssets.roomReverbIR;

    const verbHP = ctx.createBiquadFilter();
    verbHP.type = 'highpass';
    verbHP.frequency.value = 650;

    const verbWet = ctx.createGain();
    verbWet.gain.setValueAtTime(0.18, tBell);
    verbWet.gain.setValueAtTime(0.18, 136.84);
    verbWet.gain.linearRampToValueAtTime(0.0, tCut);

    bellMaster.connect(bellVerb);
    bellVerb.connect(verbHP);
    verbHP.connect(verbWet);
    verbWet.connect(foleyBus);
  }

  // Spun-brass dome physical modes (tuned cleanly to D6 / D7 tonic family!)
  const modes = [
    { freq: 1174.66, amp: 0.11, decay: 0.62, pan: -0.04 }, // (1,1) warm cavity undertone D6
    { freq: 2349.32, amp: 0.34, decay: 0.90, pan: -0.06 }, // (2,0) primary ring fundamental D7
    { freq: 2353.95, amp: 0.25, decay: 0.86, pan: 0.07 },  // (2,0)' orthogonal spin doublet (4.6Hz shimmer!)
    { freq: 3523.98, amp: 0.12, decay: 0.55, pan: -0.09 }, // Fifth partial A7
    { freq: 4706.80, amp: 0.16, decay: 0.44, pan: 0.08 },  // (3,1) bright brass dome brilliance
    { freq: 7054.20, amp: 0.08, decay: 0.26, pan: -0.05 }, // (4,1) crystalline silver-brass ping
    { freq: 9412.00, amp: 0.045, decay: 0.15, pan: 0.05 }, // (5,1) initial metal-on-metal sparkle
  ];

  // Classic rotary double-strike ("叮—铃！")
  const strikes = [
    { dt: 0.000, vel: 0.92, brightness: 1.00 }, // Primary "叮" right on strong beat 136.000s!
    { dt: 0.034, vel: 0.28, brightness: 1.15 }, // Internal rotary gear micro-rattle
    { dt: 0.076, vel: 1.04, brightness: 1.08 }, // Spring-return "铃！" bloom
  ];

  const noiseBuf = sharedAssets.whiteNoise;

  for (const st of strikes) {
    const t0 = tBell + st.dt;

    // Modal sinusoidal resonators
    for (let m = 0; m < modes.length; m++) {
      const md = modes[m];
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // Tiny pitch-settle chirp (+14 cents -> 0 in 4ms) from steel striker elasticity
      osc.frequency.setValueAtTime(md.freq * 1.008, t0);
      osc.frequency.exponentialRampToValueAtTime(md.freq, t0 + 0.0045);

      const pan = ctx.createStereoPanner();
      pan.pan.value = md.pan;

      const g = ctx.createGain();
      const hiBoost = m >= 4 ? st.brightness : 1.0;
      const peakAmp = md.amp * st.vel * hiBoost;
      const tStop = Math.min(tCut, t0 + md.decay);

      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(peakAmp, t0 + 0.0014);
      g.gain.exponentialRampToValueAtTime(0.0002, tStop);

      osc.connect(pan);
      pan.connect(g);
      g.connect(bellMaster);

      osc.start(t0);
      osc.stop(tStop + 0.005);
    }

    // Crisp 4ms steel clapper-on-brass contact transient
    if (noiseBuf) {
      const cSrc = ctx.createBufferSource();
      cSrc.buffer = noiseBuf;

      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 6400;
      hp.Q.value = 2.8;

      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.11 * st.vel, t0);
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.0055);

      cSrc.connect(hp);
      hp.connect(cg);
      cg.connect(bellMaster);

      cSrc.start(t0, st.dt * 2.1, 0.008);
      cSrc.stop(t0 + 0.008);
    }
  }
}

/**
 * Schedules Outro press-conference foley (`128.75..137.00s`):
 *   - 5 press-camera flash bursts at `129.0, 130.0, 131.0, 131.5, 132.0s`;
 *   - Ultra-quiet expectant press-room microphone floor (`132.50..135.72s`, < -52 dBFS);
 *   - Rapid Left -> Right bicycle streak (`135.78..136.42s`);
 *   - Final solo dual-mode brass bicycle bell (`136.000..136.985s`).
 */
function scheduleOutroPressFoley(ctx, foleyBus, sharedAssets) {
  // Dedicated short room-reverb bus for the press flashes, hard-gated to 0.0 at 132.48s
  // so zero tail energy leaks into the hushed 132.9..135.65s window!
  let flashVerbIn = null;
  if (sharedAssets.roomReverbIR) {
    flashVerbIn = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = sharedAssets.roomReverbIR;

    const flashVerbGate = ctx.createGain();
    flashVerbGate.gain.setValueAtTime(1.0, 128.70);
    flashVerbGate.gain.setValueAtTime(1.0, 132.32);
    flashVerbGate.gain.linearRampToValueAtTime(0.0, 132.48);

    flashVerbIn.connect(conv);
    conv.connect(flashVerbGate);
    flashVerbGate.connect(foleyBus);
  }

  // Exact `flashTimes` from `src/scenes/outro.js`: outroT = [4.0, 5.0, 6.0, 6.5, 7.0] -> global + 125.0s
  const flashes = [
    { t: 129.00, pan: -0.58, intensity: 0.92 },
    { t: 130.00, pan: 0.54, intensity: 0.96 },
    { t: 131.00, pan: -0.32, intensity: 1.00 },
    { t: 131.50, pan: 0.62, intensity: 0.95 },
    { t: 132.00, pan: -0.14, intensity: 1.06 },
  ];
  for (const f of flashes) {
    schedulePressCameraFlash(ctx, foleyBus, flashVerbIn, sharedAssets, f.t, f.pan, f.intensity);
  }

  // Ultra-faint expectant press-room podium mic floor (132.50..135.72s)
  // Kept around ~0.0012 linear (~ -58 dBFS RMS), comfortably below the -42 dBFS ceiling!
  const tHumStart = 132.50;
  const tHumEnd = 135.72;

  const micHumOsc = ctx.createOscillator();
  micHumOsc.type = 'sine';
  micHumOsc.frequency.value = 60.0;

  const micHarmOsc = ctx.createOscillator();
  micHarmOsc.type = 'sine';
  micHarmOsc.frequency.value = 180.0;

  const micHumGain = ctx.createGain();
  micHumGain.gain.setValueAtTime(0.0, tHumStart);
  micHumGain.gain.linearRampToValueAtTime(0.0009, tHumStart + 0.35);
  micHumGain.gain.setValueAtTime(0.0009, tHumEnd - 0.18);
  micHumGain.gain.linearRampToValueAtTime(0.0, tHumEnd);

  const micHarmGain = ctx.createGain();
  micHarmGain.gain.value = 0.32;

  micHumOsc.connect(micHumGain);
  micHarmOsc.connect(micHarmGain);
  micHarmGain.connect(micHumGain);
  micHumGain.connect(foleyBus);

  micHumOsc.start(tHumStart);
  micHumOsc.stop(tHumEnd + 0.02);
  micHarmOsc.start(tHumStart);
  micHarmOsc.stop(tHumEnd + 0.02);

  if (sharedAssets.pinkNoise) {
    const airSrc = ctx.createBufferSource();
    airSrc.buffer = sharedAssets.pinkNoise;
    airSrc.loop = true;

    const airBP = ctx.createBiquadFilter();
    airBP.type = 'bandpass';
    airBP.frequency.value = 420;
    airBP.Q.value = 0.9;

    const airGain = ctx.createGain();
    airGain.gain.setValueAtTime(0.0, tHumStart);
    airGain.gain.linearRampToValueAtTime(0.0008, tHumStart + 0.35);
    airGain.gain.setValueAtTime(0.0008, tHumEnd - 0.18);
    airGain.gain.linearRampToValueAtTime(0.0, tHumEnd);

    airSrc.connect(airBP);
    airBP.connect(airGain);
    airGain.connect(foleyBus);

    airSrc.start(tHumStart, 0.5);
    airSrc.stop(tHumEnd + 0.02);
  }

  // Rapid stereo-panned Left -> Right corridor bicycle streak (135.78..136.42s)
  scheduleOutroBicycleStreak(ctx, foleyBus, sharedAssets);

  // Glorious solo dual-mode brass bicycle bell right on the final strong beat `t = 136.000s`!
  scheduleFinalSoloBrassBell(ctx, foleyBus, sharedAssets);
}

/**
 * Main entry point called by `src/audio/engine.js`:
 * Schedules continuous speed-synced bicycle percussion, frame-crossing whispers,
 * and Outro press-conference foley (`[0, TOTAL_DURATION]`).
 */
export function scheduleFilmFoley(ctx, foleyBus, sharedAssets = {}) {
  if (!ctx || !foleyBus) return;

  // 1. Continuous speed-synced bicycle freehub & pedal groove (3.70..125.75s)
  const { buf: grooveBuf, startSec } = buildBicycleGrooveBuffer(ctx);
  const grooveSrc = ctx.createBufferSource();
  grooveSrc.buffer = grooveBuf;
  grooveSrc.connect(foleyBus);
  grooveSrc.start(startSec);
  grooveSrc.stop(Math.min(TOTAL_DURATION, startSec + grooveBuf.duration + 0.01));

  // 2. Strong-beat gallery picture-frame boundary whispers & milestone bell tings
  scheduleFrameCrossings(ctx, foleyBus, sharedAssets);

  // 3. Outro press-conference camera flashes, quiet mic air, L->R streak & 136.00s solo bell
  scheduleOutroPressFoley(ctx, foleyBus, sharedAssets);
}
