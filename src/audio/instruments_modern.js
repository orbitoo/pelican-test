// src/audio/instruments_modern.js
// Stage 4 — Modern, Electronic & Cinema-Era Instrument Synthesizers (#12..#17, #19..#20)
// plus the 20-Era Grand Tutti & Documentary Push-In Decrescendo (`Outro`, 125.0..137.0s).
//
// Strict Visual-Audio Gag Sync:
//   - #12 Starry Night (71..77s): Swirling multi-voice romantic strings + celesta/harp spark arpeggio (72.2..74.4s)
//   - #13 Scream       (77..83s): Expressionist string quartet -> Bar-2 (79..81s) wild microtonal sul-ponticello shriek!
//   - #14 Nosferatu    (83..89s): 1922 honky-tonk tack piano + gothic pipe organ + watchman tremolando + 88.5s HV arc zap!
//   - #15 Oscilloscope (89..95s): Pure CRT sine + 60/120Hz tube hum -> Lissajous FM/pitch warp (90.92..92.00s) + PLL lock!
//   - #16 8-bit        (95..101s): True 4-channel NES APU (2 pulse, 16-step triangle, LFSR noise) + 97.66s coin & 98.00s 1UP!
//   - #17 Chat        (101..107s): 2000s polyphonic FM MIDI ringtone + 100% original IM pops, typing & 103/104s window buzz!
//   - #19 Short-Video (113..119s): Punchy 2020s pop/future-bass beat + vocal-formant pluck + Bar-2 double-tap heart pops!
//   - #20 Code Art    (119..125s): Studio grand piano + luminous poly-synth + 36-partial Fourier harmonic sweep (119.12..121.25s)!
//   - Outro           (125..137s): 20-Era Grand Tutti (125.0..128.6s) -> push-in decrescendo to silence by 132.52s!

import { BEAT_SEC } from '../beat/timeline.js';
import {
  HOME_ROOT_MIDI,
  MAIN_MELODY_MOTIF,
  BASS_PEDAL_MOTIF,
  midiToFreq,
  getEraScaleMapper,
  createSeededRng,
  makeImpulseResponse,
} from './score.js';

// ============================================================================
// Shared Synthesis Helpers & Cached NES / Hardware Waveforms
// ============================================================================

const _periodicWaveCache = new WeakMap();

function getContextWaveCache(ctx) {
  let map = _periodicWaveCache.get(ctx);
  if (!map) {
    map = new Map();
    _periodicWaveCache.set(ctx, map);
  }
  return map;
}

/**
 * Builds a bandlimited NES Pulse PeriodicWave for exact duty cycles (0.125, 0.25, 0.50).
 */
function getNesPulseWave(ctx, duty = 0.25) {
  const cache = getContextWaveCache(ctx);
  const key = `pulse_${duty}`;
  if (cache.has(key)) return cache.get(key);

  const N = 48;
  const real = new Float32Array(N + 1);
  const imag = new Float32Array(N + 1);
  for (let k = 1; k <= N; k++) {
    // Fourier series of rectangular wave with duty cycle d:
    // a_k = (2 / (k * pi)) * sin(k * pi * d)
    real[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    imag[k] = 0;
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  cache.set(key, wave);
  return wave;
}

/**
 * Builds an authentic NES 4-bit quantized 16-step Triangle PeriodicWave (characteristic odd harmonics + 15th/17th alias!).
 */
function getNesTriangleWave(ctx) {
  const cache = getContextWaveCache(ctx);
  const key = 'nes_tri';
  if (cache.has(key)) return cache.get(key);

  const M = 32;
  const samples = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const step = i < 16 ? i : 31 - i; // 0..15..0
    samples[i] = (step / 7.5) - 1.0;
  }

  const K = 40;
  const real = new Float32Array(K + 1);
  const imag = new Float32Array(K + 1);
  for (let k = 1; k <= K; k++) {
    let re = 0;
    let im = 0;
    for (let n = 0; n < M; n++) {
      const ang = (2 * Math.PI * k * n) / M;
      re += samples[n] * Math.cos(ang);
      im -= samples[n] * Math.sin(ang);
    }
    real[k] = (2 * re) / M;
    imag[k] = (2 * im) / M;
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  cache.set(key, wave);
  return wave;
}

/**
 * Builds a deterministic 15-bit NES LFSR noise AudioBuffer at a discrete hardware shift clock.
 */
function getNesLfsrBuffer(ctx, modeShort = false, clockHz = 12000) {
  const cache = getContextWaveCache(ctx);
  const key = `lfsr_${modeShort ? 'short' : 'long'}_${clockHz}`;
  if (cache.has(key)) return cache.get(key);

  const dur = 0.6;
  const sr = ctx.sampleRate;
  const len = Math.ceil(dur * sr);
  const buf = ctx.createBuffer(1, len, sr);
  const out = buf.getChannelData(0);

  let lfsr = 1;
  let phase = 0;
  const stepInc = clockHz / sr;
  let curSample = 0.7;

  for (let i = 0; i < len; i++) {
    phase += stepInc;
    while (phase >= 1.0) {
      phase -= 1.0;
      const tapBit = modeShort ? (lfsr >> 6) & 1 : (lfsr >> 1) & 1;
      const feedback = (lfsr & 1) ^ tapBit;
      lfsr = (lfsr >> 1) | (feedback << 14);
      curSample = (lfsr & 1) ? 0.8 : -0.8;
    }
    out[i] = curSample;
  }

  cache.set(key, buf);
  return buf;
}

/**
 * Creates a click-free era sub-bus (`[t0, t1]`) with 15ms fade-in and clean 28ms release tail.
 */
function createEraBus(ctx, musicBus, sharedAssets, t0, t1, gainLevel = 0.85, hallSendAmt = 0.18) {
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, Math.max(0, t0 - 0.005));
  bus.gain.linearRampToValueAtTime(gainLevel, t0 + 0.015);
  bus.gain.setValueAtTime(gainLevel, t1 - 0.018);
  bus.gain.linearRampToValueAtTime(0.0001, t1 + 0.028);
  bus.connect(musicBus);

  if (sharedAssets && sharedAssets.hallSend && hallSendAmt > 0.001) {
    const send = ctx.createGain();
    send.gain.setValueAtTime(hallSendAmt, t0);
    bus.connect(send);
    send.connect(sharedAssets.hallSend);
  }
  return bus;
}

function connectPanned(ctx, node, dest, pan, t0) {
  if (typeof ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.01) {
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t0);
    node.connect(p);
    p.connect(dest);
  } else {
    node.connect(dest);
  }
}

// ============================================================================
// #12 梵高《星月夜》 (71.0..77.0s) — Swirling Romantic String Ensemble & Impasto Spark Harp
// ============================================================================

function scheduleRomanticStringsNote(ctx, dest, midi, t0, dur, vel = 0.85, opts = {}) {
  const {
    pan = 0,
    detuneSpread = 8.5,
    vibRate = 5.6,
    vibDepth = 14,
    attack = 0.065,
    brightness = 3600,
    gainScale = 0.11,
  } = opts;

  const freq = midiToFreq(midi);
  const endT = t0 + dur + 0.16;

  const body = ctx.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.setValueAtTime(510, t0);
  body.Q.setValueAtTime(1.5, t0);
  body.gain.setValueAtTime(4.2, t0);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(brightness, t0);
  lp.Q.setValueAtTime(0.85, t0);

  const env = ctx.createGain();
  const pk = gainScale * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + Math.min(attack, dur * 0.45));
  env.gain.setValueAtTime(pk * 0.88, t0 + Math.max(0.03, dur - 0.02));
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  body.connect(lp);
  lp.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  const vib = ctx.createOscillator();
  vib.type = 'sine';
  vib.frequency.setValueAtTime(vibRate, t0);
  const vibG = ctx.createGain();
  vibG.gain.setValueAtTime(0.0, t0);
  vibG.gain.linearRampToValueAtTime(vibDepth, t0 + Math.min(0.18, dur * 0.5));
  vib.connect(vibG);

  const detunes = [-detuneSpread, 0, detuneSpread * 0.92];
  for (let i = 0; i < detunes.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(detunes[i], t0);
    vibG.connect(osc.detune);
    osc.connect(body);
    osc.start(t0);
    osc.stop(endT + 0.02);
  }

  vib.start(t0);
  vib.stop(endT + 0.02);
}

function scheduleCelestaSpark(ctx, dest, midi, t0, dur = 0.45, vel = 0.7, pan = 0) {
  const freq = midiToFreq(midi);
  const endT = t0 + dur;

  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(freq, t0);

  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(freq * 4.0, t0); // Bell overtone
  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.18, t0);
  g2.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(0.075 * vel, t0 + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  osc1.connect(env);
  osc2.connect(g2);
  g2.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  osc1.start(t0);
  osc2.start(t0);
  osc1.stop(endT + 0.02);
  osc2.stop(endT + 0.02);
}

function scheduleEra12StarryNight(ctx, musicBus, sharedAssets) {
  const t0 = 71.0;
  const t1 = 77.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.36);
  const mapLydian = getEraScaleMapper('lydian', HOME_ROOT_MIDI); // D Lydian (#4 = G#)

  // 1. Soaring 1st & 2nd Violins playing MAIN_MELODY_MOTIF in D Lydian
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const midiLead = mapLydian(ev.deg, (ev.oct ?? 0) + 1);
    scheduleRomanticStringsNote(ctx, eraBus, midiLead, nt, dur * 1.05, ev.vel ?? 0.88, {
      pan: -0.26,
      detuneSpread: 9.5,
      vibRate: 5.8,
      vibDepth: 16,
      attack: 0.055,
      brightness: 4200,
      gainScale: 0.092,
    });
    // Warm sixth below on accented melodic pillars
    if (ev.accent || ev.dur >= 0.75) {
      const midiHarm = mapLydian(ev.deg - 2, (ev.oct ?? 0) + 1);
      scheduleRomanticStringsNote(ctx, eraBus, midiHarm, nt, dur * 1.04, (ev.vel ?? 0.85) * 0.72, {
        pan: 0.22,
        detuneSpread: 8.0,
        attack: 0.07,
        brightness: 3200,
        gainScale: 0.07,
      });
    }
  }

  // 2. Swirling Cello & Viola Nebula-Vortex Triplet/Eighth Arpeggio Ostinato
  const vortexDegrees = [0, 4, 7, 9, 7, 4]; // Swirling 6-note wave per 1.5 beats / bar
  for (let step = 0; step < 24; step++) {
    const beat = step * 0.5;
    const barRoot = beat < 4 ? 0 : beat < 8 ? 3 : 4;
    const deg = barRoot + vortexDegrees[step % vortexDegrees.length];
    const midi = mapLydian(deg, -1);
    const pan = Math.sin(step * 0.65) * 0.42;
    scheduleRomanticStringsNote(ctx, eraBus, midi, t0 + beat * BEAT_SEC, 0.48 * BEAT_SEC, 0.76, {
      pan,
      detuneSpread: 6.5,
      attack: 0.035,
      brightness: 2100,
      gainScale: 0.072,
    });
  }

  // Deep Cello Bass Pedal
  for (const b of BASS_PEDAL_MOTIF) {
    scheduleRomanticStringsNote(
      ctx,
      eraBus,
      mapLydian(b.deg, b.oct),
      t0 + b.beat * BEAT_SEC,
      b.dur * BEAT_SEC,
      b.vel ?? 0.85,
      { pan: 0.15, detuneSpread: 5.0, attack: 0.08, brightness: 1400, gainScale: 0.095 }
    );
  }

  // 3. Stage-3.5 Gag Sync (`72.20..74.45s`): Flame Cypress whips +30px shedding 15 golden impasto sparks
  //    into the sky S-vortex + sequential village cottage window ignition!
  const sparkDegrees = [0, 2, 3, 4, 6, 7, 9, 10, 11, 13, 14, 11, 9, 7, 14];
  sparkDegrees.forEach((deg, i) => {
    const st = 72.22 + i * 0.135;
    const pan = -0.55 + (i / (sparkDegrees.length - 1)) * 1.1;
    scheduleCelestaSpark(ctx, eraBus, mapLydian(deg, 1), st, 0.58, 0.82, pan);
  });
}

// ============================================================================
// #13 蒙克《呐喊》 (77.0..83.0s) — Intense Quartet & Bar-2 Out-of-Tune Shriek (`弦乐突然走调尖叫`)
// ============================================================================

function scheduleEra13Scream(ctx, musicBus, sharedAssets) {
  const t0 = 77.0;
  const t1 = 83.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.28);
  const mapMinor = getEraScaleMapper('harmonic_minor', HOME_ROOT_MIDI); // D Harmonic Minor

  // 1. String Quartet Melody: Tense & urgent in Bar 1 (77..79s), WILDLY OUT OF TUNE in Bar 2 (79..81s),
  //    snapping breathlessly back into tempo in Bar 3 (81..83s)!
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const isBar2Gag = ev.beat >= 3.95 && ev.beat < 7.98;
    const midi = mapMinor(ev.deg, (ev.oct ?? 0) + 1);

    if (!isBar2Gag) {
      // Focused, intense Nordic expressionist bowing in Bar 1 & Bar 3
      scheduleRomanticStringsNote(ctx, eraBus, midi, nt, dur * 0.96, ev.vel ?? 0.9, {
        pan: -0.22,
        detuneSpread: 7.0,
        vibRate: 6.6,
        vibDepth: 20,
        attack: 0.032,
        brightness: 3900,
        gainScale: 0.095,
      });
    } else {
      // Bar-2 Out-of-Tune Quartet Lurch: melody bends wildly sharp & flat with sul-ponticello metallic edge!
      const freq = midiToFreq(midi);
      const endT = nt + dur + 0.08;
      const bp = ctx.createBiquadFilter();
      bp.type = 'peaking';
      bp.frequency.setValueAtTime(2450, nt); // Glassy sul-ponticello bridge screech formant
      bp.Q.setValueAtTime(2.4, nt);
      bp.gain.setValueAtTime(8.5, nt);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, nt);
      env.gain.linearRampToValueAtTime(0.115 * (ev.vel ?? 0.95), nt + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, endT);
      bp.connect(env);
      connectPanned(ctx, env, eraBus, -0.18, nt);

      const bendCents = ev.beat < 5.2 ? 235 : ev.beat < 6.2 ? -285 : 310;
      [-28, 19, 64].forEach((spread) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, nt);
        osc.detune.setValueAtTime(spread, nt);
        osc.detune.linearRampToValueAtTime(spread + bendCents, nt + dur * 0.52);
        osc.detune.linearRampToValueAtTime(spread - bendCents * 0.65, endT);
        osc.connect(bp);
        osc.start(nt);
        osc.stop(endT + 0.02);
      });
    }
  }

  // 2. Bar-2 Signature Gag (`79.02..80.96s`): High Sul-Ponticello Quartet Shriek Glissando Cluster!
  //    Synced to the Screamer's shockwave warping the blood-red Oslo Fjord sky!
  const shriekVoices = [
    { startMidi: 75.0, peakMidi: 80.4, endMidi: 73.2, pan: -0.55 }, // Eb5 -> Ab5+ -> C#5
    { startMidi: 80.0, peakMidi: 86.7, endMidi: 78.6, pan: -0.18 }, // G#5 -> D6- -> F#5+
    { startMidi: 81.5, peakMidi: 88.3, endMidi: 79.4, pan: 0.24 },  // Quarter-tone A5+ -> E6 -> G5+
    { startMidi: 63.0, peakMidi: 57.3, endMidi: 61.8, pan: 0.52 },  // Cello plunging downward groan!
  ];
  shriekVoices.forEach((v) => {
    const st0 = 79.01;
    const stPeak = 79.58;
    const stWaver = 80.32;
    const stEnd = 80.97;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(midiToFreq(v.startMidi), st0);
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(v.peakMidi), stPeak);
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(v.peakMidi - 1.8), stWaver);
    osc.frequency.exponentialRampToValueAtTime(midiToFreq(v.endMidi), stEnd);

    // Jagged 11.5 Hz panic vibrato
    const vib = ctx.createOscillator();
    vib.type = 'triangle';
    vib.frequency.setValueAtTime(11.5, st0);
    const vibG = ctx.createGain();
    vibG.gain.setValueAtTime(48, st0);
    vib.connect(vibG);
    vibG.connect(osc.detune);

    const hp = ctx.createBiquadFilter();
    hp.type = 'peaking';
    hp.frequency.setValueAtTime(2600, st0);
    hp.Q.setValueAtTime(2.2, st0);
    hp.gain.setValueAtTime(6.0, st0);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, st0);
    g.gain.linearRampToValueAtTime(0.062, st0 + 0.08);
    g.gain.setValueAtTime(0.056, stWaver);
    g.gain.exponentialRampToValueAtTime(0.0001, stEnd + 0.02);

    osc.connect(hp);
    hp.connect(g);
    connectPanned(ctx, g, eraBus, v.pan, st0);

    osc.start(st0);
    vib.start(st0);
    osc.stop(stEnd + 0.04);
    vib.stop(stEnd + 0.04);
  });

  // Rosin bow-scrape shockwave breath at 79.02s
  if (sharedAssets.pinkNoise) {
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = sharedAssets.pinkNoise;
    nSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1900, 79.0);
    bp.frequency.exponentialRampToValueAtTime(950, 80.9);
    bp.Q.setValueAtTime(2.8, 79.0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 79.0);
    g.gain.linearRampToValueAtTime(0.075, 79.12);
    g.gain.exponentialRampToValueAtTime(0.0001, 80.95);
    nSrc.connect(bp);
    bp.connect(g);
    g.connect(eraBus);
    nSrc.start(79.0, 0.4);
    nSrc.stop(80.98);
  }

  // 3. Urgent Spiccato Cello & Viola Bridge Pulse (Bar 1 & snapping back cleanly on Bar 3 `81.00s`!)
  for (let beat = 0; beat < 12; beat += 0.5) {
    if (beat >= 4.0 && beat < 8.0) continue; // Suspended during the Bar-2 shriek!
    const bt = t0 + beat * BEAT_SEC;
    const rootDeg = beat < 4 ? 0 : beat < 10 ? 4 : 6;
    const midi = mapMinor(rootDeg, -1);
    scheduleRomanticStringsNote(ctx, eraBus, midi, bt, 0.34 * BEAT_SEC, beat === 8.0 ? 1.0 : 0.78, {
      pan: 0.25,
      detuneSpread: 5.5,
      attack: 0.015,
      brightness: 2400,
      gainScale: 0.095,
    });
  }
}

// ============================================================================
// #14 《诺斯费拉图》 (83.0..89.0s) — 1922 Silent-Film Tack Piano, Gothic Organ & HV Arc
// ============================================================================

function scheduleTackPianoNote(ctx, dest, whiteNoise, midi, t0, dur, vel = 0.85, pan = -0.15) {
  const freq = midiToFreq(midi);
  const endT = t0 + Math.min(dur + 0.14, 1.2);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(3100, t0);
  lp.frequency.exponentialRampToValueAtTime(1100, endT);

  const env = ctx.createGain();
  const pk = 0.092 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + 0.004);
  env.gain.exponentialRampToValueAtTime(pk * 0.36, t0 + 0.16);
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  lp.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  // 3 slightly out-of-tune 1922 cinema upright strings (-13, +1.5, +15 cents!)
  const detunes = [-13.5, 1.5, 15.0];
  const types = ['triangle', 'sawtooth', 'triangle'];
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    osc.type = types[i];
    osc.frequency.setValueAtTime(freq, t0);
    osc.detune.setValueAtTime(detunes[i], t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(i === 1 ? 0.38 : 0.52, t0);
    osc.connect(g);
    g.connect(lp);
    osc.start(t0);
    osc.stop(endT + 0.02);
  }

  // Brass thumbtack-on-felt hammer click transient
  if (whiteNoise) {
    const n = ctx.createBufferSource();
    n.buffer = whiteNoise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, t0);
    bp.Q.setValueAtTime(2.5, t0);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.036 * vel, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.014);
    n.connect(bp);
    bp.connect(ng);
    connectPanned(ctx, ng, dest, pan, t0);
    n.start(t0, (t0 * 1.13) % 2.0);
    n.stop(t0 + 0.018);
  }
}

function schedulePipeOrganChord(ctx, dest, midis, t0, dur, vel = 0.7, pan = 0.18) {
  const endT = t0 + dur + 0.12;
  const out = ctx.createGain();
  const pk = 0.044 * vel;
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(pk, t0 + 0.08);
  out.gain.setValueAtTime(pk * 0.92, t0 + Math.max(0.09, dur - 0.06));
  out.gain.exponentialRampToValueAtTime(0.0001, endT);
  connectPanned(ctx, out, dest, pan, t0);

  // Cathedral organ stops: 16' (0.5x), 8' (1x), 4' (2x), 2-2/3' Nazard (3x), 2' (4x)
  const ratios = [0.5, 1.0, 2.0, 3.0, 4.0];
  const amps = [0.45, 0.85, 0.48, 0.22, 0.18];

  for (const m of midis) {
    const f0 = midiToFreq(m);
    for (let r = 0; r < ratios.length; r++) {
      const osc = ctx.createOscillator();
      osc.type = r === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(f0 * ratios[r], t0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(amps[r], t0);
      osc.connect(g);
      g.connect(out);
      osc.start(t0);
      osc.stop(endT + 0.02);
    }
  }
}

function scheduleEra14Nosferatu(ctx, musicBus, sharedAssets) {
  const t0 = 83.0;
  const t1 = 89.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.34);
  const mapHarmMin = getEraScaleMapper('harmonic_minor', HOME_ROOT_MIDI);

  // 1. Silent-Film Honky-Tonk Upright Piano playing MAIN_MELODY_MOTIF (octaves on dramatic peaks!)
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const midi = mapHarmMin(ev.deg, (ev.oct ?? 0) + 1);
    scheduleTackPianoNote(ctx, eraBus, sharedAssets.whiteNoise, midi, nt, dur, ev.vel ?? 0.88, -0.18);
    if (ev.accent) {
      scheduleTackPianoNote(ctx, eraBus, null, midi - 12, nt + 0.008, dur * 0.9, 0.58, -0.25);
    }
  }

  // Silent-cinema oom-pah stride left-hand diminished accompaniment
  const dimChords = [
    { beat: 0, bass: 50, chord: [53, 56, 62] }, // Dm / Ddim
    { beat: 2, bass: 49, chord: [55, 58, 61] }, // C#dim7
    { beat: 4, bass: 50, chord: [56, 59, 62] }, // Ddim7 (Orlok confronts watchman!)
    { beat: 6, bass: 44, chord: [53, 56, 59] }, // G#dim7
    { beat: 8, bass: 45, chord: [52, 55, 61] }, // A7(b9)
    { beat: 10, bass: 50, chord: [53, 57, 62] }, // Dm -> zap!
  ];
  for (const dc of dimChords) {
    const b0 = t0 + dc.beat * BEAT_SEC;
    scheduleTackPianoNote(ctx, eraBus, sharedAssets.whiteNoise, dc.bass, b0, 0.45 * BEAT_SEC, 0.82, -0.3);
    dc.chord.forEach((m) => {
      scheduleTackPianoNote(ctx, eraBus, null, m, b0 + 0.5 * BEAT_SEC, 0.35 * BEAT_SEC, 0.62, -0.12);
    });
    scheduleTackPianoNote(ctx, eraBus, null, dc.bass - 5, b0 + 1.0 * BEAT_SEC, 0.45 * BEAT_SEC, 0.76, -0.3);
    dc.chord.forEach((m) => {
      scheduleTackPianoNote(ctx, eraBus, null, m, b0 + 1.5 * BEAT_SEC, 0.35 * BEAT_SEC, 0.60, -0.12);
    });

    // Gothic Pipe Organ ominous sustained diminished harmonies
    schedulePipeOrganChord(ctx, eraBus, dc.chord, b0, 1.95 * BEAT_SEC, 0.76, 0.24);
  }

  // 2. Stage-3.5 Gag Sync (`85.50..87.45s`): Nervous Silent-Cinema Diminished-7th Tremolando
  //    as the candle-bearer Hutter cowers under Orlok's bicycle and spins +X in horror!
  const tremNotes = [68, 71, 74, 77]; // G#4 - B4 - D5 - F5 diminished tremolando
  let stepIdx = 0;
  for (let tt = 85.50; tt < 87.42; tt += 0.085) {
    const m = tremNotes[stepIdx % tremNotes.length];
    scheduleTackPianoNote(ctx, eraBus, null, m, tt, 0.10, 0.52, 0.08);
    stepIdx++;
  }

  // 3. Stage-3 Seam Sync (`88.52..89.03s`): High-Voltage Cathode-Ray Corona Discharge Arc Zap
  //    electrifying Count Orlok's shadow across the sprocket/rack seam directly into #15 CRT!
  {
    const zapStart = 88.52;
    const zapEnd = 89.03;

    const buzz120 = ctx.createOscillator();
    buzz120.type = 'sawtooth';
    buzz120.frequency.setValueAtTime(120, zapStart);
    buzz120.frequency.linearRampToValueAtTime(240, zapEnd);

    const buzzMod = ctx.createOscillator();
    buzzMod.type = 'square';
    buzzMod.frequency.setValueAtTime(38, zapStart);
    const modG = ctx.createGain();
    modG.gain.setValueAtTime(85, zapStart);
    buzzMod.connect(modG);
    modG.connect(buzz120.frequency);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1450, zapStart);
    bp.frequency.exponentialRampToValueAtTime(3200, zapEnd);
    bp.Q.setValueAtTime(2.6, zapStart);

    const zg = ctx.createGain();
    zg.gain.setValueAtTime(0.0001, zapStart);
    zg.gain.exponentialRampToValueAtTime(0.115, 88.94);
    zg.gain.exponentialRampToValueAtTime(0.0001, zapEnd + 0.02);

    buzz120.connect(bp);
    bp.connect(zg);
    zg.connect(eraBus);

    buzz120.start(zapStart);
    buzzMod.start(zapStart);
    buzz120.stop(zapEnd + 0.03);
    buzzMod.stop(zapEnd + 0.03);

    if (sharedAssets.whiteNoise) {
      const arcNoise = ctx.createBufferSource();
      arcNoise.buffer = sharedAssets.whiteNoise;
      arcNoise.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(3800, zapStart);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, zapStart);
      ng.gain.exponentialRampToValueAtTime(0.085, 88.96);
      ng.gain.exponentialRampToValueAtTime(0.0001, zapEnd + 0.02);
      arcNoise.connect(hp);
      hp.connect(ng);
      ng.connect(eraBus);
      arcNoise.start(zapStart, 0.2);
      arcNoise.stop(zapEnd + 0.03);
    }
  }
}

// ============================================================================
// #15 示波器矢量图 (89.0..95.0s) — Pure CRT Sine, Vacuum-Tube Hum & Lissajous FM Twist
// ============================================================================

function scheduleEra15Oscilloscope(ctx, musicBus, sharedAssets) {
  const t0 = 89.0;
  const t1 = 95.0;
  // Tight dry lab presence (minimal hall send so pure CRT vector beam feels razor-focused!)
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.08);
  const mapMix = getEraScaleMapper('mixolydian', HOME_ROOT_MIDI);

  // 1. Continuous Warm 1950s Vacuum-Tube Power-Supply Hum (60Hz + 120Hz + 180Hz)
  const humG = ctx.createGain();
  humG.gain.setValueAtTime(0.036, t0);
  humG.connect(eraBus);
  [
    { f: 60, a: 0.65 },
    { f: 120, a: 0.55 },
    { f: 180, a: 0.22 },
  ].forEach(({ f, a }) => {
    const hOsc = ctx.createOscillator();
    hOsc.type = 'sine';
    hOsc.frequency.setValueAtTime(f, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(a, t0);
    hOsc.connect(g);
    g.connect(humG);
    hOsc.start(t0);
    hOsc.stop(t1 + 0.04);
  });

  // Bakelite rotary knob mechanical detent clicks right when lab hand twists (90.94s) & snaps back (91.98s)!
  if (sharedAssets.whiteNoise) {
    for (const clickT of [90.94, 91.98]) {
      const n = ctx.createBufferSource();
      n.buffer = sharedAssets.whiteNoise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1850, clickT);
      bp.Q.setValueAtTime(3.2, clickT);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.095, clickT);
      cg.gain.exponentialRampToValueAtTime(0.0001, clickT + 0.018);
      n.connect(bp);
      bp.connect(cg);
      cg.connect(eraBus);
      n.start(clickT, 0.5);
      n.stop(clickT + 0.022);
    }
  }

  // 2. Continuous X/Y Electron-Beam Sine Lead + Lissajous 3:4 Harmonic FM Warp (`90.92..92.00s`!)
  //    Exact sync to `s15_oscilloscope.js` `getGagState`:
  //      twistIn = smoothstep(1.92, 2.15, localT) -> 90.92..91.15s
  //      snapBack = smoothstep(2.91, 2.995, localT) -> 91.91..92.00s
  //      pllRing = localT 2.995..3.48s -> 92.00..92.48s underdamped PLL lock-in bounce!
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const endT = nt + dur + 0.02;
    const freq = midiToFreq(mapMix(ev.deg, (ev.oct ?? 0) + 1));

    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.setValueAtTime(freq, nt);

    // Subtle quadrature CH2 sub-harmonic companion sine for warm vector body
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq * 0.5, nt);
    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.28, nt);

    // Check overlap with Lissajous twist window [90.92..92.00s]
    if (endT > 90.92 && nt < 92.02) {
      // 3:4 Lissajous Frequency Ratio FM Modulator + Sweeping Figure-8 Pitch Warp!
      const lissMod = ctx.createOscillator();
      lissMod.type = 'sine';
      lissMod.frequency.setValueAtTime(freq * (4 / 3), nt);

      const lissIndex = ctx.createGain();
      const wStart = Math.max(nt, 90.92);
      const wEnd = Math.min(endT, 92.00);
      lissIndex.gain.setValueAtTime(0.01, nt);
      if (wEnd > wStart) {
        lissIndex.gain.linearRampToValueAtTime(freq * 1.45, Math.min(wEnd, wStart + 0.12));
        lissIndex.gain.setValueAtTime(freq * 1.65, Math.max(wStart, wEnd - 0.05));
        lissIndex.gain.linearRampToValueAtTime(0.01, wEnd);
      }
      lissMod.connect(lissIndex);
      lissIndex.connect(car.frequency);

      // Wild Lissajous figure-8 pitch spiral LFO
      const warpLfo = ctx.createOscillator();
      warpLfo.type = 'sine';
      warpLfo.frequency.setValueAtTime(9.5, nt);
      warpLfo.frequency.linearRampToValueAtTime(18.5, wEnd);
      const warpDepth = ctx.createGain();
      warpDepth.gain.setValueAtTime(0.0, nt);
      if (wEnd > wStart) {
        warpDepth.gain.linearRampToValueAtTime(420, Math.min(wEnd, wStart + 0.1));
        warpDepth.gain.linearRampToValueAtTime(0.0, wEnd);
      }
      warpLfo.connect(warpDepth);
      warpDepth.connect(car.detune);
      warpDepth.connect(sub.detune);

      lissMod.start(nt);
      warpLfo.start(nt);
      lissMod.stop(endT + 0.02);
      warpLfo.stop(endT + 0.02);
    }

    // Exact 2nd-order underdamped PLL Lock-In Bounce right at t = 92.00s (beat 6.00)!
    if (Math.abs(nt - 92.0) < 0.05) {
      for (let k = 0; k <= 12; k++) {
        const dt = k * 0.028;
        const ringCents = Math.exp(-dt * 9.5) * Math.cos(dt * 46.0) * 145;
        car.detune.linearRampToValueAtTime(ringCents, nt + dt);
      }
      car.detune.linearRampToValueAtTime(0, nt + 0.38);
    }

    const env = ctx.createGain();
    const pk = 0.185 * (ev.vel ?? 0.88);
    env.gain.setValueAtTime(0.0001, nt);
    env.gain.linearRampToValueAtTime(pk, nt + 0.008);
    env.gain.setValueAtTime(pk * 0.92, nt + Math.max(0.012, dur - 0.012));
    env.gain.exponentialRampToValueAtTime(0.0001, endT);

    car.connect(env);
    sub.connect(subG);
    subG.connect(env);
    env.connect(eraBus);

    car.start(nt);
    sub.start(nt);
    car.stop(endT + 0.02);
    sub.stop(endT + 0.02);
  }

  // Clean calibrated 120 BPM Tektronix timebase trigger blip on every beat
  for (let b = 0; b < 12; b++) {
    const bt = t0 + b * BEAT_SEC;
    const blip = ctx.createOscillator();
    blip.type = 'sine';
    const bf = b % 4 === 0 ? 1174.66 : 587.33; // D6 / D5 calibration pip
    blip.frequency.setValueAtTime(bf, bt);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, bt);
    bg.gain.linearRampToValueAtTime(b % 4 === 0 ? 0.052 : 0.028, bt + 0.002);
    bg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.032);
    blip.connect(bg);
    bg.connect(eraBus);
    blip.start(bt);
    blip.stop(bt + 0.038);
  }
}

// ============================================================================
// #16 8-bit 像素游戏 (95.0..101.0s) — True 4-Channel NES Synthesis + Original Coin & 1UP!
// ============================================================================

function scheduleNesPulseNote(ctx, dest, wave, midi, t0, dur, vel = 0.85, gainScale = 0.11, pan = 0) {
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.setValueAtTime(midiToFreq(midi), t0);

  const g = ctx.createGain();
  const pk = gainScale * vel;
  // Crisp hardware-style 2ms attack & 15Hz envelope decay
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(pk, t0 + 0.002);
  g.gain.setValueAtTime(pk * 0.84, t0 + Math.max(0.005, dur - 0.01));
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.004);

  osc.connect(g);
  connectPanned(ctx, g, dest, pan, t0);
  osc.start(t0);
  osc.stop(t0 + dur + 0.01);
}

function scheduleEra16Chiptune8Bit(ctx, musicBus, sharedAssets) {
  const t0 = 95.0;
  const t1 = 101.0;
  // Pure dry 8-bit console output (tiny 0.04 room touch so pixels sound razor-crisp!)
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.04);
  const mapMaj = getEraScaleMapper('major', HOME_ROOT_MIDI); // D Major

  const pulse25 = getNesPulseWave(ctx, 0.25);
  const pulse12 = getNesPulseWave(ctx, 0.125);
  const nesTri = getNesTriangleWave(ctx);
  const lfsrLong = getNesLfsrBuffer(ctx, false, 11000);
  const lfsrShort = getNesLfsrBuffer(ctx, true, 7500);

  // 1. NES Channel 1 (25% Duty Pulse): Heroic `MAIN_MELODY_MOTIF` Lead
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC * 0.92; // Crisp staccato 8-bit articulation
    const midi = mapMaj(ev.deg, (ev.oct ?? 0) + 1);
    scheduleNesPulseNote(ctx, eraBus, pulse25, midi, nt, dur, ev.vel ?? 0.9, 0.115, -0.18);
  }

  // 2. NES Channel 2 (12.5% Duty Pulse): Fast 60Hz Chip Arpeggio Chords (`[0, 4, 7]`!)
  const chipChords = [
    { beat: 0, dur: 2, notes: [62, 66, 69] }, // D
    { beat: 2, dur: 2, notes: [59, 62, 66] }, // Bm
    { beat: 4, dur: 2, notes: [67, 71, 74] }, // G
    { beat: 6, dur: 2, notes: [69, 73, 76] }, // A
    { beat: 8, dur: 2, notes: [62, 66, 69] }, // D
    { beat: 10, dur: 2, notes: [69, 73, 76] }, // A -> D
  ];
  for (const ch of chipChords) {
    const cStart = t0 + ch.beat * BEAT_SEC;
    const cEnd = cStart + ch.dur * BEAT_SEC - 0.01;
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(pulse12);
    let idx = 0;
    for (let at = cStart; at < cEnd; at += 1 / 48) {
      osc.frequency.setValueAtTime(midiToFreq(ch.notes[idx % ch.notes.length]), at);
      idx++;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, cStart);
    g.gain.linearRampToValueAtTime(0.062, cStart + 0.003);
    g.gain.setValueAtTime(0.055, cEnd - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, cEnd + 0.004);
    osc.connect(g);
    connectPanned(ctx, g, eraBus, 0.22, cStart);
    osc.start(cStart);
    osc.stop(cEnd + 0.01);
  }

  // 3. NES Channel 3 (16-Step Quantized Triangle): Octave-Jumping Arcade Bassline
  const bassRoots = [50, 50, 47, 47, 43, 43, 45, 45, 50, 47, 45, 45]; // 12 beats
  for (let b = 0; b < 12; b++) {
    const bt = t0 + b * BEAT_SEC;
    const rootM = bassRoots[b];
    for (const [subOff, m] of [[0.0, rootM], [0.5, rootM + 12]]) {
      const st = bt + subOff * BEAT_SEC;
      const sDur = 0.44 * BEAT_SEC;
      const tri = ctx.createOscillator();
      tri.setPeriodicWave(nesTri);
      tri.frequency.setValueAtTime(midiToFreq(m), st);
      const tg = ctx.createGain();
      tg.gain.setValueAtTime(0.0001, st);
      tg.gain.linearRampToValueAtTime(0.165, st + 0.003);
      tg.gain.setValueAtTime(0.165, st + sDur - 0.005);
      tg.gain.linearRampToValueAtTime(0.0001, st + sDur);
      tri.connect(tg);
      tg.connect(eraBus);
      tri.start(st);
      tri.stop(st + sDur + 0.01);
    }
  }

  // 4. NES Channel 4 (LFSR Noise Percussion: Chip Kick, Snare & Hi-Hat)
  for (let step = 0; step < 24; step++) {
    const st = t0 + step * 0.25;
    const inBarStep = step % 8;
    const isSnare = inBarStep === 2 || inBarStep === 6;
    const isKick = inBarStep === 0 || inBarStep === 4 || inBarStep === 5;

    if (isKick) {
      // Classic NES triangle/pulse pitch-drop chip kick
      const ko = ctx.createOscillator();
      ko.setPeriodicWave(nesTri);
      ko.frequency.setValueAtTime(190, st);
      ko.frequency.exponentialRampToValueAtTime(52, st + 0.065);
      const kg = ctx.createGain();
      kg.gain.setValueAtTime(0.17, st);
      kg.gain.exponentialRampToValueAtTime(0.0001, st + 0.075);
      ko.connect(kg);
      kg.connect(eraBus);
      ko.start(st);
      ko.stop(st + 0.08);
    }

    const nSrc = ctx.createBufferSource();
    nSrc.buffer = isSnare ? lfsrLong : lfsrShort;
    nSrc.playbackRate.setValueAtTime(isSnare ? 1.0 : 1.85, st);
    const ng = ctx.createGain();
    const nDur = isSnare ? 0.11 : 0.032;
    ng.gain.setValueAtTime(isSnare ? 0.095 : 0.036, st);
    ng.gain.exponentialRampToValueAtTime(0.0001, st + nDur);
    nSrc.connect(ng);
    ng.connect(eraBus);
    nSrc.start(st, 0);
    nSrc.stop(st + nDur + 0.01);
  }

  // 5. 100% Original Arcade SFX Synced to `s16_8bit.js`!
  //    a) Pit Takeoff Jump Sweep (`localT = 2.12s` -> `t = 97.12s`): crisp upward pulse sweep
  {
    const jt = 97.12;
    const jOsc = ctx.createOscillator();
    jOsc.setPeriodicWave(pulse25);
    jOsc.frequency.setValueAtTime(220, jt);
    jOsc.frequency.exponentialRampToValueAtTime(620, jt + 0.14);
    const jg = ctx.createGain();
    jg.gain.setValueAtTime(0.085, jt);
    jg.gain.exponentialRampToValueAtTime(0.0001, jt + 0.15);
    jOsc.connect(jg);
    jg.connect(eraBus);
    jOsc.start(jt);
    jOsc.stop(jt + 0.16);
  }

  //    b) Original Diamond-Coin Collect Chime (`HIT_T = 2.66s` -> `t = 97.66s`!):
  //       Original 3-step sparkling D-pentatonic crystal chime (A5 -> D6 -> A6, zero Mario B5->E6!)
  {
    const ct = 97.66;
    const coinNotes = [
      { m: 81, off: 0.0, dur: 0.055 },   // A5
      { m: 86, off: 0.052, dur: 0.055 }, // D6
      { m: 93, off: 0.104, dur: 0.21 },  // A6 sparkling ring!
    ];
    for (const cn of coinNotes) {
      scheduleNesPulseNote(ctx, eraBus, pulse25, cn.m, ct + cn.off, cn.dur, 1.0, 0.135, 0.12);
    }
  }

  //    c) Strong-Beat Original `1UP` Jubilant 4-Note Fanfare (`localT = 3.00s` -> `t = 98.00s`!):
  //       Original rising D-Lydian crystal fanfare (D6 -> F#6 -> G#6 -> D7, zero Nintendo melody!)
  {
    const ut = 98.00;
    const oneUpNotes = [
      { m: 86, off: 0.00, dur: 0.085 }, // D6
      { m: 90, off: 0.09, dur: 0.085 }, // F#6
      { m: 92, off: 0.18, dur: 0.085 }, // G#6
      { m: 98, off: 0.27, dur: 0.22 },  // D7 jubilant crown!
    ];
    for (const un of oneUpNotes) {
      scheduleNesPulseNote(ctx, eraBus, pulse12, un.m, ut + un.off, un.dur, 0.95, 0.125, -0.1);
    }
  }
}

// ============================================================================
// #17 早期聊天窗口 (101.0..107.0s) — 2000s Polyphonic MIDI Ringtone & Original IM SFX
// ============================================================================

function scheduleMidiRingtoneNote(ctx, dest, midi, t0, dur, vel = 0.85, pan = 0) {
  const freq = midiToFreq(midi);
  const endT = t0 + dur + 0.08;

  // Classic 2002 Yamaha MA-3 / SoundBlaster OPL3 4-op FM Ringtone Bell-Lead (Carrier + 3:1 Modulator)
  const car = ctx.createOscillator();
  car.type = 'sine';
  car.frequency.setValueAtTime(freq, t0);

  const mod = ctx.createOscillator();
  mod.type = 'sine';
  mod.frequency.setValueAtTime(freq * 3.0, t0);
  const modG = ctx.createGain();
  modG.gain.setValueAtTime(freq * 1.45 * vel, t0);
  modG.gain.exponentialRampToValueAtTime(freq * 0.18, t0 + Math.min(0.18, dur));

  const env = ctx.createGain();
  const pk = 0.125 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(pk * 0.42, t0 + Math.min(0.22, dur * 0.7));
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  mod.connect(modG);
  modG.connect(car.frequency);
  car.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  car.start(t0);
  mod.start(t0);
  car.stop(endT + 0.02);
  mod.stop(endT + 0.02);
}

/**
 * 100% Original Synthetic Desktop IM Percussion (ZERO copyrighted QQ `滴滴` or cough samples!):
 * - `bubblePop`: Cheerful water-droplet upward sine pop + tiny crystal bell overtone
 * - `keyClick`: Crisp 2003 beige mechanical keyboard keycap clack
 * - `windowBuzz`: Authentic Win32 `闪屏振动` electric desk-buzzer + playful spring wobble (`103.0s & 104.0s`)
 */
function scheduleOriginalImPop(ctx, dest, t, accent = false, pan = 0) {
  // Single smooth upward water-bubble pop + airy bell harmonic (never 3-beep `滴滴滴`!)
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  const fStart = accent ? 440 : 587.33;
  const fEnd = accent ? 880 : 1174.66;
  osc.frequency.setValueAtTime(fStart, t);
  osc.frequency.exponentialRampToValueAtTime(fEnd, t + 0.052);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(accent ? 0.115 : 0.075, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

  osc.connect(g);
  connectPanned(ctx, g, dest, pan, t);
  osc.start(t);
  osc.stop(t + 0.085);
}

function scheduleKeyboardClick(ctx, dest, whiteNoise, t, vel = 0.6, pan = 0) {
  if (!whiteNoise) return;
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(3200 + ((t * 997) % 700), t);
  bp.Q.setValueAtTime(2.8, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.042 * vel, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.015);
  src.connect(bp);
  bp.connect(g);
  connectPanned(ctx, g, dest, pan, t);
  src.start(t, (t * 1.41) % 2.5);
  src.stop(t + 0.02);
}

function scheduleWindowBuzzRattle(ctx, dest, t) {
  // Synced to `s17_chat.js` Bar-2 strong-beat `闪屏振动` at localT = 2.0s (103.0s) & 3.0s (104.0s)!
  const dur = 0.31;
  const car = ctx.createOscillator();
  car.type = 'triangle';
  car.frequency.setValueAtTime(165, t);
  car.frequency.linearRampToValueAtTime(215, t + 0.12);
  car.frequency.linearRampToValueAtTime(148, t + dur);

  // 28Hz rapid window-frame shake AM modulation
  const rattleLfo = ctx.createOscillator();
  rattleLfo.type = 'square';
  rattleLfo.frequency.setValueAtTime(28, t);

  const amNode = ctx.createGain();
  amNode.gain.setValueAtTime(0.055, t);
  const lfoScale = ctx.createGain();
  lfoScale.gain.setValueAtTime(0.05, t);
  rattleLfo.connect(lfoScale);
  lfoScale.connect(amNode.gain);

  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(1.15, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

  car.connect(amNode);
  amNode.connect(env);
  env.connect(dest);

  car.start(t);
  rattleLfo.start(t);
  car.stop(t + dur + 0.02);
  rattleLfo.stop(t + dur + 0.02);
}

function scheduleEra17ChatWindow(ctx, musicBus, sharedAssets) {
  const t0 = 101.0;
  const t1 = 107.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.14);
  const mapMaj = getEraScaleMapper('major', HOME_ROOT_MIDI);

  // 1. Polyphonic FM MIDI Ringtone Lead (`MAIN_MELODY_MOTIF` in bright octave + General MIDI chord stabs)
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const midi = mapMaj(ev.deg, (ev.oct ?? 0) + 1);
    scheduleMidiRingtoneNote(ctx, eraBus, midi, nt, dur * 0.92, ev.vel ?? 0.88, -0.12);
    if (ev.accent) {
      scheduleMidiRingtoneNote(ctx, eraBus, mapMaj(ev.deg - 2, (ev.oct ?? 0) + 1), nt, dur * 0.85, 0.55, 0.18);
    }
  }

  // General MIDI SoundBlaster Synth-Choir / Celesta Pad Chords & Bouncy MIDI Bass
  const midiProg = [
    { beat: 0, bass: 50, chord: [62, 66, 69] }, // D
    { beat: 2, bass: 45, chord: [61, 64, 69] }, // A/C#
    { beat: 4, bass: 47, chord: [59, 62, 66] }, // Bm
    { beat: 6, bass: 43, chord: [59, 62, 67] }, // G
    { beat: 8, bass: 50, chord: [62, 66, 69] }, // D
    { beat: 10, bass: 45, chord: [61, 64, 69] }, // A
  ];
  for (const mp of midiProg) {
    const bt = t0 + mp.beat * BEAT_SEC;
    // Bouncy MIDI eighth-note bass
    for (let s = 0; s < 4; s++) {
      const st = bt + s * 0.5 * BEAT_SEC;
      scheduleMidiRingtoneNote(ctx, eraBus, mp.bass + (s % 2 === 1 ? 12 : 0), st, 0.42 * BEAT_SEC, 0.72, 0);
    }
    // Off-beat MIDI chord stabs
    for (const off of [0.5, 1.5]) {
      mp.chord.forEach((cm) => {
        scheduleMidiRingtoneNote(ctx, eraBus, cm, bt + off * BEAT_SEC, 0.35 * BEAT_SEC, 0.42, 0.22);
      });
    }
  }

  // 2. Original IM Bubble Pops & PC Keyboard Typing Percussion Groove
  for (let b = 0; b < 12; b++) {
    const bt = t0 + b * BEAT_SEC;
    // Downbeat / Backbeat bubbly IM pop
    scheduleOriginalImPop(ctx, eraBus, bt, b % 2 === 0, b % 2 === 0 ? -0.25 : 0.25);

    // 16th-note typing clatter rhythm (`对方正在输入...`)
    for (let sub = 1; sub < 4; sub++) {
      if ((b + sub) % 2 === 0 || sub === 2) {
        scheduleKeyboardClick(ctx, eraBus, sharedAssets.whiteNoise, bt + sub * 0.125, 0.75, (sub - 2) * 0.25);
      }
    }
  }

  // 3. Exact Bar-2 Window Buzz (`闪屏振动`) at `t = 103.00s` (`localT = 2.0s`) & `t = 104.00s` (`localT = 3.0s`)!
  scheduleWindowBuzzRattle(ctx, eraBus, 103.00);
  scheduleWindowBuzzRattle(ctx, eraBus, 104.00);
}

// ============================================================================
// #19 竖屏短视频 (113.0..119.0s) — Tight Modern Pop / Future-Bass & Viral Heart-Burst Pops
// ============================================================================

function scheduleModernPopPluck(ctx, dest, midi, t0, dur, vel = 0.9, pan = 0) {
  const freq = midiToFreq(midi);
  const endT = t0 + dur + 0.08;

  // Punchy modern vocal-formant / future-bass saw+square pluck with crisp pitch-snap transient
  const osc1 = ctx.createOscillator();
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(freq * 1.06, t0);
  osc1.frequency.exponentialRampToValueAtTime(freq, t0 + 0.016);

  const osc2 = ctx.createOscillator();
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(freq, t0);
  osc2.detune.setValueAtTime(7.0, t0);

  // Vocal "ah/ee" formant filter peak + snappy lowpass pluck envelope
  const formant = ctx.createBiquadFilter();
  formant.type = 'peaking';
  formant.frequency.setValueAtTime(1250, t0);
  formant.Q.setValueAtTime(2.2, t0);
  formant.gain.setValueAtTime(5.5, t0);

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(5800, t0);
  lp.frequency.exponentialRampToValueAtTime(1600, endT);
  lp.Q.setValueAtTime(1.8, t0);

  const g2 = ctx.createGain();
  g2.gain.setValueAtTime(0.48, t0);

  const env = ctx.createGain();
  const pk = 0.115 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + 0.004);
  env.gain.exponentialRampToValueAtTime(pk * 0.45, t0 + Math.min(0.14, dur * 0.6));
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  osc1.connect(formant);
  osc2.connect(g2);
  g2.connect(formant);
  formant.connect(lp);
  lp.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  osc1.start(t0);
  osc2.start(t0);
  osc1.stop(endT + 0.02);
  osc2.stop(endT + 0.02);
}

function scheduleEra19ShortVideo(ctx, musicBus, sharedAssets) {
  const t0 = 113.0;
  const t1 = 119.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.88, 0.15);
  const mapMaj = getEraScaleMapper('major', HOME_ROOT_MIDI);

  // 1. Tight Modern Pop Kick (Four-on-the-floor + syncopated bounce) + Crisp Layered Clap + Trap Hi-Hat Rolls
  for (let b = 0; b < 12; b++) {
    const bt = t0 + b * BEAT_SEC;

    // Punchy 2020s Sub-Kick on every quarter beat
    const ko = ctx.createOscillator();
    ko.type = 'sine';
    ko.frequency.setValueAtTime(165, bt);
    ko.frequency.exponentialRampToValueAtTime(48, bt + 0.065);
    ko.frequency.exponentialRampToValueAtTime(36, bt + 0.21);
    const kg = ctx.createGain();
    kg.gain.setValueAtTime(0.0001, bt);
    kg.gain.linearRampToValueAtTime(0.24, bt + 0.003);
    kg.gain.exponentialRampToValueAtTime(0.0001, bt + 0.22);
    ko.connect(kg);
    kg.connect(eraBus);
    ko.start(bt);
    ko.stop(bt + 0.23);

    // Crisp Layered Pop Clap on backbeats (beats 1, 3, 5, 7, 9, 11)
    if (b % 2 === 1 && sharedAssets.whiteNoise) {
      for (let flam = 0; flam < 3; flam++) {
        const ct = bt + flam * 0.009;
        const n = ctx.createBufferSource();
        n.buffer = sharedAssets.whiteNoise;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.setValueAtTime(1950, ct);
        bp.Q.setValueAtTime(1.3, ct);
        const cg = ctx.createGain();
        cg.gain.setValueAtTime(flam === 2 ? 0.11 : 0.055, ct);
        cg.gain.exponentialRampToValueAtTime(0.0001, ct + (flam === 2 ? 0.11 : 0.025));
        n.connect(bp);
        bp.connect(cg);
        cg.connect(eraBus);
        n.start(ct, flam * 0.3);
        n.stop(ct + 0.13);
      }
    }

    // Tight 16th hi-hats + 32nd-note trap hat roll leading into Bar 2 (b=3) & Bar 3 (b=7)!
    if (sharedAssets.whiteNoise) {
      const subdivs = (b === 3 || b === 7) ? 8 : 2;
      for (let s = 0; s < subdivs; s++) {
        const ht = bt + (s / subdivs) * BEAT_SEC;
        const hSrc = ctx.createBufferSource();
        hSrc.buffer = sharedAssets.whiteNoise;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.setValueAtTime(8400, ht);
        const hg = ctx.createGain();
        hg.gain.setValueAtTime(subdivs === 8 ? 0.038 : s === 1 ? 0.055 : 0.032, ht);
        hg.gain.exponentialRampToValueAtTime(0.0001, ht + 0.032);
        hSrc.connect(hp);
        hp.connect(hg);
        connectPanned(ctx, hg, eraBus, subdivs === 8 ? (s / 8 - 0.5) * 0.7 : 0.18, ht);
        hSrc.start(ht, (ht * 1.9) % 2.5);
        hSrc.stop(ht + 0.04);
      }
    }
  }

  // Sidechained Future-Bass Synth Chords + Punchy Sub-Bass
  const popChords = [
    { beat: 0, bass: 38, notes: [62, 66, 69, 73] }, // Dmaj7
    { beat: 2, bass: 45, notes: [61, 64, 69, 73] }, // A
    { beat: 4, bass: 47, notes: [59, 62, 66, 71] }, // Bm7
    { beat: 6, bass: 43, notes: [59, 62, 67, 71] }, // Gmaj7
    { beat: 8, bass: 38, notes: [62, 66, 69, 74] }, // D
    { beat: 10, bass: 45, notes: [62, 67, 69, 73] }, // A9sus4
  ];
  for (const pc of popChords) {
    for (let sub = 0; sub < 4; sub++) {
      // Off-beat sidechain swell on each quarter beat!
      const st = t0 + (pc.beat + sub * 0.5) * BEAT_SEC;
      if (sub % 2 === 1) {
        pc.notes.forEach((m, idx) => {
          scheduleModernPopPluck(ctx, eraBus, m, st, 0.42 * BEAT_SEC, 0.46, (idx - 1.5) * 0.22);
        });
      } else {
        // Punchy 808-style warm bass
        scheduleModernPopPluck(ctx, eraBus, pc.bass + 12, st + 0.12, 0.35 * BEAT_SEC, 0.72, 0);
      }
    }
  }

  // 2. Viral Vocal-Formant Pluck Lead (`MAIN_MELODY_MOTIF`)
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    scheduleModernPopPluck(
      ctx,
      eraBus,
      mapMaj(ev.deg, (ev.oct ?? 0) + 1),
      nt,
      dur * 0.9,
      ev.vel ?? 0.92,
      -0.08
    );
  }

  // 3. Exact `s19_shortvideo.js` Bar-2 Double-Tap Heart-Burst Pops (`localT = 1.98, 2.34, 2.62, 2.96, 3.35s`)!
  const heartBurstOffsets = [1.98, 2.34, 2.62, 2.96, 3.35];
  const sparkleMidis = [86, 90, 93, 95, 98];
  heartBurstOffsets.forEach((off, i) => {
    const ht = t0 + off;
    scheduleOriginalImPop(ctx, eraBus, ht, true, (i % 2 === 0 ? 1 : -1) * 0.35);
    scheduleCelestaSpark(ctx, eraBus, sparkleMidis[i], ht + 0.025, 0.32, 0.78, (i - 2) * 0.2);
  });
}

// ============================================================================
// #20 代码美学 (119.0..125.0s) — Crystalline Studio Piano, Luminous Synth & 36-Harmonic Fourier Sweep
// ============================================================================

function scheduleStudioGrandPianoNote(ctx, dest, midi, t0, dur, vel = 0.85, pan = 0) {
  const freq = midiToFreq(midi);
  const endT = t0 + Math.max(dur, 0.35) + 0.38;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(Math.min(7500, freq * 7.5 * (0.55 + 0.55 * vel)), t0);
  lp.frequency.exponentialRampToValueAtTime(Math.max(650, freq * 1.9), endT);

  const env = ctx.createGain();
  const pk = 0.118 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + 0.006);
  env.gain.exponentialRampToValueAtTime(pk * 0.52, t0 + 0.24);
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  lp.connect(env);
  connectPanned(ctx, env, dest, pan, t0);

  // Studio piano string partials with subtle natural steel-string stretch inharmonicity
  const partials = [
    { mult: 1.0, amp: 0.72, type: 'triangle', det: -1.2 },
    { mult: 1.0, amp: 0.48, type: 'sine', det: 1.4 },
    { mult: 2.0006, amp: 0.32, type: 'sine', det: 0 },
    { mult: 3.0018, amp: 0.16, type: 'sine', det: 0 },
    { mult: 4.0035, amp: 0.08, type: 'sine', det: 0 },
  ];
  for (const p of partials) {
    if (freq * p.mult >= ctx.sampleRate * 0.45) continue;
    const osc = ctx.createOscillator();
    osc.type = p.type;
    osc.frequency.setValueAtTime(freq * p.mult, t0);
    if (p.det) osc.detune.setValueAtTime(p.det, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.amp, t0);
    if (p.mult >= 3) {
      g.gain.exponentialRampToValueAtTime(0.005, t0 + 0.28);
    }
    osc.connect(g);
    g.connect(lp);
    osc.start(t0);
    osc.stop(endT + 0.02);
  }
}

function scheduleLuminousPolySynth(ctx, dest, midis, t0, dur, vel = 0.75, cutoffPeak = 3200) {
  const endT = t0 + dur + 0.22;
  const vcf = ctx.createBiquadFilter();
  vcf.type = 'lowpass';
  vcf.frequency.setValueAtTime(950, t0);
  vcf.frequency.exponentialRampToValueAtTime(cutoffPeak, t0 + dur * 0.55);
  vcf.frequency.exponentialRampToValueAtTime(1300, endT);
  vcf.Q.setValueAtTime(1.1, t0);

  const env = ctx.createGain();
  const pk = 0.048 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(pk, t0 + 0.12);
  env.gain.setValueAtTime(pk * 0.92, t0 + Math.max(0.14, dur - 0.08));
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  vcf.connect(env);
  env.connect(dest);

  midis.forEach((m, idx) => {
    const f = midiToFreq(m);
    for (const det of [-8.5, 8.5]) {
      const osc = ctx.createOscillator();
      osc.type = idx % 2 === 0 ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      osc.detune.setValueAtTime(det, t0);
      osc.connect(vcf);
      osc.start(t0);
      osc.stop(endT + 0.02);
    }
  });
}

function scheduleEra20CodeArt(ctx, musicBus, sharedAssets) {
  const t0 = 119.0;
  const t1 = 125.0;
  const eraBus = createEraBus(ctx, musicBus, sharedAssets, t0, t1, 0.90, 0.34);
  const mapMaj = getEraScaleMapper('major', HOME_ROOT_MIDI);

  // 1. Act I (`119.12..121.25s`, `localT = 0.12..2.25s`):
  //    Real 36-Partial Additive Fourier Epicycle Harmonic Sweep (`Σ c_k · exp(i·k·ω·t)`)!
  //    Partials k = 1..36 over fundamental D2 (73.416 Hz) blossom sequentially as the epicycle
  //    chain live-traces the pelican silhouette, converging into silk crystallization at 121.25s!
  const f0 = midiToFreq(38); // D2 = 73.416 Hz -> k=1..36 spans 73.4 Hz .. 2,643 Hz (pure harmonic crystal!)
  for (let k = 1; k <= 36; k++) {
    const u = (k - 1) / 35;
    const kt0 = 119.12 + u * 1.72; // Sweeps k=1..36 across 119.12..120.84s
    const ktEnd = 121.38;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f0 * k, kt0);

    // Weight consonant D-Lydian/Major partials brightly, dampening dissonant 7th/11th/13th slightly
    const isConsonant = [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 15, 16, 18, 20, 24, 30, 32, 36].includes(k);
    const amp = (isConsonant ? 0.024 : 0.0085) / Math.pow(k, 0.38);

    const pg = ctx.createGain();
    pg.gain.setValueAtTime(0.00005, kt0);
    pg.gain.linearRampToValueAtTime(amp, kt0 + 0.045);
    pg.gain.exponentialRampToValueAtTime(0.00005, ktEnd);

    osc.connect(pg);
    connectPanned(ctx, pg, eraBus, Math.sin(k * 0.9) * 0.65, kt0);
    osc.start(kt0);
    osc.stop(ktEnd + 0.02);
  }

  // 2. Crystalline Studio Grand Piano playing `MAIN_MELODY_MOTIF` + Flowing Left-Hand Arpeggios
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = t0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const midi = mapMaj(ev.deg, (ev.oct ?? 0) + 1);
    const pan = ((ev.deg - 2) / 8) * 0.32;
    scheduleStudioGrandPianoNote(ctx, eraBus, midi, nt, dur * 1.15, ev.vel ?? 0.9, pan);
    // Act III (beats 8..12, `123..125s`): double melody an octave higher for luminous culmination!
    if (ev.beat >= 8.0) {
      scheduleStudioGrandPianoNote(ctx, eraBus, midi + 12, nt + 0.006, dur, (ev.vel ?? 0.85) * 0.62, pan + 0.15);
    }
  }

  // Flowing 16th/8th Studio Piano Left-Hand 9th Arpeggios
  const codeHarmony = [
    { beat: 0, notes: [50, 57, 64, 66] }, // Dadd9
    { beat: 2, notes: [47, 54, 61, 62] }, // Bm9
    { beat: 4, notes: [43, 50, 57, 59] }, // Gmaj9 (Act II crystallization!)
    { beat: 6, notes: [45, 52, 57, 61] }, // Aadd4
    { beat: 8, notes: [50, 57, 62, 66] }, // Dmaj7 (Act III!)
    { beat: 10, notes: [45, 52, 59, 64] }, // A13 -> Grand Tutti!
  ];
  for (const ch of codeHarmony) {
    const bt = t0 + ch.beat * BEAT_SEC;
    ch.notes.forEach((m, i) => {
      scheduleStudioGrandPianoNote(ctx, eraBus, m, bt + i * 0.25, 0.85, 0.65, -0.25 + i * 0.1);
    });
    // Warm Luminous Poly-Synth blossoming wider in Act II & Act III
    const cutoff = ch.beat < 4 ? 2200 : ch.beat < 8 ? 3600 : 5200;
    scheduleLuminousPolySynth(ctx, eraBus, ch.notes.map((n) => n + 12), bt, 1.96 * BEAT_SEC, 0.78, cutoff);
  }
}

// ============================================================================
// OUTRO (125.0..137.0s) — 20-Era Grand Tutti (`125.0..128.6s`) & Push-In Decrescendo (`128.6..132.52s`)
// ============================================================================

function scheduleOutroGrandTutti(ctx, musicBus, sharedAssets, worldTuttiFn) {
  // CRITICAL ISOLATION: Wrap ALL Outro instruments AND a dedicated Cathedral Convolver
  // inside `outroMasterBus` so when `outroMasterBus.gain` reaches 0.0000 at `132.52s`,
  // 100.000% of music & reverb tails vanish before `132.6s`, keeping `132.9..135.7s`
  // hushed press-room ambience < -42 dBFS ahead of the `136.00s` solo bicycle bell!
  const outroMasterBus = ctx.createGain();
  outroMasterBus.gain.setValueAtTime(0.0001, 124.99);
  outroMasterBus.gain.linearRampToValueAtTime(0.92, 125.015);
  // Hold glorious 20-era Grand Tutti across `125.0..128.6s` (wide 7x3 gallery wall panorama!)
  outroMasterBus.gain.setValueAtTime(0.92, 128.60);
  // Smooth documentary push-in decrescendo (`推镜时渐弱`, 128.60..132.52s -> exact 0.0!)
  outroMasterBus.gain.exponentialRampToValueAtTime(0.18, 130.80);
  outroMasterBus.gain.exponentialRampToValueAtTime(0.015, 132.15);
  outroMasterBus.gain.linearRampToValueAtTime(0.0, 132.52);
  outroMasterBus.connect(musicBus);

  // Dedicated internal hall/cathedral reverb inside `outroMasterBus` (gated cleanly by outroMasterBus!)
  const tuttiDry = ctx.createGain();
  tuttiDry.gain.setValueAtTime(0.82, 125.0);
  tuttiDry.connect(outroMasterBus);

  const tuttiVerb = ctx.createConvolver();
  tuttiVerb.buffer =
    sharedAssets.cathedralReverbIR ||
    sharedAssets.hallReverbIR ||
    makeImpulseResponse(ctx, 2.8, 2.6, 2020);
  const tuttiWet = ctx.createGain();
  tuttiWet.gain.setValueAtTime(0.32, 125.0);
  tuttiVerb.connect(tuttiWet);
  tuttiWet.connect(outroMasterBus);

  const tuttiMix = ctx.createGain();
  tuttiMix.gain.setValueAtTime(1.0, 125.0);
  tuttiMix.connect(tuttiDry);
  tuttiMix.connect(tuttiVerb);

  // 1. World-Era Tutti Layer (`编钟 + 琵琶 + 笛子 + 甘美兰 + 西塔琴`) from `@audio-composer`
  if (typeof worldTuttiFn === 'function') {
    const worldSub = ctx.createGain();
    worldSub.gain.setValueAtTime(0.72, 125.0);
    worldSub.connect(tuttiMix);
    worldTuttiFn(ctx, worldSub, 125.0, 7.4, sharedAssets);
  }

  const mapMaj = getEraScaleMapper('major', HOME_ROOT_MIDI);
  const pulse25 = getNesPulseWave(ctx, 0.25);

  // 2. Modern & Orchestral Tutti Unison (`125.0..131.0s`: full 3-bar theme + `131.0..132.5s` warm Dmaj9 resolution!)
  for (const ev of MAIN_MELODY_MOTIF) {
    const nt = 125.0 + ev.beat * BEAT_SEC;
    const dur = ev.dur * BEAT_SEC;
    const mLead = mapMaj(ev.deg, (ev.oct ?? 0) + 1);
    const vel = ev.vel ?? 0.92;

    // Romantic Violins & Celli (#12/#13)
    scheduleRomanticStringsNote(ctx, tuttiMix, mLead, nt, dur * 1.08, vel, {
      pan: -0.32,
      detuneSpread: 10.0,
      attack: 0.04,
      brightness: 4400,
      gainScale: 0.068,
    });
    scheduleRomanticStringsNote(ctx, tuttiMix, mLead - 12, nt, dur * 1.08, vel * 0.85, {
      pan: 0.28,
      detuneSpread: 7.5,
      attack: 0.05,
      brightness: 2800,
      gainScale: 0.055,
    });

    // Crystalline Studio Grand Piano (#20)
    scheduleStudioGrandPianoNote(ctx, tuttiMix, mLead, nt, dur * 1.1, vel * 0.88, 0.12);

    // Nostalgic 8-bit 25% Pulse Sparkle (#16) tucked delicately into upper register
    scheduleNesPulseNote(ctx, tuttiMix, pulse25, mLead + 12, nt, dur * 0.85, vel * 0.65, 0.032, -0.18);
  }

  // Majestic Pipe Organ + Synth Brass Harmonic Pillars (`125.0..131.0s`) + Final Settling Chord (`131.0..132.5s`)
  const tuttiChords = [
    { t: 125.0, dur: 1.0, bass: 38, notes: [50, 57, 62, 66] }, // D
    { t: 126.0, dur: 1.0, bass: 47, notes: [47, 54, 59, 62] }, // Bm
    { t: 127.0, dur: 1.0, bass: 43, notes: [43, 50, 59, 62] }, // G
    { t: 128.0, dur: 1.0, bass: 45, notes: [45, 52, 57, 61] }, // A
    { t: 129.0, dur: 1.0, bass: 47, notes: [47, 54, 59, 62] }, // Bm (decrescendo underway!)
    { t: 130.0, dur: 1.0, bass: 43, notes: [43, 50, 57, 62] }, // G6/9
    { t: 131.0, dur: 1.48, bass: 38, notes: [50, 57, 64, 66] }, // Warm Dadd9 resolving into hush!
  ];

  for (const tc of tuttiChords) {
    schedulePipeOrganChord(ctx, tuttiMix, tc.notes, tc.t, tc.dur, 0.65, -0.15);
    scheduleLuminousPolySynth(ctx, tuttiMix, tc.notes.map((n) => n + 12), tc.t, tc.dur, 0.68, 3800);
    scheduleRomanticStringsNote(ctx, tuttiMix, tc.bass, tc.t, tc.dur, 0.88, {
      pan: 0.0,
      detuneSpread: 5.5,
      attack: 0.05,
      brightness: 1200,
      gainScale: 0.085,
    });
  }

  // Orchestral Timpani & Shimmering Cymbal Bloom on 125.00s (Exhibition Reveal!) & 127.00s
  for (const hitT of [125.0, 127.0, 129.0]) {
    const timp = ctx.createOscillator();
    timp.type = 'sine';
    const tf = hitT === 127.0 ? midiToFreq(43) : midiToFreq(38);
    timp.frequency.setValueAtTime(tf * 1.18, hitT);
    timp.frequency.exponentialRampToValueAtTime(tf, hitT + 0.09);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, hitT);
    tg.gain.linearRampToValueAtTime(hitT === 129.0 ? 0.14 : 0.22, hitT + 0.006);
    tg.gain.exponentialRampToValueAtTime(0.0001, hitT + 0.85);
    timp.connect(tg);
    tg.connect(tuttiMix);
    timp.start(hitT);
    timp.stop(hitT + 0.9);
  }

  if (sharedAssets.whiteNoise) {
    const cym = ctx.createBufferSource();
    cym.buffer = sharedAssets.whiteNoise;
    cym.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(5200, 125.0);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, 125.0);
    cg.gain.linearRampToValueAtTime(0.075, 125.04);
    cg.gain.exponentialRampToValueAtTime(0.0001, 127.2);
    cym.connect(hp);
    hp.connect(cg);
    cg.connect(tuttiMix);
    cym.start(125.0, 0.1);
    cym.stop(127.25);
  }
}

// ============================================================================
// Master Export Entrypoint
// ============================================================================

export function scheduleModernErasAndOutro(ctx, musicBus, sharedAssets = {}, worldTuttiFn = null) {
  // RNG touched deterministically if needed by future extensions
  createSeededRng(20261220);

  scheduleEra12StarryNight(ctx, musicBus, sharedAssets);
  scheduleEra13Scream(ctx, musicBus, sharedAssets);
  scheduleEra14Nosferatu(ctx, musicBus, sharedAssets);
  scheduleEra15Oscilloscope(ctx, musicBus, sharedAssets);
  scheduleEra16Chiptune8Bit(ctx, musicBus, sharedAssets);
  scheduleEra17ChatWindow(ctx, musicBus, sharedAssets);
  // Note: Era #18 Vaporwave (107.0..113.0s) is scheduled via `scheduleVaporwaveEra` in `vaporwave.js`!
  scheduleEra19ShortVideo(ctx, musicBus, sharedAssets);
  scheduleEra20CodeArt(ctx, musicBus, sharedAssets);
  scheduleOutroGrandTutti(ctx, musicBus, sharedAssets, worldTuttiFn);
}
