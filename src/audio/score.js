// src/audio/score.js
// Stage 4 — Original 3-Bar Pelican Cycling Leitmotif, Authentic 14-Mode Historical Scale Mapper,
// and Deterministic Procedural DSP Synthesis Utilities (Seeded RNG, Noise, Reverb IRs,
// Fractional-Delay Waveguide Karplus-Strong Plucked Strings).

export const HOME_ROOT_MIDI = 62; // D4 = 293.6648 Hz

/**
 * Original 3-bar (12-beat @ 120 BPM = 6.0s) Pelican Cycling Leitmotif.
 *
 * Designed so every 2-beat full pedal revolution (beats 0, 2, 4, 6, 8, 10) lands on a
 * structural melodic pillar, while adjacent degree transitions avoid 5-tone collisions
 * so the exact same motif degree sequence inflects cleanly across all 14 historical modes:
 * - Bar 1 (beats 0..4): Jaunty dotted-eighth pedal downstroke & rising 6th hook (D - E - F# - A - B - A - F#)
 * - Bar 2 (beats 4..8): Soaring octave peak & expressive modal signature turn (D5 - B - G/#4 - A - B)
 * - Bar 3 (beats 8..12): Driving wheel-spin cadence & dominant-anacrusis pickup propelling into Beat 0!
 */
export const MAIN_MELODY_MOTIF = [
  // Bar 1: Entry & forward-pedaling rising sixth hook
  { beat: 0.00, dur: 0.75, deg: 0, oct: 0, vel: 0.95, accent: true, ornament: 'downbeat' },
  { beat: 0.75, dur: 0.25, deg: 1, oct: 0, vel: 0.78, accent: false },
  { beat: 1.00, dur: 0.50, deg: 2, oct: 0, vel: 0.85, accent: false },
  { beat: 1.50, dur: 0.50, deg: 4, oct: 0, vel: 0.88, accent: false },
  { beat: 2.00, dur: 1.00, deg: 5, oct: 0, vel: 0.96, accent: true, ornament: 'vibrato' },
  { beat: 3.00, dur: 0.50, deg: 4, oct: 0, vel: 0.82, accent: false },
  { beat: 3.50, dur: 0.50, deg: 2, oct: 0, vel: 0.80, accent: false },

  // Bar 2: Expressive scene-gag peak & characteristic modal inflection (deg 3 = #4 in Yaman, 4 in Hijaz/Tang)
  { beat: 4.00, dur: 1.00, deg: 7, oct: 0, vel: 1.00, accent: true, ornament: 'trill' },
  { beat: 5.00, dur: 0.50, deg: 5, oct: 0, vel: 0.88, accent: false },
  { beat: 5.50, dur: 0.50, deg: 3, oct: 0, vel: 0.86, accent: false, ornament: 'grace' },
  { beat: 6.00, dur: 1.50, deg: 4, oct: 0, vel: 0.94, accent: true, ornament: 'bend' },
  { beat: 7.50, dur: 0.50, deg: 5, oct: 0, vel: 0.84, accent: false },

  // Bar 3: Driving cadence & wheel-spin pickup into the next strong-beat picture frame
  { beat: 8.00, dur: 0.50, deg: 4, oct: 0, vel: 0.92, accent: true },
  { beat: 8.50, dur: 0.50, deg: 2, oct: 0, vel: 0.84, accent: false },
  { beat: 9.00, dur: 0.50, deg: 1, oct: 0, vel: 0.82, accent: false },
  { beat: 9.50, dur: 0.50, deg: 2, oct: 0, vel: 0.86, accent: false },
  { beat: 10.00, dur: 1.00, deg: 0, oct: 0, vel: 0.95, accent: true, ornament: 'turn' },
  { beat: 11.00, dur: 0.50, deg: -3, oct: 0, vel: 0.85, accent: false },
  { beat: 11.50, dur: 0.50, deg: -1, oct: 0, vel: 0.90, accent: false, ornament: 'pickup' },
];

/**
 * Companion 3-bar bass / counter-pedal root outline (in 7-degree modal space, oct -1 by default).
 * Useful for accompaniment figures across eras.
 */
export const BASS_PEDAL_MOTIF = [
  { beat: 0.0, dur: 2.0, deg: 0, oct: -1, vel: 0.90 },
  { beat: 2.0, dur: 2.0, deg: 5, oct: -2, vel: 0.82 },
  { beat: 4.0, dur: 2.0, deg: 3, oct: -1, vel: 0.88 },
  { beat: 6.0, dur: 2.0, deg: 4, oct: -1, vel: 0.92 },
  { beat: 8.0, dur: 2.0, deg: 2, oct: -1, vel: 0.84 },
  { beat: 10.0, dur: 1.0, deg: 0, oct: -1, vel: 0.92 },
  { beat: 11.0, dur: 1.0, deg: 4, oct: -2, vel: 0.88 },
];

/**
 * Converts a (possibly fractional/microtonal) MIDI note number to frequency in Hz.
 */
export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 7-slot modal degree tables (in semitones above rootMidi, supporting microtonal floats).
 * Indexing is in 7-degree diatonic space (deg 0 = tonic, deg 4 = 5th, deg 7 = octave).
 * Five-tone modes map slots 3 & 6 onto idiomatic pentatonic tones so 100% of pitches stay pure.
 */
const MODE_SEMITONE_TABLES = {
  // Western & Modal heptatonic scales
  major: [0, 2, 4, 5, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  natural_minor: [0, 2, 3, 5, 7, 8, 10],
  harmonic_minor: [0, 2, 3, 5, 7, 8, 11],

  // Chinese Gong (宫商角徵羽: D E F# A B) & Yu (羽宫商角徵: D F G A C)
  pentatonic_major: [0, 2, 4, 4, 7, 9, 9],
  pentatonic_yu: [0, 3, 5, 5, 7, 10, 10],

  // High-Tang Swallow Court Music (燕乐琵琶调: Mixolydian with bright 4th & subtonic 7th)
  tang_yanyue: [0, 2, 4, 5, 7, 9, 10],

  // Ancient Near-East / Nile Hijaz (Phrygian Dominant: 1 b2 3 4 5 b6 b7 -> augmented 2nd 1..4!)
  egypt_hijaz: [0, 1, 4, 5, 7, 8, 10],

  // Mughal Imperial Court Raga Yaman / Kalyan (1 2 3 #4 5 6 7 -> luminous Tivra Ma #4!)
  indian_yaman: [0, 2, 4, 6, 7, 9, 11],

  // Javanese Gamelan Slendro (authentic stretched near-equidistant 5-tone bronze tuning in semitones)
  javanese_slendro: [0, 2.42, 4.86, 4.86, 7.28, 9.68, 9.68],

  // Javanese Gamelan Pelog (authentic asymmetric 7-tone bronze tuning in semitones)
  javanese_pelog: [0, 1.25, 2.75, 5.45, 6.85, 7.95, 9.75],

  // Edo Japanese In-sen (陰旋法: 1 b2 4 5 b7 -> D Eb G A C)
  edo_insen: [0, 1, 5, 5, 7, 10, 10],
};

/**
 * Returns a mapper `(deg, octOffset = 0) => midiFloat` for the requested historical mode.
 */
export function getEraScaleMapper(modeName = 'major', rootMidi = HOME_ROOT_MIDI) {
  const table = MODE_SEMITONE_TABLES[modeName] || MODE_SEMITONE_TABLES.major;
  return function mapDegreeToMidi(deg, octOffset = 0) {
    const intDeg = Math.round(deg);
    const octFromDeg = Math.floor(intDeg / 7);
    const idx = ((intDeg % 7) + 7) % 7;
    return rootMidi + (octFromDeg + octOffset) * 12 + table[idx];
  };
}

/**
 * Mulberry32 deterministic PRNG returning floats in [0, 1).
 * Guarantees bit-identical offline & live renders across runs.
 */
export function createSeededRng(seed = 20261111) {
  let s = (seed >>> 0) || 1;
  return function nextRandom() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesizes a deterministic mono noise AudioBuffer ('white' | 'pink' | 'brown').
 */
export function makeNoiseBuffer(ctx, durationSec = 4.0, type = 'white', seed = 101) {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.round(durationSec * sr));
  const buffer = ctx.createBuffer(1, length, sr);
  const out = buffer.getChannelData(0);
  const rng = createSeededRng(seed);

  if (type === 'pink') {
    // Paul Kellet's refined 7-state pink noise filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let maxAbs = 1e-6;
    for (let i = 0; i < length; i++) {
      const w = rng() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.96900 * b2 + w * 0.1538520;
      b3 = 0.86650 * b3 + w * 0.3104856;
      b4 = 0.55000 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.0168980;
      const sample = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
      out[i] = sample;
      const a = Math.abs(sample);
      if (a > maxAbs) maxAbs = a;
    }
    const norm = 0.92 / maxAbs;
    for (let i = 0; i < length; i++) out[i] *= norm;
  } else if (type === 'brown') {
    let acc = 0;
    let maxAbs = 1e-6;
    for (let i = 0; i < length; i++) {
      const w = rng() * 2 - 1;
      acc = (acc + 0.025 * w) * 0.996;
      out[i] = acc;
      const a = Math.abs(acc);
      if (a > maxAbs) maxAbs = a;
    }
    const norm = 0.92 / maxAbs;
    for (let i = 0; i < length; i++) out[i] *= norm;
  } else {
    for (let i = 0; i < length; i++) {
      out[i] = (rng() * 2 - 1) * 0.95;
    }
  }

  return buffer;
}

/**
 * Synthesizes a smooth, realistic stereo acoustic space Impulse Response AudioBuffer
 * with early reflections + exponentially damped high-frequency air absorption.
 */
export function makeImpulseResponse(ctx, durationSec = 2.2, decay = 2.8, seed = 202) {
  const sr = ctx.sampleRate;
  const length = Math.max(1, Math.round(durationSec * sr));
  const buffer = ctx.createBuffer(2, length, sr);
  const rngL = createSeededRng(seed);
  const rngR = createSeededRng(seed + 7919);

  // Sparse early reflection taps (in ms) for natural wooden gallery / temple dimension
  const earlyTapsMs = [11.3, 17.9, 24.7, 33.4, 43.8, 56.2, 71.5];

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const rng = ch === 0 ? rngL : rngR;
    let lp = 0;

    for (let i = 0; i < length; i++) {
      const u = i / length;
      const tSec = i / sr;
      // Progressive HF air damping: darker tail than early reflections
      const hfAlpha = 0.72 - 0.54 * Math.min(1, u * 1.35);
      const white = rng() * 2 - 1;
      lp = lp + hfAlpha * (white - lp);

      // Dual-slope envelope: brisk early bloom + smooth late tail
      const env =
        0.35 * Math.exp(-tSec * decay * 2.4) +
        0.65 * Math.pow(1 - u, decay) * Math.exp(-tSec * 0.9);
      const preRamp = Math.min(1, i / (0.004 * sr));
      data[i] = lp * env * preRamp * 0.48;
    }

    for (let k = 0; k < earlyTapsMs.length; k++) {
      const jitterMs = ch === 0 ? k * 0.9 : -k * 0.7 + 1.6;
      const idx = Math.round(((earlyTapsMs[k] + jitterMs) * 0.001) * sr);
      if (idx > 0 && idx < length) {
        const sign = (k + ch) % 2 === 0 ? 1 : -1;
        data[idx] += sign * (0.28 * Math.pow(0.82, k));
      }
    }
  }

  return buffer;
}

/**
 * Applies a 2nd-order peaking/resonator biquad in-place or additively to simulate
 * acoustic instrument soundboard / gourd / skin body formants.
 */
function addBodyResonance(src, sr, freqHz, q = 3.5, gain = 0.25) {
  if (freqHz <= 20 || freqHz >= sr * 0.45 || Math.abs(gain) < 1e-4) return src;
  const out = new Float32Array(src.length);
  const w0 = (2 * Math.PI * freqHz) / sr;
  const sinW = Math.sin(w0);
  const cosW = Math.cos(w0);
  const alpha = sinW / (2 * q);

  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * cosW;
  const a2 = 1 - alpha;

  const nb0 = b0 / a0;
  const nb1 = b1 / a0;
  const nb2 = b2 / a0;
  const na1 = a1 / a0;
  const na2 = a2 / a0;

  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x0 = src[i];
    const y0 = nb0 * x0 + nb1 * x1 + nb2 * x2 - na1 * y1 - na2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    out[i] = x0 + y0 * gain;
  }
  return out;
}

/**
 * Synthesizes an organic plucked-string AudioBuffer via an extended fractional-delay
 * waveguide Karplus-Strong physical model in pure JS (100% deterministic in OfflineAudioContext).
 *
 * Options:
 * - `damping` (0..1): high-frequency loop absorption (0.12 = bright bone/plectrum, 0.55 = warm gut/silk)
 * - `decay` (0.970..0.9995): per-period energy retention
 * - `pickPosition` (0.06..0.45): comb-filter pluck position along string length
 * - `pluckHardness` (0..1): crisp impulse snap vs soft finger flesh
 * - `jawariBuzz` (0..1): curved-bridge nonlinear grazing buzz (for Sitar Jawari / Shamisen Sawari!)
 * - `skinSnap` (0..1): initial percussive plectrum-on-skin strike (for Shamisen bachi / Pipa!)
 * - `glideSemitones` (number): pitch-bend interval (e.g. Guqin Yin-Nao or Sitar Meend)
 * - `glideStartSec`, `glideDurSec`, `vibratoHz`, `vibratoSemitones`
 * - `bodyModes`: array of `{ freq, q, gain }` soundboard formant resonators
 * - `harmonicMode` (boolean): pure bell-like flageolet `泛音` touch harmonic!
 * - `seed` (number): deterministic RNG seed
 */
export function pluckKarplusStrongBuffer(ctx, freq, durationSec = 1.5, options = {}) {
  const sr = ctx.sampleRate;
  const safeFreq = Math.max(32, Math.min(sr * 0.42, freq));
  const length = Math.max(64, Math.round(durationSec * sr));
  const buffer = ctx.createBuffer(1, length, sr);
  const out = buffer.getChannelData(0);

  const {
    damping = 0.28,
    decay = 0.994,
    pickPosition = 0.18,
    pluckHardness = 0.5,
    jawariBuzz = 0.0,
    skinSnap = 0.0,
    glideSemitones = 0.0,
    glideStartSec = 0.04,
    glideDurSec = 0.35,
    vibratoHz = 0.0,
    vibratoSemitones = 0.0,
    vibratoDelaySec = 0.14,
    bodyModes = null,
    harmonicMode = false,
    seed = 1337,
  } = options;

  const rng = createSeededRng(seed + Math.round(safeFreq * 13.7));

  // Allocate ring delay line comfortably holding the lowest possible bent pitch
  const minFreq = safeFreq * Math.pow(2, Math.min(0, glideSemitones - Math.abs(vibratoSemitones) - 2) / 12);
  const maxDelay = Math.ceil(sr / Math.max(25, minFreq)) + 8;
  const ring = new Float32Array(maxDelay);

  const baseDelay = sr / safeFreq;
  const initPeriod = Math.max(4, Math.min(maxDelay - 4, Math.round(baseDelay)));

  // 1. Construct initial string displacement profile (filtered noise + pick-comb + plectrum impulse)
  const rawExcite = new Float32Array(initPeriod);
  let lpInit = 0;
  const initSmooth = harmonicMode ? 0.16 : 0.32 + 0.62 * pluckHardness;
  for (let i = 0; i < initPeriod; i++) {
    const n = rng() * 2 - 1;
    lpInit += initSmooth * (n - lpInit);
    // Smooth half-sine string arch mixed with broadband plectrum edge
    const arch = Math.sin((Math.PI * i) / initPeriod);
    rawExcite[i] = lpInit * (0.68 + 0.32 * pluckHardness) + arch * (0.28 * (1 - pluckHardness * 0.5));
  }

  // Pick-position comb reflection (eliminates harmonics with nodes at pick point)
  const pickOffset = Math.max(1, Math.min(initPeriod - 2, Math.round(initPeriod * pickPosition)));
  let mean = 0;
  for (let i = 0; i < initPeriod; i++) {
    const prev = rawExcite[(i - pickOffset + initPeriod) % initPeriod];
    let v = rawExcite[i] - prev * (harmonicMode ? 0.45 : 0.82);
    if (harmonicMode) {
      // Suppress odd-order low mud to give crystalline flageolet bell purity (`泛音`)
      const half = rawExcite[(i + Math.floor(initPeriod / 2)) % initPeriod];
      v = (v + half) * 0.55 + Math.sin((2 * Math.PI * i) / initPeriod) * 0.38;
    }
    ring[i] = v;
    mean += v;
  }
  mean /= initPeriod;
  for (let i = 0; i < initPeriod; i++) ring[i] -= mean;

  // 2. Time-stepping waveguide loop with linear/hermite fractional read + one-pole loop damping + Jawari bridge
  let writeIdx = initPeriod % maxDelay;
  let lpLoop = 0;
  let dcX1 = 0;
  let dcY1 = 0;

  const effDamp = harmonicMode ? Math.min(0.14, damping * 0.45) : damping;
  const effDecay = harmonicMode ? Math.min(0.9985, decay + 0.003) : decay;

  for (let i = 0; i < length; i++) {
    const tSec = i / sr;

    // Optional pitch glide (Meend / Yin-Nao) + delayed subtle vibrato
    let pitchSemi = 0;
    if (glideSemitones !== 0 && tSec > glideStartSec) {
      const u = Math.min(1, (tSec - glideStartSec) / Math.max(0.02, glideDurSec));
      const smoothU = u * u * (3 - 2 * u);
      pitchSemi += glideSemitones * smoothU;
    }
    if (vibratoHz > 0 && vibratoSemitones > 0 && tSec > vibratoDelaySec) {
      const vEnv = Math.min(1, (tSec - vibratoDelaySec) / 0.18);
      pitchSemi += vibratoSemitones * vEnv * Math.sin(2 * Math.PI * vibratoHz * (tSec - vibratoDelaySec));
    }

    const curFreq = pitchSemi === 0 ? safeFreq : safeFreq * Math.pow(2, pitchSemi / 12);
    const delayF = Math.max(3, Math.min(maxDelay - 3, sr / curFreq));
    const dInt = Math.floor(delayF);
    const frac = delayF - dInt;

    const r0 = (writeIdx - dInt + maxDelay) % maxDelay;
    const r1 = (r0 - 1 + maxDelay) % maxDelay;
    const delayed = ring[r0] * (1 - frac) + ring[r1] * frac;

    // Loop lowpass damping filter
    lpLoop = delayed * (1 - effDamp) + lpLoop * effDamp;
    let nextVal = lpLoop * effDecay;

    // Curved-bridge Jawari / Sawari grazing buzz: asymmetric soft rectification folds energy into upper partials!
    if (jawariBuzz > 0) {
      const rectified = nextVal > 0 ? nextVal : nextVal * (1 - 0.55 * jawariBuzz);
      const buzzEdge = Math.tanh(rectified * (1.8 + 3.2 * jawariBuzz)) / (1.8 + 2.1 * jawariBuzz);
      nextVal = nextVal * (1 - 0.22 * jawariBuzz) + buzzEdge * (0.22 * jawariBuzz);
    }

    // Subtle DC blocker inside loop so asymmetric Jawari never drifts
    const dcOut = nextVal - dcX1 + 0.9975 * dcY1;
    dcX1 = nextVal;
    dcY1 = dcOut;

    ring[writeIdx] = dcOut;
    writeIdx = (writeIdx + 1) % maxDelay;
    out[i] = dcOut;
  }

  // 3. Optional percussive plectrum / skin-strike transient (Bachi snap / Pipa bone pick)
  if (skinSnap > 0) {
    const snapSamples = Math.min(length, Math.round(0.014 * sr));
    let bp1 = 0, bp2 = 0;
    for (let i = 0; i < snapSamples; i++) {
      const env = Math.exp(-i / (0.0028 * sr));
      const n = (rng() * 2 - 1) * env;
      bp1 += 0.42 * (n - bp1);
      bp2 += 0.12 * (bp1 - bp2);
      out[i] += (bp1 - bp2) * skinSnap * 1.35;
    }
  }

  // 4. Optional acoustic body formant resonances
  let processed = out;
  if (Array.isArray(bodyModes)) {
    for (const m of bodyModes) {
      processed = addBodyResonance(processed, sr, m.freq, m.q ?? 3.5, m.gain ?? 0.25);
    }
  }

  // 5. Peak normalize gently & apply click-free 2ms attack / 22ms release micro-taper
  let peak = 1e-6;
  for (let i = 0; i < length; i++) {
    const a = Math.abs(processed[i]);
    if (a > peak) peak = a;
  }
  const norm = 0.88 / peak;
  const attackLen = Math.min(length, Math.max(4, Math.round(0.0012 * sr)));
  const fadeOutLen = Math.min(length, Math.max(32, Math.round(0.022 * sr)));

  for (let i = 0; i < length; i++) {
    let env = 1.0;
    if (i < attackLen) env *= i / attackLen;
    if (i >= length - fadeOutLen) env *= (length - 1 - i) / fadeOutLen;
    out[i] = processed[i] * norm * env;
  }

  return buffer;
}
