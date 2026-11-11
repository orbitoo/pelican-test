// src/audio/instruments_world.js
// Stage 4 — Bespoke Procedural Synthesis for Intro (0.0..5.0s), Ancient & World Eras #01..#11
// (5.0..71.0s), and the Balanced World Ensemble Tutti Layer (`scheduleWorldTuttiLayer`) for Outro.
//
// Architecture: Pure-JS Physical/Modal Stereo Buffer Synthesis per Era -> scheduled onto `musicBus`
// & `sharedAssets.hallSend` via 1 lightweight `AudioBufferSourceNode` per Era (only ~36 Web Audio
// nodes total across 0..71s + Outro, keeping Chrome OfflineAudioContext render time < 0.4s while
// guaranteeing exact sample-calibrated peak gain staging ~0.30..0.36 and zero seam clicks!).

import { BEAT_SEC, SCENE_SEC } from '../beat/timeline.js';
import {
  HOME_ROOT_MIDI,
  MAIN_MELODY_MOTIF,
  BASS_PEDAL_MOTIF,
  midiToFreq,
  getEraScaleMapper,
  createSeededRng,
  pluckKarplusStrongBuffer,
} from './score.js';

const TWO_PI = Math.PI * 2;
const worldBufferCache = new WeakMap();

function getNoteCache(ctx) {
  let map = worldBufferCache.get(ctx);
  if (!map) {
    map = new Map();
    worldBufferCache.set(ctx, map);
  }
  return map;
}

function cachedMono(ctx, key, builderFn) {
  const cache = getNoteCache(ctx);
  let arr = cache.get(key);
  if (!arr) {
    arr = builderFn(ctx.sampleRate);
    cache.set(key, arr);
  }
  return arr;
}

function cachedKS(ctx, key, freq, dur, options) {
  const cache = getNoteCache(ctx);
  const fullKey = `ks_${key}_${freq.toFixed(2)}_${dur.toFixed(2)}`;
  let arr = cache.get(fullKey);
  if (!arr) {
    const buf = pluckKarplusStrongBuffer(ctx, freq, dur, options);
    // Copy Float32Array so we can mix directly in JS with zero AudioNode overhead
    arr = new Float32Array(buf.getChannelData(0));
    cache.set(fullKey, arr);
  }
  return arr;
}

/**
 * Stereo Float32 accumulator for a single Era `[t0, t1 + tail]`, with constant-power panning,
 * micro-click protection, calibrated peak target (`~0.30..0.36`), and smooth `15ms` / `30ms` seam fades.
 */
class EraStereoMixer {
  constructor(sampleRate, durationSec, tailSec = 0.032) {
    this.sr = sampleRate;
    this.mainDur = durationSec;
    this.tailSec = tailSec;
    this.totalDur = durationSec + tailSec;
    this.length = Math.max(64, Math.round(this.totalDur * sampleRate));
    this.L = new Float32Array(this.length);
    this.R = new Float32Array(this.length);
  }

  mixMono(samples, startSec, gain = 1.0, pan = 0.0, maxDurSec = Infinity) {
    if (!samples || samples.length === 0 || gain <= 1e-5) return;
    const sr = this.sr;
    const dstStart = Math.round(startSec * sr);
    if (dstStart >= this.length) return;

    const clampedPan = Math.max(-1, Math.min(1, pan));
    const panAngle = (clampedPan + 1) * Math.PI * 0.25;
    const gL = gain * Math.cos(panAngle);
    const gR = gain * Math.sin(panAngle);

    const maxSamples = Number.isFinite(maxDurSec)
      ? Math.min(samples.length, Math.round(maxDurSec * sr))
      : samples.length;
    const fadeLen = Math.min(maxSamples >> 2, Math.round(0.014 * sr));

    let srcIdx = 0;
    let dstIdx = dstStart;
    if (dstIdx < 0) {
      srcIdx = -dstIdx;
      dstIdx = 0;
    }
    const endSrc = Math.min(maxSamples, srcIdx + (this.length - dstIdx));
    const fadeStart = maxSamples - fadeLen;

    const L = this.L;
    const R = this.R;
    for (; srcIdx < endSrc; srcIdx++, dstIdx++) {
      let s = samples[srcIdx];
      if (srcIdx >= fadeStart && fadeLen > 0) {
        s *= (maxSamples - srcIdx) / fadeLen;
      }
      L[dstIdx] += s * gL;
      R[dstIdx] += s * gR;
    }
  }

  toAudioBuffer(ctx, targetPeak = 0.34, preserveDynamicsFloor = 0.0) {
    const sr = this.sr;
    const len = this.length;
    const L = this.L;
    const R = this.R;

    let rawPeak = 1e-6;
    for (let i = 0; i < len; i++) {
      const aL = Math.abs(L[i]);
      const aR = Math.abs(R[i]);
      if (aL > rawPeak) rawPeak = aL;
      if (aR > rawPeak) rawPeak = aR;
    }

    // Gentle soft-transient rounding before peak calibration so high-crest plucked strings
    // (Shamisen bachi, Sitar, Harp) retain full singing body alongside sustained winds/chants
    if (rawPeak > 1e-5) {
      const preNorm = 1.25 / rawPeak;
      rawPeak = 1e-6;
      for (let i = 0; i < len; i++) {
        L[i] = Math.tanh(L[i] * preNorm);
        R[i] = Math.tanh(R[i] * preNorm);
        const aL = Math.abs(L[i]);
        const aR = Math.abs(R[i]);
        if (aL > rawPeak) rawPeak = aL;
        if (aR > rawPeak) rawPeak = aR;
      }
    }

    const scale = rawPeak > preserveDynamicsFloor ? targetPeak / rawPeak : 1.0;
    const fadeInSamples = Math.min(len, Math.round(0.015 * sr));
    const tailStart = Math.max(0, Math.round((this.mainDur - 0.012) * sr));
    const tailSpan = Math.max(1, len - tailStart);

    const audioBuf = ctx.createBuffer(2, len, sr);
    const outL = audioBuf.getChannelData(0);
    const outR = audioBuf.getChannelData(1);

    for (let i = 0; i < len; i++) {
      let env = 1.0;
      if (i < fadeInSamples) {
        env *= 0.5 - 0.5 * Math.cos((Math.PI * i) / fadeInSamples);
      }
      if (i >= tailStart) {
        const u = (i - tailStart) / tailSpan;
        env *= 0.5 + 0.5 * Math.cos(Math.PI * Math.min(1, u));
      }
      // Gentle soft-knee ceiling guard so transients stay warm and never exceed targetPeak * 1.05
      const vL = L[i] * scale * env;
      const vR = R[i] * scale * env;
      outL[i] = Math.abs(vL) > 0.42 ? Math.tanh(vL * 1.8) * 0.45 : vL;
      outR[i] = Math.abs(vR) > 0.42 ? Math.tanh(vR * 1.8) * 0.45 : vR;
    }

    return audioBuf;
  }
}

function scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, startTime, audioBuffer, hallSendAmt = 0.24) {
  const src = ctx.createBufferSource();
  src.buffer = audioBuffer;
  src.connect(musicBus);

  if (sharedAssets && sharedAssets.hallSend && hallSendAmt > 0.001) {
    const send = ctx.createGain();
    send.gain.value = hallSendAmt;
    src.connect(send);
    send.connect(sharedAssets.hallSend);
  }

  src.start(startTime);
  src.stop(startTime + audioBuffer.duration + 0.005);
}

// ============================================================================
// SHARED PHYSICAL DSP PRIMITIVES (2nd-Order Biquad, Formant Voice, Bronze/Drum Models)
// ============================================================================

function biquadBandpassInPlace(buf, sr, freqHz, q = 3.0) {
  const out = new Float32Array(buf.length);
  const f = Math.max(25, Math.min(sr * 0.44, freqHz));
  const w0 = (TWO_PI * f) / sr;
  const sinW = Math.sin(w0);
  const cosW = Math.cos(w0);
  const alpha = sinW / (2 * Math.max(0.25, q));
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const b2 = -alpha / a0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

function biquadLowpassInPlace(buf, sr, freqHz, q = 0.85) {
  const out = new Float32Array(buf.length);
  const f = Math.max(30, Math.min(sr * 0.44, freqHz));
  const w0 = (TWO_PI * f) / sr;
  const sinW = Math.sin(w0);
  const cosW = Math.cos(w0);
  const alpha = sinW / (2 * Math.max(0.25, q));
  const a0 = 1 + alpha;
  const b1 = (1 - cosW) / a0;
  const b0 = b1 * 0.5;
  const b2 = b0;
  const a1 = (-2 * cosW) / a0;
  const a2 = (1 - alpha) / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x0 = buf[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

function synthFilteredNoise(sr, durSec, freqStart, freqEnd, q = 3.0, seed = 77, attackSec = 0.003) {
  const n = Math.max(16, Math.round(durSec * sr));
  const out = new Float32Array(n);
  const rng = createSeededRng(seed);
  let y1 = 0, y2 = 0, x1 = 0, x2 = 0;

  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const u = i / n;
    const f = Math.max(40, Math.min(sr * 0.43, freqStart * Math.pow(freqEnd / freqStart, u)));
    const w0 = (TWO_PI * f) / sr;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -b0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;

    const env = Math.min(1, t / Math.max(0.0008, attackSec)) * Math.exp(-u * 4.2);
    const x0 = (rng() * 2 - 1) * env;
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0;
    y2 = y1; y1 = y0;
    out[i] = y0 * 2.4;
  }
  return out;
}

/**
 * Synthesizes a 3-formant human vocal chant note using a Rosenberg glottal pulse source
 * + natural throat vibrato + parallel F1/F2/F3 vocal tract resonators.
 */
function synthHumanVocalChant(sr, freq, durSec, vowel = 'ah', slideRatio = 1.0, seed = 301) {
  const VOWELS = {
    ah: [730, 1090, 2440],
    oh: [490, 880, 2350],
    eh: [560, 1720, 2480],
    ey: [440, 2020, 2650],
  };
  const formants = VOWELS[vowel] || VOWELS.ah;
  const n = Math.max(64, Math.round((durSec + 0.06) * sr));
  const glottal = new Float32Array(n);
  const rng = createSeededRng(seed);

  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const slideU = Math.min(1, t / 0.075);
    const curSlide = slideRatio + (1 - slideRatio) * (slideU * slideU * (3 - 2 * slideU));
    const vibEnv = Math.min(1, Math.max(0, (t - 0.08) / 0.16));
    const vib = 1 + 0.011 * vibEnv * Math.sin(TWO_PI * 5.4 * t);
    const fInst = freq * curSlide * vib;

    phase = (phase + fInst / sr) % 1.0;
    // Rosenberg glottal pulse + rich harmonic slope + subtle breath aspiration
    let pulse = 0;
    if (phase < 0.42) {
      const p = phase / 0.42;
      pulse = 0.5 * (1 - Math.cos(Math.PI * p));
    } else if (phase < 0.62) {
      const p = (phase - 0.42) / 0.20;
      pulse = Math.cos(0.5 * Math.PI * p);
    }
    const richEdge = pulse - 0.35 + 0.22 * Math.sin(TWO_PI * phase * 2) + 0.12 * Math.sin(TWO_PI * phase * 3);
    const breath = (rng() * 2 - 1) * (t < 0.04 ? 0.16 : 0.035);

    const attack = Math.min(1, t / 0.026);
    const rel = t > durSec ? Math.max(0, 1 - (t - durSec) / 0.06) : 1.0;
    glottal[i] = (richEdge + breath) * attack * rel;
  }

  const f1 = biquadBandpassInPlace(glottal, sr, formants[0], 5.2);
  const f2 = biquadBandpassInPlace(glottal, sr, formants[1], 7.0);
  const f3 = biquadBandpassInPlace(glottal, sr, formants[2], 9.0);

  const out = new Float32Array(n);
  let chestPhase = 0;
  for (let i = 0; i < n; i++) {
    chestPhase += freq / sr;
    const chest = Math.sin(TWO_PI * chestPhase) * 0.24 * Math.min(1, (i / sr) / 0.03) * (i / sr > durSec ? 0.3 : 1);
    out[i] = f1[i] * 1.9 + f2[i] * 1.45 + f3[i] * 0.75 + chest;
  }
  return out;
}

/**
 * Synthesizes an additive/FM metallic bell or bronze metallophone bar (`编钟`, `镈钟`, `甘美兰`, `小锣`, `腕尺金磬`).
 */
function synthBronzeBell(sr, freq, durSec, partials, opts = {}) {
  const { pitchEndRatio = 1.0, pitchGlideSec = 0.14, ombakHz = 0.0, clickAmt = 0.18, clickFreq = 2200, seed = 505 } = opts;
  const n = Math.max(64, Math.round(durSec * sr));
  const out = new Float32Array(n);
  const pairOffsets = ombakHz > 0 ? [-ombakHz * 0.5, ombakHz * 0.5] : [0];
  const pairScale = ombakHz > 0 ? 0.58 : 1.0;

  for (const df of pairOffsets) {
    for (const p of partials) {
      const baseF = (freq + df) * p.r;
      if (baseF >= sr * 0.44) continue;
      let ph = 0;
      const decRate = 4.6 / Math.max(0.05, p.dec);
      const amp = p.amp * pairScale;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        const fMult = pitchEndRatio !== 1.0
          ? 1 + (pitchEndRatio - 1) * Math.min(1, t / pitchGlideSec)
          : 1.0;
        ph += (baseF * fMult) / sr;
        const attack = Math.min(1, t / 0.0025);
        const env = attack * Math.exp(-t * decRate);
        if (env < 1e-4 && t > 0.02) break;
        out[i] += Math.sin(TWO_PI * ph) * amp * env;
      }
    }
  }

  if (clickAmt > 0) {
    const click = synthFilteredNoise(sr, 0.022, clickFreq, clickFreq * 0.7, 3.5, seed, 0.001);
    for (let i = 0; i < Math.min(n, click.length); i++) {
      out[i] += click[i] * clickAmt;
    }
  }
  return out;
}

/**
 * Synthesizes ethnic membrane drums (`Djembe`, `Talking Drum`, `建鼓/堂鼓`, `Tabla Bayan/Dayan`, `木鼓 Teponaztli`).
 */
function synthMembraneDrum(sr, kind, seed = 808) {
  if (kind === 'djembe_bass' || kind === 'jiangu_center' || kind === 'timpani_hit') {
    const dur = kind === 'timpani_hit' ? 1.35 : 0.34;
    const n = Math.round(dur * sr);
    const out = new Float32Array(n);
    const f0 = kind === 'timpani_hit' ? 92 : 114;
    const f1 = kind === 'timpani_hit' ? 38.89 : 56;
    let ph = 0, ph2 = 0;
    const thump = synthFilteredNoise(sr, 0.045, 480, 180, 1.4, seed, 0.0015);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = f1 + (f0 - f1) * Math.exp(-t * (kind === 'timpani_hit' ? 14 : 26));
      ph += f / sr;
      ph2 += (f * 1.52) / sr;
      const env = Math.min(1, t / 0.0035) * Math.exp(-t * (kind === 'timpani_hit' ? 3.2 : 11.5));
      out[i] = (Math.sin(TWO_PI * ph) * 0.9 + Math.sin(TWO_PI * ph2) * 0.22) * env;
      if (i < thump.length) out[i] += thump[i] * 0.32;
    }
    return out;
  }

  if (kind === 'djembe_tone') {
    const n = Math.round(0.16 * sr);
    const out = new Float32Array(n);
    let ph = 0;
    const snap = synthFilteredNoise(sr, 0.032, 1050, 760, 3.0, seed, 0.001);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = 184 + 52 * Math.exp(-t * 38);
      ph += f / sr;
      out[i] = Math.sin(TWO_PI * ph) * Math.exp(-t * 24) * 0.8 + (i < snap.length ? snap[i] * 0.35 : 0);
    }
    return out;
  }

  if (kind === 'djembe_slap') {
    const snap = synthFilteredNoise(sr, 0.075, 2150, 1380, 2.8, seed, 0.001);
    let ph = 0;
    for (let i = 0; i < snap.length; i++) {
      const t = i / sr;
      ph += (340 * Math.exp(-t * 28)) / sr;
      snap[i] = snap[i] * 0.85 + Math.sin(TWO_PI * ph) * Math.exp(-t * 42) * 0.45;
    }
    return snap;
  }

  if (kind === 'jiangu_rim') {
    return synthFilteredNoise(sr, 0.045, 1480, 1180, 5.8, seed, 0.001);
  }

  if (kind === 'tabla_bayan') {
    const n = Math.round(0.32 * sr);
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // Classic Bayan palm pressure swoop: 82 Hz -> 134 Hz -> 88 Hz!
      const swoop = Math.sin(Math.PI * Math.min(1, t / 0.18));
      const f = 84 + 48 * swoop;
      ph += f / sr;
      out[i] = Math.sin(TWO_PI * ph) * Math.min(1, t / 0.004) * Math.exp(-t * 10.5) * 0.9;
    }
    return out;
  }

  if (kind === 'tabla_dayan_na' || kind === 'tabla_dayan_tin') {
    const fTonic = midiToFreq(HOME_ROOT_MIDI); // Tuned to D4 = 293.66 Hz!
    return synthBronzeBell(
      sr,
      fTonic,
      0.30,
      kind === 'tabla_dayan_tin'
        ? [
            { r: 1.0, amp: 0.85, dec: 0.28 },
            { r: 2.0, amp: 0.42, dec: 0.18 },
            { r: 3.01, amp: 0.22, dec: 0.11 },
          ]
        : [
            { r: 1.0, amp: 0.65, dec: 0.19 },
            { r: 2.02, amp: 0.55, dec: 0.16 },
            { r: 3.04, amp: 0.34, dec: 0.11 },
          ],
      { clickAmt: 0.24, clickFreq: 2650, seed }
    );
  }

  return synthFilteredNoise(sr, 0.04, 1500, 1200, 4.5, seed, 0.001);
}

// ============================================================================
// 0. INTRO (0.0s .. 5.0s) — Archival Room Tone + 0.75s Chamber Motif -> 3.00s Strong-Beat Drum/Piano -> Anticipation!
// ============================================================================
function renderIntroBuffer(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, 5.0, 0.035);
  const scale = getEraScaleMapper('major', HOME_ROOT_MIDI);

  // 1. Subtle archival rag-paper museum room tone (0.0..5.0s)
  {
    const rng = createSeededRng(1001);
    const n = Math.round(5.0 * sr);
    const room = new Float32Array(n);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += 0.045 * ((rng() * 2 - 1) - lp);
      const env = Math.min(1, t / 0.45) * (1 - 0.6 * Math.max(0, (t - 4.2) / 0.8));
      room[i] = lp * env * 0.085;
    }
    mix.mixMono(room, 0.0, 0.55, 0.0);
  }

  // 2. Delicate documentary clavichord + solo cello pizzicato motif at 0.75s
  const docNotes = [
    { t: 0.75, dur: 0.52, deg: 0, oct: 0, vel: 0.72 },
    { t: 1.25, dur: 0.25, deg: 1, oct: 0, vel: 0.60 },
    { t: 1.50, dur: 0.50, deg: 2, oct: 0, vel: 0.68 },
    { t: 2.00, dur: 0.85, deg: 4, oct: 0, vel: 0.78 },
  ];
  docNotes.forEach((n, idx) => {
    const f = midiToFreq(scale(n.deg, n.oct));
    const clavi = cachedKS(ctx, 'intro_clavi', f, 1.05, {
      damping: 0.22,
      decay: 0.9935,
      pickPosition: 0.14,
      pluckHardness: 0.72,
      bodyModes: [{ freq: 260, q: 3.2, gain: 0.28 }, { freq: 720, q: 4.0, gain: 0.20 }],
      seed: 400 + idx,
    });
    mix.mixMono(clavi, n.t, 0.45 * n.vel, 0.18, n.dur + 0.25);

    const celloPizz = cachedKS(ctx, 'intro_pizz', f * 0.5, 0.85, {
      damping: 0.50,
      decay: 0.992,
      pickPosition: 0.32,
      pluckHardness: 0.28,
      bodyModes: [{ freq: 185, q: 3.0, gain: 0.36 }],
      seed: 440 + idx,
    });
    mix.mixMono(celloPizz, n.t, 0.48 * n.vel, -0.20, n.dur + 0.22);
  });

  // Warm documentary arco cello low-register sustain (0.75..2.92s)
  {
    const dur = 2.18;
    const n = Math.round(dur * sr);
    const arco = new Float32Array(n);
    let ph = 0;
    const fD3 = midiToFreq(50);
    const fA2 = midiToFreq(45);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = t < 1.25 ? fD3 : fA2;
      const vib = 1 + 0.006 * Math.sin(TWO_PI * 5.0 * t);
      ph = (ph + (f * vib) / sr) % 1.0;
      const saw = 2 * ph - 1;
      const env = Math.min(1, t / 0.28) * (t > 1.85 ? Math.max(0, 1 - (t - 1.85) / 0.33) : 1);
      arco[i] = saw * env * 0.32;
    }
    const warmArco = biquadLowpassInPlace(arco, sr, 540, 1.1);
    mix.mixMono(warmArco, 0.75, 0.45, -0.24);
  }

  // 3. DRAMATIC LOW DRUM & DARK PIANO PUNCTUATION RIGHT ON STRONG BEAT t = 3.000s!
  //    ("「——早在自行车被发明之前。」")
  const timpani = cachedMono(ctx, 'intro_timpani', (s) => synthMembraneDrum(s, 'timpani_hit', 300));
  mix.mixMono(timpani, 3.00, 0.88, 0.0);

  [38, 45, 50, 57, 62].forEach((m, idx) => {
    const pHit = cachedKS(ctx, 'intro_piano', midiToFreq(m), 1.55, {
      damping: 0.30,
      decay: 0.996,
      pickPosition: 0.16,
      pluckHardness: 0.68,
      bodyModes: [{ freq: 145, q: 2.6, gain: 0.32 }],
      seed: 510 + idx,
    });
    mix.mixMono(pHit, 3.00 + idx * 0.006, idx === 0 ? 0.46 : 0.30, (idx - 2) * 0.14, 1.45);
  });

  // 4. Accelerating Anticipation Figure (3.72s .. 5.00s) into Frame #1 Sahara!
  const accelNotes = [
    { t: 3.72, dur: 0.22, midi: 50, vel: 0.48 },
    { t: 3.94, dur: 0.20, midi: 54, vel: 0.56 },
    { t: 4.14, dur: 0.18, midi: 57, vel: 0.64 },
    { t: 4.32, dur: 0.16, midi: 59, vel: 0.72 },
    { t: 4.48, dur: 0.14, midi: 62, vel: 0.80 },
    { t: 4.62, dur: 0.13, midi: 64, vel: 0.88 },
    { t: 4.75, dur: 0.12, midi: 66, vel: 0.94 },
    { t: 4.87, dur: 0.13, midi: 69, vel: 1.00 },
  ];
  const rimTick = cachedMono(ctx, 'intro_rim', (s) => synthMembraneDrum(s, 'jiangu_rim', 580));
  accelNotes.forEach((ev, idx) => {
    const pBuf = cachedKS(ctx, 'intro_accel', midiToFreq(ev.midi), 0.55, {
      damping: 0.24,
      decay: 0.992,
      pickPosition: 0.16,
      pluckHardness: 0.76,
      seed: 560 + idx,
    });
    const pan = -0.30 + (idx / accelNotes.length) * 0.60;
    mix.mixMono(pBuf, ev.t, 0.50 * ev.vel, pan, ev.dur + 0.12);
    mix.mixMono(rimTick, ev.t, 0.18 * ev.vel, -pan);
  });

  return mix.toAudioBuffer(ctx, 0.34);
}

// ============================================================================
// #01 SAHARA (5.0s .. 11.0s) — Djembe & Talking-Drum Polyrhythm + 3-Formant Human Vocal Chant + Leap Claps/Calls
// ============================================================================
function renderEra01Sahara(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_major', HOME_ROOT_MIDI);

  const djBass = cachedMono(ctx, 'dj_bass', (s) => synthMembraneDrum(s, 'djembe_bass', 601));
  const djTone = cachedMono(ctx, 'dj_tone', (s) => synthMembraneDrum(s, 'djembe_tone', 602));
  const djSlap = cachedMono(ctx, 'dj_slap', (s) => synthMembraneDrum(s, 'djembe_slap', 603));

  // Talking drum pitch-swooping stroke builder
  const makeKalangu = (f0, f1, dur, key) =>
    cachedMono(ctx, key, (s) => {
      const n = Math.round(dur * s);
      const out = new Float32Array(n);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / s;
        const f = f0 + (f1 - f0) * Math.min(1, t / (dur * 0.75));
        ph += f / s;
        out[i] = (Math.sin(TWO_PI * ph) + 0.28 * Math.sin(TWO_PI * ph * 2)) * Math.min(1, t / 0.004) * Math.exp(-t * 9.5);
      }
      return out;
    });

  const kalUp = makeKalangu(146.8, 220.0, 0.28, 'kal_up');
  const kalDown = makeKalangu(220.0, 164.8, 0.26, 'kal_down');
  const kalHigh = makeKalangu(146.8, 246.9, 0.32, 'kal_hi');

  const barPattern = [
    { sub: 0.00, buf: djBass, g: 0.72 },
    { sub: 0.75, buf: djSlap, g: 0.46 },
    { sub: 1.00, buf: djTone, g: 0.52 },
    { sub: 1.50, buf: djTone, g: 0.56 },
    { sub: 2.00, buf: djBass, g: 0.68 },
    { sub: 2.50, buf: djSlap, g: 0.52 },
    { sub: 3.00, buf: djTone, g: 0.50 },
    { sub: 3.50, buf: djSlap, g: 0.54 },
    { sub: 3.75, buf: djTone, g: 0.42 },
  ];

  for (let bar = 0; bar < 3; bar++) {
    const bt = bar * 4 * BEAT_SEC;
    for (const h of barPattern) {
      mix.mixMono(h.buf, bt + h.sub * BEAT_SEC, h.g, -0.24);
    }
    mix.mixMono(kalUp, bt + 0.5 * BEAT_SEC, 0.44, 0.34);
    mix.mixMono(kalDown, bt + 1.5 * BEAT_SEC, 0.40, 0.34);
    mix.mixMono(kalHigh, bt + 2.75 * BEAT_SEC, 0.46, 0.34);
  }

  // 2. Warm 3-Formant Human Vocal Chant (`人声吟唱`) singing MAIN_MELODY_MOTIF
  const vowels = ['ah', 'oh', 'eh', 'ah', 'oh', 'ah', 'eh'];
  MAIN_MELODY_MOTIF.forEach((n, idx) => {
    const nt = n.beat * BEAT_SEC;
    const dur = n.dur * BEAT_SEC * 0.94;
    const fTenor = midiToFreq(scale(n.deg, n.oct));
    const fBari = fTenor * 0.5;
    const v = vowels[idx % vowels.length];

    const bariVox = cachedMono(ctx, `vox_b_${fBari.toFixed(1)}_${dur.toFixed(2)}_${v}`, (s) =>
      synthHumanVocalChant(s, fBari, dur, v, n.accent ? 0.94 : 1.0, 610 + idx)
    );
    const tenorVox = cachedMono(ctx, `vox_t_${fTenor.toFixed(1)}_${dur.toFixed(2)}_${v}`, (s) =>
      synthHumanVocalChant(s, fTenor, dur, v, 1.0, 650 + idx)
    );
    mix.mixMono(bariVox, nt, 0.56 * (n.vel ?? 0.9), -0.06);
    mix.mixMono(tenorVox, nt, 0.48 * (n.vel ?? 0.9), 0.10);

    // Bar 2 & 3 jubilant tribal fifth chorus response as Tassili herders leap!
    if (n.beat >= 4.0) {
      const fHarm = midiToFreq(scale(n.deg - 3, n.oct));
      const harmVox = cachedMono(ctx, `vox_h_${fHarm.toFixed(1)}_${dur.toFixed(2)}`, (s) =>
        synthHumanVocalChant(s, fHarm, dur, 'oh', 1.0, 680 + idx)
      );
      mix.mixMono(harmVox, nt + 0.01, 0.34 * (n.vel ?? 0.9), -0.35);
    }
  });

  // 3. Jubilant Handclaps & Celebratory High Vocal Leap Calls in Bar 2!
  const clapA = cachedMono(ctx, 'sahara_clap_a', (s) => synthFilteredNoise(s, 0.055, 1420, 1180, 3.4, 691, 0.0015));
  const clapB = cachedMono(ctx, 'sahara_clap_b', (s) => synthFilteredNoise(s, 0.055, 1680, 1340, 3.6, 692, 0.0015));
  [4.0, 4.5, 5.0, 5.75, 6.0, 6.5, 7.0, 7.5, 8.0, 9.0, 10.0, 11.0].forEach((b, idx) => {
    const ct = b * BEAT_SEC;
    const g = b < 8.5 ? 0.42 : 0.28;
    mix.mixMono(clapA, ct, g, -0.38);
    mix.mixMono(clapB, ct + 0.011, g * 0.9, 0.38);
    if (idx % 2 === 0) mix.mixMono(clapA, ct + 0.021, g * 0.75, 0.12);
  });

  // High joyful "Ey-ya!" calls at 7.00s, 7.75s, 8.50s
  [
    { b: 4.0, f: 587.33, ratio: 0.88, pan: 0.42 },
    { b: 5.5, f: 659.25, ratio: 0.90, pan: -0.42 },
    { b: 7.0, f: 783.99, ratio: 0.85, pan: 0.38 },
  ].forEach((c, idx) => {
    const callBuf = cachedMono(ctx, `sahara_call_${idx}`, (s) => synthHumanVocalChant(s, c.f, 0.28, 'ey', c.ratio, 695 + idx));
    mix.mixMono(callBuf, c.b * BEAT_SEC, 0.38, c.pan);
  });

  return mix.toAudioBuffer(ctx, 0.35);
}

// ============================================================================
// #02 EGYPT (11.0s .. 17.0s) — Hijaz Arched Harp + Bronze Sistrum + freeze_bar2 Suspension & 13.90s Cubit Chime!
// ============================================================================
function renderEra02Egypt(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('egypt_hijaz', HOME_ROOT_MIDI);

  const pluckHarp = (midi, t, dur, gain, pan = 0) => {
    const buf = cachedKS(ctx, 'egypt_harp', midiToFreq(midi), Math.max(0.85, dur + 0.45), {
      damping: 0.38,
      decay: 0.996,
      pickPosition: 0.26,
      pluckHardness: 0.45,
      bodyModes: [{ freq: 225, q: 3.2, gain: 0.34 }, { freq: 470, q: 3.8, gain: 0.22 }],
      seed: 700 + Math.round(midi),
    });
    mix.mixMono(buf, t, gain, pan, dur + 0.4);
  };

  const sistrumLong = cachedMono(ctx, 'egypt_sistrum_lg', (s) =>
    synthBronzeBell(
      s,
      4180,
      0.18,
      [
        { r: 1.0, amp: 0.42, dec: 0.14 },
        { r: 1.56, amp: 0.35, dec: 0.12 },
        { r: 2.13, amp: 0.26, dec: 0.09 },
      ],
      { clickAmt: 0.38, clickFreq: 6200, seed: 730 }
    )
  );

  // 1. Bar 1 & Bar 3 Hijaz Arched Harp Melody (suspending across freeze_bar2 13.0..14.8s = localT 2.0..3.8s!)
  for (const n of MAIN_MELODY_MOTIF) {
    if (n.beat >= 4.0 && n.beat < 7.6) continue;
    const nt = n.beat * BEAT_SEC;
    pluckHarp(scale(n.deg, n.oct), nt, n.dur * BEAT_SEC, 0.62 * (n.vel ?? 0.9), -0.06);
    if (n.accent) {
      pluckHarp(scale(0, -1), nt, 0.95, 0.46, -0.28);
      pluckHarp(scale(4, -1), nt + 0.02, 0.85, 0.36, 0.22);
    }
  }

  for (let b = 0; b < 4.0; b += 0.5) {
    mix.mixMono(sistrumLong, b * BEAT_SEC, b % 1 === 0 ? 0.30 : 0.16, 0.34);
  }

  // 2. Bar 2 `freeze_bar2` (`localT 2.0..3.8s` = `13.0..14.8s`): Shimmering Rolled Hijaz Temple Chord
  [scale(0, -1), scale(4, -1), scale(0, 0), scale(1, 0), scale(2, 0), scale(4, 0), scale(7, 0)].forEach((m, idx) => {
    pluckHarp(m, 2.02 + idx * 0.065, 1.85, 0.42 - idx * 0.022, -0.36 + idx * 0.12);
  });

  // Soft sacred Naos sanctuary reed shimmer pad under freeze (localT 2.0..3.85s)
  {
    const dur = 1.85;
    const n = Math.round(dur * sr);
    const pad = new Float32Array(n);
    const freqs = [midiToFreq(scale(0, 0)), midiToFreq(scale(2, 0)), midiToFreq(scale(4, 0))];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.sin(Math.PI * (t / dur));
      pad[i] =
        (Math.sin(TWO_PI * freqs[0] * t) + 0.7 * Math.sin(TWO_PI * freqs[1] * t) + 0.8 * Math.sin(TWO_PI * freqs[2] * t)) *
        env *
        0.16;
    }
    mix.mixMono(pad, 2.0, 0.55, 0.0);
  }

  // Crystalline Golden Royal-Cubit Chime right at t = 13.90s (`localT = 2.90s` — priest measures pelican's beak!)
  const cubitChime = cachedMono(ctx, 'egypt_cubit_chime', (s) =>
    synthBronzeBell(
      s,
      midiToFreq(86), // D6 = 1174.66 Hz
      1.55,
      [
        { r: 1.0, amp: 0.85, dec: 1.45 },
        { r: 2.0, amp: 0.45, dec: 1.05 },
        { r: 2.756, amp: 0.36, dec: 0.82 },
        { r: 4.08, amp: 0.20, dec: 0.52 },
      ],
      { clickAmt: 0.14, clickFreq: 4800, seed: 739 }
    )
  );
  mix.mixMono(cubitChime, 2.90, 0.68, 0.16);
  mix.mixMono(sistrumLong, 2.93, 0.24, -0.22);

  // 3. Bar 3 Sprint Forward (`14.8..17.0s`): brisk ascending Hijaz harp scalar run & sistrum acceleration!
  [0, 1, 2, 3, 4, 5, 6, 7].forEach((deg, idx) => {
    pluckHarp(scale(deg, 0), 3.76 + idx * 0.045, 0.38, 0.34, -0.24 + idx * 0.06);
  });
  for (let b = 7.75; b < 12.0; b += 0.25) {
    const strong = Math.abs(b % 0.5) < 0.01;
    mix.mixMono(sistrumLong, b * BEAT_SEC, strong ? 0.28 : 0.14, 0.34);
  }

  return mix.toAudioBuffer(ctx, 0.33);
}

// ============================================================================
// #03 HAN (17.0s .. 23.0s) — Imperial Eastern Han Bianzhong (`编钟` + `镈钟`) & Jiangu Chariot Cadence
// ============================================================================
function makeBianzhongVoice(ctx, freq, isBozhong = false) {
  return cachedMono(ctx, `han_${isBozhong ? 'bo' : 'bian'}_${freq.toFixed(1)}`, (sr) =>
    synthBronzeBell(
      sr,
      freq,
      isBozhong ? 2.1 : 1.55,
      isBozhong
        ? [
            { r: 1.0, amp: 1.0, dec: 2.0 },
            { r: 1.502, amp: 0.48, dec: 1.5 },
            { r: 2.01, amp: 0.55, dec: 1.3 },
            { r: 2.74, amp: 0.28, dec: 0.8 },
          ]
        : [
            { r: 1.0, amp: 1.0, dec: 1.45 },
            { r: 1.206, amp: 0.24, dec: 0.62 }, // Authentic almond-bell `gu` secondary tone!
            { r: 2.018, amp: 0.52, dec: 1.10 },
            { r: 2.435, amp: 0.34, dec: 0.82 },
            { r: 3.012, amp: 0.25, dec: 0.60 },
            { r: 3.885, amp: 0.14, dec: 0.36 },
          ],
      { clickAmt: isBozhong ? 0.22 : 0.18, clickFreq: isBozhong ? 980 : 2400, seed: 800 + Math.round(freq) }
    )
  );
}

function renderEra03Han(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_major', HOME_ROOT_MIDI);

  const jgCenter = cachedMono(ctx, 'jg_center', (s) => synthMembraneDrum(s, 'jiangu_center', 831));
  const jgRim = cachedMono(ctx, 'jg_rim', (s) => synthMembraneDrum(s, 'jiangu_rim', 832));

  // 1. Imperial Bianzhong playing MAIN_MELODY_MOTIF
  MAIN_MELODY_MOTIF.forEach((n, idx) => {
    const nt = n.beat * BEAT_SEC;
    const f = midiToFreq(scale(n.deg, n.oct));
    const pan = ((idx % 5) - 2) * 0.15;
    mix.mixMono(makeBianzhongVoice(ctx, f, false), nt, 0.56 * (n.vel ?? 0.9), pan, SCENE_SEC - nt + 0.02);
    if (n.accent) {
      mix.mixMono(makeBianzhongVoice(ctx, f * 2, false), nt + 0.005, 0.22 * (n.vel ?? 0.9), -pan, 0.95);
    }
  });

  // 2. Deep Imperial Bozhong (`镈钟`) Bass Bells
  for (const b of BASS_PEDAL_MOTIF) {
    const bt = b.beat * BEAT_SEC;
    const bf = midiToFreq(scale(b.deg, b.oct));
    mix.mixMono(makeBianzhongVoice(ctx, bf, true), bt, 0.48 * b.vel, -0.18, SCENE_SEC - bt + 0.02);
  }

  // 3. Solemn `建鼓` (`Jiangu`) & Wooden Chariot Procession Cadence
  for (let bar = 0; bar < 3; bar++) {
    const bt = bar * 4 * BEAT_SEC;
    mix.mixMono(jgCenter, bt + 0.0 * BEAT_SEC, 0.66, 0.05);
    mix.mixMono(jgRim, bt + 1.0 * BEAT_SEC, 0.36, 0.28);
    mix.mixMono(jgRim, bt + 1.5 * BEAT_SEC, 0.30, 0.28);
    mix.mixMono(jgCenter, bt + 2.0 * BEAT_SEC, 0.58, 0.05);
    mix.mixMono(jgRim, bt + 3.0 * BEAT_SEC, 0.40, 0.28);
    mix.mixMono(jgCenter, bt + 3.5 * BEAT_SEC, 0.50, 0.05);
  }

  return mix.toAudioBuffer(ctx, 0.35);
}

// ============================================================================
// #04 TANG (23.0s .. 29.0s) — High-Tang Pipa (`琵琶`, Bar-2 `轮指` Tremolo) + Bar-3 Ascending `泛音` Ribbon Glissando!
// ============================================================================
function renderEra04Tang(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('tang_yanyue', HOME_ROOT_MIDI);

  const pluckPipa = (midi, t, dur, gain, pan = 0.05, harmonic = false) => {
    const buf = cachedKS(ctx, harmonic ? 'tang_pipa_h' : 'tang_pipa', midiToFreq(midi), Math.max(0.55, dur + 0.25), {
      damping: harmonic ? 0.10 : 0.13,
      decay: harmonic ? 0.9975 : 0.9935,
      pickPosition: 0.11,
      pluckHardness: harmonic ? 0.55 : 0.88,
      skinSnap: harmonic ? 0.0 : 0.26,
      harmonicMode: harmonic,
      bodyModes: [
        { freq: 295, q: 3.4, gain: 0.28 },
        { freq: 590, q: 4.0, gain: 0.26 },
        { freq: 1480, q: 4.5, gain: 0.22 },
      ],
      seed: 900 + Math.round(midi * 2),
    });
    mix.mixMono(buf, t, gain, pan, dur + 0.22);
  };

  // Crisp 4-string `扫拂` (`saofu`) open-chord strums on Bar 1 & Bar 2 downbeats
  [0.0, 4.0].forEach((b) => {
    const st = b * BEAT_SEC;
    [50, 57, 62, 69].forEach((m, idx) => {
      pluckPipa(m, st + idx * 0.014, 0.85, 0.36, -0.20 + idx * 0.12);
    });
  });

  // 1. Pipa Melody: Crisp bone-plectrum in Bar 1 -> THRILLING 18Hz `轮指` (`lunzhi`) Tremolo in Bar 2!
  for (const n of MAIN_MELODY_MOTIF) {
    const nt = n.beat * BEAT_SEC;
    const durSec = n.dur * BEAT_SEC;
    const midi = scale(n.deg, n.oct);

    if (n.beat >= 4.0 && n.beat < 8.0) {
      const step = 0.056;
      const count = Math.max(2, Math.floor(durSec / step));
      for (let k = 0; k < count; k++) {
        const fingerAcc = k === 0 ? 1.0 : 0.62 + ((k % 5) === 0 ? 0.18 : 0);
        pluckPipa(midi, nt + k * step, 0.22, 0.52 * (n.vel ?? 0.9) * fingerAcc, 0.06);
      }
    } else if (n.beat < 8.2) {
      pluckPipa(midi, nt, durSec, 0.64 * (n.vel ?? 0.9), 0.04);
    } else {
      pluckPipa(midi, nt, durSec, 0.38 * (n.vel ?? 0.85), -0.14);
    }
  }

  // Tang Court rosewood `拍板` (`Paiban`) clappers
  const paiban = cachedMono(ctx, 'tang_paiban', (s) => synthFilteredNoise(s, 0.048, 2250, 1850, 6.5, 945, 0.001));
  [0.0, 2.0, 3.5, 4.0, 6.0, 7.5, 8.0].forEach((b) => {
    mix.mixMono(paiban, b * BEAT_SEC, 0.34, -0.34);
  });

  // 2. BAR 3 CELESTIAL SILK RIBBON RELEASE (`localT 4.12..5.90s` = `27.12..28.90s`):
  //    Ascending Pentatonic `泛音` Harmonic Glissando + Swept Airy Yinghuang Silk Breeze!
  const pentAscend = [74, 76, 78, 81, 83, 86, 88, 90, 93, 98];
  pentAscend.forEach((m, idx) => {
    const gt = 4.12 + idx * 0.165;
    if (gt < SCENE_SEC - 0.12) {
      const fadeEnv = 1 - idx * 0.05;
      const pan = -0.38 + (idx / (pentAscend.length - 1)) * 0.78;
      pluckPipa(m, gt, SCENE_SEC - gt, 0.52 * fadeEnv, pan, true);
    }
  });

  const silkBreeze = cachedMono(ctx, 'tang_silk_breeze', (s) => synthFilteredNoise(s, 1.80, 580, 1980, 2.4, 977, 0.38));
  mix.mixMono(silkBreeze, 4.12, 0.32, 0.24, 1.82);

  return mix.toAudioBuffer(ctx, 0.34);
}

// ============================================================================
// #05 SONG (29.0s .. 35.0s) — Northern Song Guqin (`古琴`: Low `散音/吟猱` -> 30.6..33.8s `2.95x` Zoom High `泛音`!)
// ============================================================================
function renderEra05Song(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_yu', HOME_ROOT_MIDI);

  // 1. Subtle distant Northern Song mountain cascade mist (swelling gently during 2.95x cliff zoom)
  {
    const rng = createSeededRng(1102);
    const n = Math.round(SCENE_SEC * sr);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const zoomBell = 0.35 + 0.65 * Math.sin(Math.PI * (t / SCENE_SEC));
      raw[i] = (rng() * 2 - 1) * zoomBell * 0.09;
    }
    const mistL = biquadBandpassInPlace(raw, sr, 760, 1.5);
    const mistR = biquadBandpassInPlace(raw, sr, 1080, 1.7);
    mix.mixMono(mistL, 0.0, 0.48, -0.45);
    mix.mixMono(mistR, 0.0, 0.44, 0.45);
  }

  // 2. Deep Silk-String Open `散音` Bass Anchor (`D2`, `A2`, `D3`)
  [
    { b: 0.0, midi: 38, dur: 2.6, gain: 0.64 },
    { b: 4.0, midi: 45, dur: 2.4, gain: 0.50 },
    { b: 8.0, midi: 50, dur: 1.9, gain: 0.56 },
  ].forEach((bn, idx) => {
    const sanyin = cachedKS(ctx, 'song_sanyin', midiToFreq(bn.midi), bn.dur + 0.3, {
      damping: 0.46,
      decay: 0.997,
      pickPosition: 0.31,
      pluckHardness: 0.30,
      bodyModes: [{ freq: 145, q: 2.8, gain: 0.38 }, { freq: 315, q: 3.4, gain: 0.28 }],
      seed: 1110 + idx,
    });
    mix.mixMono(sanyin, bn.b * BEAT_SEC, bn.gain, -0.16, bn.dur);
  });

  // 3. Guqin Melody: Low `吟猱` portamento outside zoom, crystalline high `泛音` harmonics inside `30.6..33.8s` (`localT 1.6..4.8s`)!
  MAIN_MELODY_MOTIF.forEach((n, idx) => {
    const localT = n.beat * BEAT_SEC;
    const durSec = Math.min(n.dur * BEAT_SEC + 0.35, SCENE_SEC - localT + 0.02);
    const inCliffZoom = localT >= 1.50 && localT <= 4.80;

    if (inCliffZoom) {
      const harmMidi = scale(n.deg, n.oct + 1);
      const fanyin = cachedKS(ctx, 'song_fanyin', midiToFreq(harmMidi), Math.max(0.85, durSec + 0.3), {
        damping: 0.12,
        decay: 0.998,
        pickPosition: 0.25,
        pluckHardness: 0.36,
        harmonicMode: true,
        bodyModes: [{ freq: 440, q: 3.5, gain: 0.22 }],
        seed: 1150 + idx,
      });
      mix.mixMono(fanyin, localT, 0.62 * (n.vel ?? 0.9), ((idx % 3) - 1) * 0.20, durSec);
    } else {
      const baseMidi = scale(n.deg, n.oct - 1);
      const glide = n.accent ? 2.0 : idx % 2 === 0 ? -1.5 : 0.0;
      const anyin = cachedKS(ctx, `song_anyin_${glide.toFixed(1)}`, midiToFreq(baseMidi - glide), Math.max(0.8, durSec + 0.25), {
        damping: 0.44,
        decay: 0.9955,
        pickPosition: 0.28,
        pluckHardness: 0.36,
        glideSemitones: glide,
        glideStartSec: 0.04,
        glideDurSec: Math.min(0.26, durSec * 0.65),
        vibratoHz: 4.8,
        vibratoSemitones: 0.22,
        bodyModes: [{ freq: 175, q: 3.0, gain: 0.34 }, { freq: 365, q: 3.5, gain: 0.24 }],
        seed: 1200 + idx,
      });
      mix.mixMono(anyin, localT, 0.65 * (n.vel ?? 0.9), 0.08, durSec);
    }
  });

  return mix.toAudioBuffer(ctx, 0.32);
}

// ============================================================================
// #06 QINGMING (35.0s .. 41.0s) — Bianjing Dizi (`梆笛` with Nonlinear `笛膜` Buzz & Trills) + Festive `锣鼓`!
// ============================================================================
function synthDiziNote(sr, freq, durSec, trillFreq = 0, seed = 1301) {
  const n = Math.max(64, Math.round((durSec + 0.035) * sr));
  const raw = new Float32Array(n);
  const buzzSrc = new Float32Array(n);
  const rng = createSeededRng(seed);

  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let fInst = freq;
    if (trillFreq > freq && durSec >= 0.32 && t >= 0.04 && t <= Math.min(0.28, durSec * 0.65)) {
      const trillStep = Math.floor((t - 0.04) / 0.052);
      fInst = trillStep % 2 === 0 ? trillFreq : freq;
    }
    const vib = 1 + 0.009 * Math.min(1, t / 0.14) * Math.sin(TWO_PI * 6.2 * t);
    ph = (ph + (fInst * vib) / sr) % 1.0;

    const fluteCore = Math.sin(TWO_PI * ph) * 0.76 + Math.sin(TWO_PI * ph * 2) * 0.24 + Math.sin(TWO_PI * ph * 3) * 0.12;
    // Nonlinear asymmetric reed-membrane (`笛膜` dimo) excitation!
    const dimoWave = fluteCore >= 0 ? Math.tanh(fluteCore * 3.8) : Math.tanh(fluteCore * 1.4) * 0.5;
    const chiff = (rng() * 2 - 1) * (t < 0.028 ? 0.30 : 0.035);

    const attack = Math.min(1, t / 0.015);
    const rel = t > durSec ? Math.max(0, 1 - (t - durSec) / 0.035) : 1.0;
    const env = attack * rel;

    raw[i] = (fluteCore + chiff) * env;
    buzzSrc[i] = dimoWave * env;
  }

  const dimoFormant = biquadBandpassInPlace(buzzSrc, sr, Math.min(4400, Math.max(2500, freq * 3.5)), 3.2);
  for (let i = 0; i < n; i++) {
    raw[i] = raw[i] * 0.76 + dimoFormant[i] * 0.52;
  }
  return raw;
}

function renderEra06Qingming(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_major', HOME_ROOT_MIDI);

  // 1. Joyous Bianjing `梆笛` (+1 octave D5..D6) with `笛膜` buzz & festive trills
  MAIN_MELODY_MOTIF.forEach((n, idx) => {
    const nt = n.beat * BEAT_SEC;
    const dur = n.dur * BEAT_SEC * 0.92;
    const f = midiToFreq(scale(n.deg, n.oct + 1));
    const tf = n.accent ? midiToFreq(scale(n.deg + 1, n.oct + 1)) : 0;
    const diziBuf = cachedMono(ctx, `dizi_${f.toFixed(1)}_${tf.toFixed(1)}_${dur.toFixed(2)}`, (s) =>
      synthDiziNote(s, f, dur, tf, 1300 + idx)
    );
    mix.mixMono(diziBuf, nt, 0.54 * (n.vel ?? 0.9), -0.08);
  });

  // 2. Song-Dynasty Street `堂鼓 + 小锣 (upward pitch swoop!) + 铙钹` (`笛子加锣鼓`)
  const tangguCenter = cachedMono(ctx, 'jg_center', (s) => synthMembraneDrum(s, 'jiangu_center', 831));
  const tangguRim = cachedMono(ctx, 'jg_rim', (s) => synthMembraneDrum(s, 'jiangu_rim', 832));
  const xiaoluo = cachedMono(ctx, 'qm_xiaoluo', (s) =>
    synthBronzeBell(
      s,
      395,
      0.44,
      [
        { r: 1.0, amp: 0.78, dec: 0.38 },
        { r: 2.14, amp: 0.42, dec: 0.26 },
        { r: 3.31, amp: 0.28, dec: 0.18 },
      ],
      { pitchEndRatio: 468 / 395, pitchGlideSec: 0.14, clickAmt: 0.28, clickFreq: 3200, seed: 1360 }
    )
  );
  const naobo = cachedMono(ctx, 'qm_naobo', (s) => synthFilteredNoise(s, 0.24, 5800, 4200, 1.8, 1370, 0.002));

  const drumPattern = [
    { b: 0.0, buf: tangguCenter, g: 0.52 },
    { b: 0.5, buf: tangguRim, g: 0.28 },
    { b: 1.0, buf: tangguRim, g: 0.34 },
    { b: 1.5, buf: tangguCenter, g: 0.40 },
    { b: 2.0, buf: tangguCenter, g: 0.48 },
    { b: 2.75, buf: tangguRim, g: 0.30 },
    { b: 3.0, buf: tangguCenter, g: 0.44 },
    { b: 3.5, buf: tangguRim, g: 0.38 },
  ];

  for (let bar = 0; bar < 3; bar++) {
    const bt = bar * 4 * BEAT_SEC;
    for (const h of drumPattern) {
      mix.mixMono(h.buf, bt + h.b * BEAT_SEC, h.g, 0.16);
    }
    mix.mixMono(xiaoluo, bt + 2.0 * BEAT_SEC, bar === 1 ? 0.42 : 0.30, 0.38);
    if (bar === 1) {
      mix.mixMono(xiaoluo, bt + 0.0 * BEAT_SEC, 0.40, 0.36);
      mix.mixMono(xiaoluo, bt + 3.5 * BEAT_SEC, 0.34, 0.32);
    }
    mix.mixMono(naobo, bt, bar === 1 ? 0.28 : 0.20, -0.34);
  }

  return mix.toAudioBuffer(ctx, 0.35);
}

// ============================================================================
// #07 MAYA (41.0s .. 47.0s) — Breathy Dual Clay Ocarina + Hollowed Log Slit-Drum (`木鼓`) + Jade Tally Clicks!
// ============================================================================
function synthClayOcarina(sr, freq, durSec, seed = 1401) {
  const n = Math.max(64, Math.round((durSec + 0.04) * sr));
  const raw = new Float32Array(n);
  const rng = createSeededRng(seed);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const attackScoop = 1 - 0.018 * Math.exp(-t * 65);
    const vib = 1 + 0.008 * Math.min(1, t / 0.12) * Math.sin(TWO_PI * 5.1 * t);
    ph = (ph + (freq * attackScoop * vib) / sr) % 1.0;

    // Rounded clay-chamber Helmholtz vessel waveform + earthy fipple breath chiff
    const vessel = Math.sin(TWO_PI * ph) * 0.88 + Math.sin(TWO_PI * ph * 2) * 0.14;
    const breath = (rng() * 2 - 1) * (t < 0.045 ? 0.36 : 0.075);
    const env = Math.min(1, t / 0.025) * (t > durSec ? Math.max(0, 1 - (t - durSec) / 0.04) : 1.0);
    raw[i] = (vessel + breath) * env;
  }
  return biquadLowpassInPlace(raw, sr, Math.min(2300, freq * 2.2), 2.2);
}

function renderEra07Maya(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_yu', HOME_ROOT_MIDI);

  // 1. Dual-chamber clay ocarina playing MAIN_MELODY_MOTIF (lead + parallel 4th/5th clay chamber)
  MAIN_MELODY_MOTIF.forEach((n, idx) => {
    const nt = n.beat * BEAT_SEC;
    const dur = n.dur * BEAT_SEC * 0.92;
    const fLead = midiToFreq(scale(n.deg, n.oct + 1));
    const fHarm = midiToFreq(scale(n.deg - 3, n.oct + 1));
    const leadBuf = cachedMono(ctx, `oca_l_${fLead.toFixed(1)}_${dur.toFixed(2)}`, (s) => synthClayOcarina(s, fLead, dur, 1410 + idx));
    const harmBuf = cachedMono(ctx, `oca_h_${fHarm.toFixed(1)}_${dur.toFixed(2)}`, (s) => synthClayOcarina(s, fHarm, dur, 1450 + idx));
    mix.mixMono(leadBuf, nt, 0.52 * (n.vel ?? 0.9), -0.12);
    mix.mixMono(harmBuf, nt, 0.25 * (n.vel ?? 0.9), 0.18);
  });

  // 2. Two-tone hollowed log slit-drum (`木鼓` Teponaztli: D3 = 146.8Hz, F3 = 174.6Hz, A3 = 220Hz)
  const makeTeponaztli = (freq, key) =>
    cachedMono(ctx, key, (s) =>
      synthBronzeBell(
        s,
        freq,
        0.28,
        [
          { r: 1.0, amp: 0.95, dec: 0.24 },
          { r: 2.68, amp: 0.32, dec: 0.08 }, // Carved hardwood tongue overtone!
        ],
        { clickAmt: 0.22, clickFreq: 950, seed: 1480 + Math.round(freq) }
      )
    );

  const tepLow = makeTeponaztli(midiToFreq(50), 'tep_d3');
  const tepMid = makeTeponaztli(midiToFreq(53), 'tep_f3');
  const tepHigh = makeTeponaztli(midiToFreq(57), 'tep_a3');
  const shaker = cachedMono(ctx, 'maya_shaker', (s) => synthFilteredNoise(s, 0.048, 4900, 4200, 2.2, 1490, 0.002));

  const logPattern = [
    { b: 0.00, buf: tepLow, g: 0.62 },
    { b: 0.75, buf: tepMid, g: 0.44 },
    { b: 1.00, buf: tepHigh, g: 0.48 },
    { b: 1.50, buf: tepMid, g: 0.46 },
    { b: 2.00, buf: tepLow, g: 0.58 },
    { b: 2.50, buf: tepHigh, g: 0.50 },
    { b: 3.00, buf: tepMid, g: 0.48 },
    { b: 3.50, buf: tepHigh, g: 0.52 },
  ];

  for (let bar = 0; bar < 3; bar++) {
    const bt = bar * 4 * BEAT_SEC;
    for (const h of logPattern) {
      mix.mixMono(h.buf, bt + h.b * BEAT_SEC, h.g, 0.26);
    }
    for (let s = 0; s < 4.0; s += 0.5) {
      mix.mixMono(shaker, bt + s * BEAT_SEC, s % 1 === 0 ? 0.16 : 0.10, 0.36);
    }
  }

  // 3. Crisp Jade / Obsidian Stone Tally Clicks on EVERY 2-Beat Crank Turn (beats 0, 2, 4, 6, 8, 10)!
  const jadeA = cachedMono(ctx, 'maya_jade_a', (s) =>
    synthBronzeBell(s, 2180, 0.065, [{ r: 1.0, amp: 0.85, dec: 0.055 }], { clickAmt: 0.25, clickFreq: 3400, seed: 1495 })
  );
  const jadeB = cachedMono(ctx, 'maya_jade_b', (s) =>
    synthBronzeBell(s, 3690, 0.060, [{ r: 1.0, amp: 0.75, dec: 0.050 }], { clickAmt: 0.20, clickFreq: 4200, seed: 1496 })
  );
  for (let b = 0; b < 12; b += 2) {
    mix.mixMono(jadeA, b * BEAT_SEC, 0.28, -0.38);
    mix.mixMono(jadeB, b * BEAT_SEC + 0.013, 0.24, -0.36);
  }

  return mix.toAudioBuffer(ctx, 0.34);
}

// ============================================================================
// #08 MUGHAL (47.0s .. 53.0s) — Royal Court Sitar (`西塔琴` Jawari + Taraf Drone + Meend) & Tabla (`塔布拉鼓`)!
// ============================================================================
function renderEra08Mughal(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('indian_yaman', HOME_ROOT_MIDI);

  const pluckSitar = (midi, t, dur, gain, pan = -0.05, meendSemi = 0) => {
    const buf = cachedKS(ctx, `mughal_sitar_${meendSemi.toFixed(1)}`, midiToFreq(midi - meendSemi), Math.max(0.85, dur + 0.4), {
      damping: 0.16,
      decay: 0.996,
      pickPosition: 0.14,
      pluckHardness: 0.78,
      jawariBuzz: 0.74, // Rich curved bone-bridge Jawari buzz!
      glideSemitones: meendSemi,
      glideStartSec: 0.03,
      glideDurSec: Math.min(0.24, dur * 0.6),
      vibratoHz: 5.6,
      vibratoSemitones: 0.18,
      bodyModes: [{ freq: 260, q: 3.2, gain: 0.26 }, { freq: 690, q: 3.8, gain: 0.24 }],
      seed: 1500 + Math.round(midi * 2),
    });
    mix.mixMono(buf, t, gain, pan, dur + 0.32);
  };

  // 1. Shimmering Tanpura + Sympathetic *Taraf* Drone (`A2 - D3 - A3 - D4 - F#4 - G#4 - C#5 - D5`)
  const tarafCycle = [45, 50, 57, 62, 66, 68, 73, 74];
  for (let s = 0; s < SCENE_SEC - 0.25; s += 0.36) {
    const idx = Math.round(s / 0.36) % tarafCycle.length;
    pluckSitar(tarafCycle[idx], s, 0.90, 0.20, idx % 2 === 0 ? 0.36 : -0.36, 0);
  }

  // 2. Royal Sitar playing MAIN_MELODY_MOTIF in Raga Yaman (`#4` G#4 + Meend bends!)
  MAIN_MELODY_MOTIF.forEach((n) => {
    const nt = n.beat * BEAT_SEC;
    const dur = n.dur * BEAT_SEC;
    const midi = scale(n.deg, n.oct);
    const meend = n.ornament === 'bend' ? 2.0 : n.accent ? 1.0 : 0.0;
    pluckSitar(midi, nt, dur, 0.64 * (n.vel ?? 0.9), -0.06, meend);
    if (n.accent && n.beat + 0.5 < 12.0) {
      pluckSitar(74, nt + 0.25, 0.22, 0.24, -0.20, 0); // Chikari high drone spark!
    }
  });

  // 3. Authentic Tabla Groove (`Bayan Ghe` pitch swoop + D4-tuned `Dayan Na/Tin` + Bar-2 `Ti-Ra-Ki-Ta`!)
  const bayan = cachedMono(ctx, 'tabla_bayan', (s) => synthMembraneDrum(s, 'tabla_bayan', 1581));
  const dayanNa = cachedMono(ctx, 'tabla_na', (s) => synthMembraneDrum(s, 'tabla_dayan_na', 1582));
  const dayanTin = cachedMono(ctx, 'tabla_tin', (s) => synthMembraneDrum(s, 'tabla_dayan_tin', 1583));
  const dayanTi = cachedMono(ctx, 'tabla_ti', (s) => synthFilteredNoise(s, 0.032, 1520, 1280, 4.5, 1584, 0.001));

  for (let bar = 0; bar < 3; bar++) {
    const bt = bar * 4 * BEAT_SEC;
    // Dha (Bayan + Dayan)
    mix.mixMono(bayan, bt + 0.0 * BEAT_SEC, 0.58, -0.28);
    mix.mixMono(dayanNa, bt + 0.0 * BEAT_SEC, 0.44, 0.30);

    mix.mixMono(dayanTi, bt + 0.5 * BEAT_SEC, 0.26, 0.26);
    mix.mixMono(dayanTin, bt + 1.0 * BEAT_SEC, 0.40, 0.30);
    mix.mixMono(bayan, bt + 1.5 * BEAT_SEC, 0.44, -0.28);

    mix.mixMono(bayan, bt + 2.0 * BEAT_SEC, 0.54, -0.28);
    mix.mixMono(dayanNa, bt + 2.0 * BEAT_SEC, 0.42, 0.30);
    mix.mixMono(dayanNa, bt + 2.5 * BEAT_SEC, 0.36, 0.30);

    if (bar === 1) {
      [3.0, 3.25, 3.5, 3.75].forEach((sb, k) => {
        if (k === 3) {
          mix.mixMono(bayan, bt + sb * BEAT_SEC, 0.52, -0.28);
          mix.mixMono(dayanNa, bt + sb * BEAT_SEC, 0.42, 0.30);
        } else {
          mix.mixMono(dayanTi, bt + sb * BEAT_SEC, 0.34, 0.28);
        }
      });
    } else {
      mix.mixMono(dayanTin, bt + 3.0 * BEAT_SEC, 0.38, 0.30);
      mix.mixMono(dayanNa, bt + 3.5 * BEAT_SEC, 0.40, 0.30);
    }
  }

  return mix.toAudioBuffer(ctx, 0.34);
}

// ============================================================================
// #09 BADA (53.0s .. 59.0s) — Stark Ming-Loyalist Xiao (`洞箫` + >80% Zen Silence) & 55.8..56.3s Bamboo Tok + Petal Plink!
// ============================================================================
function synthXiaoNote(sr, freq, durSec, slideFromFreq = 0, seed = 1601) {
  const n = Math.max(64, Math.round((durSec + 0.11) * sr));
  const out = new Float32Array(n);
  const breathRaw = new Float32Array(n);
  const rng = createSeededRng(seed);

  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let f = freq;
    if (slideFromFreq > 0 && t < 0.11) {
      const u = t / 0.11;
      const su = u * u * (3 - 2 * u);
      f = slideFromFreq + (freq - slideFromFreq) * su;
    }
    const vibEnv = Math.min(1, Math.max(0, (t - 0.16) / 0.28));
    const vib = 1 + 0.011 * vibEnv * Math.sin(TWO_PI * 4.6 * t);
    ph = (ph + (f * vib) / sr) % 1.0;

    // Deep vertical bamboo bore (`洞箫`): warm fundamental + strong 3rd odd partial
    const core = Math.sin(TWO_PI * ph) * 0.80 + Math.sin(TWO_PI * ph * 2) * 0.18 + Math.sin(TWO_PI * ph * 3) * 0.26;
    const env = Math.min(1, t / 0.065) * (t > durSec ? Math.max(0, 1 - (t - durSec) / 0.11) : 1.0);
    out[i] = core * env;
    breathRaw[i] = (rng() * 2 - 1) * (t < 0.055 ? 0.34 : 0.13) * env;
  }

  const edgeBreath = biquadBandpassInPlace(breathRaw, sr, freq * 2.0, 3.8);
  for (let i = 0; i < n; i++) {
    out[i] = out[i] * 0.82 + edgeBreath[i] * 0.45;
  }
  return out;
}

function renderEra09Bada(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('pentatonic_yu', HOME_ROOT_MIDI);

  // Sparse calligraphic `洞箫` phrases (`计白当黑`: complete Zen silence across localT 2.45..3.55s = 55.45..56.55s!)
  const zenPhrases = [
    { beat: 0.00, dur: 0.85, deg: 0, oct: 0, gain: 0.68, slideFrom: -1 },
    { beat: 1.00, dur: 0.65, deg: 2, oct: 0, gain: 0.60 },
    { beat: 2.00, dur: 1.35, deg: 5, oct: 0, gain: 0.72, slideFrom: 4 },
    { beat: 4.00, dur: 0.68, deg: 7, oct: 0, gain: 0.70, slideFrom: 5 }, // Ends cleanly by localT = 2.45s (55.45s)!
    // [localT 2.45s..3.55s: SACRED WHITE-SPACE SILENCE punctuated by 2.82s Bamboo Tok & 3.16s Petal Plink!]
    { beat: 7.25, dur: 0.70, deg: 4, oct: 0, gain: 0.60 },
    { beat: 8.00, dur: 0.90, deg: 2, oct: 0, gain: 0.62 },
    { beat: 10.00, dur: 1.30, deg: 0, oct: 0, gain: 0.70, slideFrom: 1 },
    { beat: 11.50, dur: 0.42, deg: -1, oct: 0, gain: 0.55 },
  ];

  zenPhrases.forEach((p, idx) => {
    const f = midiToFreq(scale(p.deg, p.oct));
    const sf = p.slideFrom !== undefined ? midiToFreq(scale(p.slideFrom, p.oct)) : 0;
    const xiao = cachedMono(ctx, `xiao_${f.toFixed(1)}_${sf.toFixed(1)}_${p.dur.toFixed(2)}`, (s) =>
      synthXiaoNote(s, f, p.dur * BEAT_SEC, sf, 1610 + idx)
    );
    mix.mixMono(xiao, p.beat * BEAT_SEC, p.gain, -0.04);
  });

  // 1) 55.82s (`localT = 2.82s`): Deadpan dry hollow bamboo *tok!* on mutual `白眼` glare!
  const bambooTok = cachedMono(ctx, 'bada_tok', (s) =>
    synthBronzeBell(
      s,
      790,
      0.095,
      [
        { r: 1.0, amp: 0.92, dec: 0.068 },
        { r: 1.60, amp: 0.58, dec: 0.048 },
      ],
      { clickAmt: 0.32, clickFreq: 1680, seed: 1680 }
    )
  );
  mix.mixMono(bambooTok, 2.82, 0.78, 0.28);

  // 2) 56.16s (`localT = 3.16s`): Delicate upward-chirping water-drop / falling withered lotus petal *plink*!
  const petalPlink = cachedMono(ctx, 'bada_plink', (s) => {
    const n = Math.round(0.36 * s);
    const out = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / s;
      const f = t < 0.068 ? 520 * Math.pow(1180 / 520, t / 0.068) : 1180 * Math.exp(-(t - 0.068) * 0.25);
      ph += f / s;
      out[i] = Math.sin(TWO_PI * ph) * Math.min(1, t / 0.003) * Math.exp(-t * 11.5);
    }
    return out;
  });
  mix.mixMono(petalPlink, 3.16, 0.72, 0.22);

  return mix.toAudioBuffer(ctx, 0.24);
}

// ============================================================================
// #10 WAYANG (59.0s .. 65.0s) — Javanese Slendro Gamelan (Paired Ombak Bronze + Gong Ageng) & 10Hz Keprak Clacks!
// ============================================================================
function makeGamelanVoice(ctx, freq, isBonang = false) {
  return cachedMono(ctx, `gam_${isBonang ? 'bon' : 'sar'}_${freq.toFixed(1)}`, (sr) =>
    synthBronzeBell(
      sr,
      freq,
      isBonang ? 0.85 : 1.25,
      isBonang
        ? [
            { r: 1.0, amp: 1.0, dec: 0.78 },
            { r: 1.52, amp: 0.35, dec: 0.38 },
            { r: 2.84, amp: 0.28, dec: 0.24 },
          ]
        : [
            { r: 1.0, amp: 1.0, dec: 1.12 },
            { r: 2.71, amp: 0.38, dec: 0.46 },
            { r: 5.14, amp: 0.16, dec: 0.20 },
          ],
      { ombakHz: isBonang ? 5.2 : 4.6, clickAmt: 0.14, clickFreq: 1950, seed: 1700 + Math.round(freq) }
    )
  );
}

function makeGongAgengVoice(ctx) {
  return cachedMono(ctx, 'wayang_gong_ageng', (sr) =>
    synthBronzeBell(
      sr,
      midiToFreq(38), // Deep D2 = 73.42 Hz with 1.7 Hz sacred ombak beating!
      2.7,
      [
        { r: 1.0, amp: 1.0, dec: 2.5 },
        { r: 2.0, amp: 0.36, dec: 1.8 },
        { r: 2.48, amp: 0.18, dec: 1.2 },
      ],
      { ombakHz: 1.7, clickAmt: 0.12, clickFreq: 420, seed: 1750 }
    )
  );
}

function renderEra10Wayang(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('javanese_slendro', HOME_ROOT_MIDI);

  // 1. Deep Sacred *Gong Ageng* on Scene Entry & Bar-3 Colotomic Cycle
  const gongAgeng = makeGongAgengVoice(ctx);
  mix.mixMono(gongAgeng, 0.0, 0.56, 0.0, SCENE_SEC);
  mix.mixMono(gongAgeng, 4.0, 0.50, 0.0, 2.02);

  // *Kenong* mid-kettle punctuation on beats 2, 6, 10
  const kenong = makeGamelanVoice(ctx, midiToFreq(scale(4, -1)), true);
  [2.0, 6.0, 10.0].forEach((b) => mix.mixMono(kenong, b * BEAT_SEC, 0.34, -0.28, 0.95));

  // 2. *Saron Barung* Core Slendro Melody + Interlocking Double-Speed *Bonang* Kotekan!
  const kendhang = cachedMono(ctx, 'dj_tone', (s) => synthMembraneDrum(s, 'djembe_tone', 602));
  MAIN_MELODY_MOTIF.forEach((n) => {
    const nt = n.beat * BEAT_SEC;
    const saronF = midiToFreq(scale(n.deg, n.oct));
    mix.mixMono(makeGamelanVoice(ctx, saronF, false), nt, 0.52 * (n.vel ?? 0.9), -0.08, SCENE_SEC - nt);

    const subStep = 0.25 * BEAT_SEC;
    const steps = Math.max(1, Math.round((n.dur * BEAT_SEC) / subStep));
    for (let k = 0; k < steps; k++) {
      const bt = nt + k * subStep;
      if (bt >= SCENE_SEC - 0.06) break;
      const altDeg = k % 2 === 0 ? n.deg : n.deg + 2;
      const bonangF = midiToFreq(scale(altDeg, n.oct + 1));
      mix.mixMono(makeGamelanVoice(ctx, bonangF, true), bt, 0.24, k % 2 === 0 ? 0.28 : -0.26, 0.36);
    }

    if (n.accent) {
      mix.mixMono(kendhang, nt, 0.28, -0.22);
    }
  });

  // 3. 10Hz Quantized Wooden *Keprak* / Horn-Rod Puppet Clacks (`localT 1.6..4.7s` = `60.6..63.7s`)
  const keprakHi = cachedMono(ctx, 'wayang_keprak_hi', (s) => synthFilteredNoise(s, 0.036, 2850, 1820, 4.8, 1791, 0.001));
  const keprakLo = cachedMono(ctx, 'wayang_keprak_lo', (s) => synthFilteredNoise(s, 0.034, 2050, 1380, 4.5, 1792, 0.001));
  for (let step = 16; step <= 47; step++) {
    const localT = step * 0.1;
    if (step % 2 === 0 || (step >= 24 && step <= 32)) {
      const peakSalute = step >= 25 && step <= 31;
      mix.mixMono(peakSalute && step % 2 === 0 ? keprakHi : keprakLo, localT, peakSalute ? 0.32 : 0.20, 0.36);
    }
  }

  return mix.toAudioBuffer(ctx, 0.34);
}

// ============================================================================
// #11 UKIYO-E (65.0s .. 71.0s) — Edo In-sen Shamisen (`三味线`) + Hyōshigi + Rain + 67.5..68.4s Hat Wind-Gust Whistle!
// ============================================================================
function renderEra11Ukiyoe(ctx) {
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, SCENE_SEC);
  const scale = getEraScaleMapper('edo_insen', HOME_ROOT_MIDI);

  // 1. Hiroshige *Shōno* Slanted Woodblock Rain Texture
  {
    const rng = createSeededRng(1801);
    const n = Math.round(SCENE_SEC * sr);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const gustBoost = 1 + 0.65 * Math.exp(-Math.pow((t - 2.65) / 0.65, 2));
      raw[i] = (rng() * 2 - 1) * 0.045 * gustBoost;
    }
    const rain = biquadBandpassInPlace(raw, sr, 4300, 1.2);
    mix.mixMono(rain, 0.0, 0.45, -0.15);
  }

  // 2. Driving Edo *In-sen* `三味线` (`Shamisen`: sharp *bachi* skin strike + *sawari* neck buzz!)
  const pluckShamisen = (midi, t, dur, gain, pan = 0.05, sawari = 0.28) => {
    const buf = cachedKS(ctx, `edo_sham_${sawari.toFixed(2)}`, midiToFreq(midi), Math.max(0.55, dur + 0.2), {
      damping: 0.17,
      decay: 0.992,
      pickPosition: 0.12,
      pluckHardness: 0.88,
      skinSnap: 0.42,
      jawariBuzz: sawari,
      bodyModes: [{ freq: 395, q: 4.2, gain: 0.36 }, { freq: 940, q: 4.5, gain: 0.28 }],
      seed: 1900 + Math.round(midi),
    });
    mix.mixMono(buf, t, gain, pan, dur + 0.18);
  };

  for (const n of MAIN_MELODY_MOTIF) {
    const nt = n.beat * BEAT_SEC;
    const dur = n.dur * BEAT_SEC;
    pluckShamisen(scale(n.deg, n.oct), nt, dur, 0.66 * (n.vel ?? 0.9), 0.05, n.accent ? 0.38 : 0.22);
    if (n.accent) {
      pluckShamisen(50, nt + 0.01, 0.65, 0.46, -0.20, 0.56); // Open D3 *sawari* drone slap!
    }
  }

  [1.75, 3.75, 7.75, 9.75, 11.25].forEach((b) => {
    pluckShamisen(57, b * BEAT_SEC, 0.22, 0.34, -0.14, 0.42);
  });

  // 3. Hardwood *Hyōshigi* (`拍子木`) Theater Clappers
  const hyoshigi = cachedMono(ctx, 'edo_hyoshigi', (s) =>
    synthBronzeBell(
      s,
      2460,
      0.13,
      [
        { r: 1.0, amp: 0.88, dec: 0.11 },
        { r: 3390 / 2460, amp: 0.68, dec: 0.095 },
      ],
      { clickAmt: 0.35, clickFreq: 3200, seed: 1940 }
    )
  );
  [0.0, 0.25, 4.0, 8.0, 10.0, 11.5].forEach((b, idx) => {
    mix.mixMono(hyoshigi, b * BEAT_SEC, idx < 2 ? 0.38 : 0.30, -0.36);
  });

  // 4. Playful Wind-Gust & Fluttering Bamboo *Shinobue* Whistle at `67.48..68.42s` (`localT 2.48..3.42s` — `菅笠` hat ripped skyward!)
  const gustWhoosh = cachedMono(ctx, 'edo_hat_gust', (s) => synthFilteredNoise(s, 0.92, 460, 2150, 3.0, 1975, 0.18));
  mix.mixMono(gustWhoosh, 2.48, 0.36, -0.28);
  mix.mixMono(gustWhoosh, 2.58, 0.38, 0.38);

  const hatWhistle = cachedMono(ctx, 'edo_hat_whistle', (s) => {
    const dur = 0.88;
    const n = Math.round(dur * s);
    const out = new Float32Array(n);
    const knots = [
      { t: 0.00, f: midiToFreq(79) }, // G5
      { t: 0.15, f: midiToFreq(81) }, // A5
      { t: 0.30, f: midiToFreq(84) }, // C6
      { t: 0.46, f: midiToFreq(86) }, // D6
      { t: 0.62, f: midiToFreq(87) }, // Eb6
      { t: 0.86, f: midiToFreq(91) }, // G6 tumbling across Mt. Fuji!
    ];
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / s;
      let k = 0;
      while (k < knots.length - 2 && t > knots[k + 1].t) k++;
      const u = Math.max(0, Math.min(1, (t - knots[k].t) / (knots[k + 1].t - knots[k].t)));
      const f = knots[k].f * Math.pow(knots[k + 1].f / knots[k].f, u);
      ph += f / s;
      // 22Hz playful bamboo flutter-tongue modulation!
      const flutter = 0.72 + 0.28 * Math.sin(TWO_PI * 22.0 * t);
      const env = Math.min(1, t / 0.06) * Math.sin(Math.PI * Math.min(1, t / dur));
      out[i] = (Math.sin(TWO_PI * ph) * 0.85 + Math.sin(TWO_PI * ph * 2) * 0.18) * flutter * env;
    }
    return out;
  });
  mix.mixMono(hatWhistle, 2.52, 0.42, 0.28);

  return mix.toAudioBuffer(ctx, 0.36);
}

// ============================================================================
// PUBLIC EXPORTS (Locked 1:1 to `[STAGE 4 AUDIO API CONTRACT]`)
// ============================================================================

/**
 * Schedules Intro (`0.0..5.0s`) + Ancient/World Eras `#01..#11` (`5.0..71.0s`) onto `musicBus`.
 */
export function scheduleIntroAndWorldEras(ctx, musicBus, sharedAssets = {}) {
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 0.0, renderIntroBuffer(ctx), 0.26);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 5.0, renderEra01Sahara(ctx), 0.18);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 11.0, renderEra02Egypt(ctx), 0.34);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 17.0, renderEra03Han(ctx), 0.36);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 23.0, renderEra04Tang(ctx), 0.28);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 29.0, renderEra05Song(ctx), 0.42);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 35.0, renderEra06Qingming(ctx), 0.22);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 41.0, renderEra07Maya(ctx), 0.24);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 47.0, renderEra08Mughal(ctx), 0.28);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 53.0, renderEra09Bada(ctx), 0.44);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 59.0, renderEra10Wayang(ctx), 0.34);
  scheduleRenderedEraBuffer(ctx, musicBus, sharedAssets, 65.0, renderEra11Ukiyoe(ctx), 0.20);
}

/**
 * Schedules a balanced World Tutti Ensemble layer (`编钟 + 琵琶 + 笛子 + 甘美兰 + 西塔琴`)
 * playing `MAIN_MELODY_MOTIF` (looping every 6.0s across `[t0, t0 + duration]`) into `dest`
 * at steady ensemble level (`~0.25` peak) for the Outro Grand Tutti (`125.0s+`).
 */
export function scheduleWorldTuttiLayer(ctx, dest, t0, duration, sharedAssets = {}) {
  if (duration <= 0.05) return;
  const sr = ctx.sampleRate;
  const mix = new EraStereoMixer(sr, duration, 0.025);
  const scale = getEraScaleMapper('major', HOME_ROOT_MIDI);
  const cycles = Math.ceil(duration / SCENE_SEC);
  const gongAgeng = makeGongAgengVoice(ctx);

  for (let c = 0; c < cycles; c++) {
    const cycleOff = c * SCENE_SEC;
    if (cycleOff >= duration - 0.05) break;

    mix.mixMono(gongAgeng, cycleOff, 0.38, 0.0, duration - cycleOff);
    mix.mixMono(makeBianzhongVoice(ctx, midiToFreq(50), true), cycleOff, 0.34, -0.35, duration - cycleOff);

    MAIN_MELODY_MOTIF.forEach((n, idx) => {
      const nt = cycleOff + n.beat * BEAT_SEC;
      if (nt >= duration - 0.05) return;
      const maxDur = Math.max(0.08, Math.min(n.dur * BEAT_SEC, duration - nt));
      const midi = scale(n.deg, n.oct);
      const freq = midiToFreq(midi);
      const vel = n.vel ?? 0.9;

      // 1. Han Bianzhong (`编钟`, pan -0.38)
      if (n.accent || n.dur >= 0.5) {
        mix.mixMono(makeBianzhongVoice(ctx, freq, false), nt, 0.36 * vel, -0.38, maxDur + 0.35);
      }

      // 2. Tang Pipa (`琵琶`, pan +0.32)
      const pipa = cachedKS(ctx, 'tutti_pipa', freq, Math.max(0.55, maxDur + 0.2), {
        damping: 0.14,
        decay: 0.993,
        pickPosition: 0.11,
        pluckHardness: 0.86,
        skinSnap: 0.22,
        bodyModes: [{ freq: 590, q: 4.0, gain: 0.24 }],
        seed: 2100 + Math.round(midi),
      });
      mix.mixMono(pipa, nt, 0.44 * vel, 0.32, maxDur + 0.15);

      // 3. Song Bianjing Dizi (`笛子`, pan -0.18, +1 octave)
      const trillF = n.accent ? midiToFreq(scale(n.deg + 1, n.oct + 1)) : 0;
      const dizi = cachedMono(ctx, `tutti_dizi_${(freq * 2).toFixed(1)}_${maxDur.toFixed(2)}`, (s) =>
        synthDiziNote(s, freq * 2.0, maxDur * 0.92, trillF, 2150 + idx)
      );
      mix.mixMono(dizi, nt, 0.30 * vel, -0.18, maxDur);

      // 4. Javanese Gamelan (`甘美兰`, pan +0.44)
      mix.mixMono(makeGamelanVoice(ctx, freq * 2.0, true), nt, 0.30 * vel, 0.44, maxDur + 0.25);

      // 5. Mughal Sitar (`西塔琴`, pan +0.06)
      const sitar = cachedKS(ctx, 'tutti_sitar', freq, Math.max(0.7, maxDur + 0.3), {
        damping: 0.17,
        decay: 0.995,
        pickPosition: 0.14,
        pluckHardness: 0.76,
        jawariBuzz: 0.68,
        seed: 2200 + Math.round(midi),
      });
      mix.mixMono(sitar, nt, 0.40 * vel, 0.06, maxDur + 0.22);
    });
  }

  const tuttiBuf = mix.toAudioBuffer(ctx, 0.25);
  scheduleRenderedEraBuffer(ctx, dest, sharedAssets, t0, tuttiBuf, 0.18);
}
