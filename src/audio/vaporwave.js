// src/audio/vaporwave.js
// Era #18 Vaporwave (`107.0..113.0s`) — Authentic 4-Step Slowed 1980s Mall-Cassette Pipeline:
//   Step 1 (`prepareVaporwaveSourceBuffer`): Inner OfflineAudioContext renders an original 1980s
//     smooth-jazz / mall-atrium piece at 151.2 BPM (+4 semitones in F# Major = MIDI 66):
//     DX7 FM E-Piano (Maj7/min9), Fretless Bass (pitch slides), Breathy FM Alto Sax (MAIN_MELODY_MOTIF
//     smooth-jazz variation), and 80s Gated-Reverb Drum Machine.
//   Step 2 (`scheduleVaporwaveEra`): Plays rendered AudioBuffer as a physical cassette at
//     playbackRate = 2^(-4/12) = 0.793700526 (dropping 151.2 BPM -> 120.00 BPM & F# -> home D!),
//     routed through ~3.85s high-wet (~56%) stereo reverb, ~3900 Hz 12dB cassette lowpass,
//     0.5 Hz (±15 cents) tape wow/flutter LFO, and gentle magnetic tape hiss.
//   Step 3: Entry tape-brake (107.00..107.42s: 1.00 -> 0.7937) & strong-beat exit tape speed-up
//     (112.72..113.00s: 0.7937 -> 1.00).
//   Step 4: Bar-2 tape-loop stutter gag `跳针` (109.00..110.00s): 4 x 0.25s half-beat slice repeats
//     with magnetic splice clicks, seamlessly resuming 0.7937x playback at 110.00s.

import {
  MAIN_MELODY_MOTIF,
  midiToFreq,
  getEraScaleMapper,
  createSeededRng,
  makeNoiseBuffer,
  makeImpulseResponse,
} from './score.js';

export const VAPOR_TAPE_RATE = Math.pow(2, -4 / 12); // 0.7937005259840998 (-4 semitones)
export const VAPOR_SOURCE_BPM = 120 / VAPOR_TAPE_RATE; // 151.190526 BPM (~151.2 BPM)
const SRC_BEAT_SEC = 60 / VAPOR_SOURCE_BPM; // 0.396850263s (1 film beat = 0.5s after 0.7937x slowdown)
const SRC_ROOT_MIDI = 66; // F#4 (+4 semitones above D4 = 62)
const SRC_LEAD_IN = 0.14; // Source tape pre-roll before Beat 0

function resolveAudioCtor() {
  if (typeof OfflineAudioContext !== 'undefined') return OfflineAudioContext;
  if (typeof globalThis !== 'undefined' && globalThis.webkitOfflineAudioContext) {
    return globalThis.webkitOfflineAudioContext;
  }
  throw new Error('OfflineAudioContext is required for prepareVaporwaveSourceBuffer');
}

/**
 * Schedules a lush 1980s Yamaha DX7-style FM Electric Piano note (glassy tine bell + warm Rhodes body).
 */
function scheduleDx7EPianoNote(ctx, dest, midi, t0, dur, vel = 0.5, pan = 0) {
  const freq = midiToFreq(midi);
  const endT = t0 + dur + 0.35;

  const out = ctx.createGain();
  const peak = 0.085 * vel;
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.linearRampToValueAtTime(peak, t0 + 0.007);
  out.gain.exponentialRampToValueAtTime(peak * 0.42, t0 + Math.min(0.45, dur * 0.55));
  out.gain.exponentialRampToValueAtTime(0.0001, endT);

  let target = dest;
  if (typeof ctx.createStereoPanner === 'function' && Math.abs(pan) > 0.01) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(pan, t0);
    out.connect(panner);
    panner.connect(dest);
  } else {
    out.connect(dest);
  }

  // Operator Pair 1: Warm fundamental + 1:1 FM bark modulator
  const car1 = ctx.createOscillator();
  car1.type = 'sine';
  car1.frequency.setValueAtTime(freq, t0);

  const mod1 = ctx.createOscillator();
  mod1.type = 'sine';
  mod1.frequency.setValueAtTime(freq, t0);

  const mod1Gain = ctx.createGain();
  mod1Gain.gain.setValueAtTime(freq * (1.35 * vel), t0);
  mod1Gain.gain.exponentialRampToValueAtTime(freq * 0.18, t0 + 0.38);
  mod1.connect(mod1Gain);
  mod1Gain.connect(car1.frequency);
  car1.connect(out);

  // Operator Pair 2: Detuned chorus carrier + 14:1 glassy DX7 tine bell transient
  const car2 = ctx.createOscillator();
  car2.type = 'sine';
  car2.frequency.setValueAtTime(freq, t0);
  car2.detune.setValueAtTime(4.5, t0);

  const mod2 = ctx.createOscillator();
  mod2.type = 'sine';
  mod2.frequency.setValueAtTime(Math.min(14000, freq * 14), t0);

  const mod2Gain = ctx.createGain();
  mod2Gain.gain.setValueAtTime(freq * 1.9 * vel, t0);
  mod2Gain.gain.exponentialRampToValueAtTime(0.01, t0 + 0.16);

  const car2Mix = ctx.createGain();
  car2Mix.gain.setValueAtTime(0.55, t0);

  mod2.connect(mod2Gain);
  mod2Gain.connect(car2.frequency);
  car2.connect(car2Mix);
  car2Mix.connect(out);

  car1.start(t0);
  mod1.start(t0);
  car2.start(t0);
  mod2.start(t0);
  car1.stop(endT + 0.02);
  mod1.stop(endT + 0.02);
  car2.stop(endT + 0.02);
  mod2.stop(endT + 0.02);
}

/**
 * Schedules a warm 1980s Fretless Bass note with vocal formant resonant lowpass ("mwah")
 * and optional smooth fretless fingerboard pitch slide.
 */
function scheduleFretlessBassNote(ctx, dest, midi, t0, dur, vel = 0.85, slideFromMidi = null) {
  const targetFreq = midiToFreq(midi);
  const startFreq = slideFromMidi !== null ? midiToFreq(slideFromMidi) : targetFreq;
  const endT = t0 + dur + 0.09;

  const oscSaw = ctx.createOscillator();
  oscSaw.type = 'sawtooth';
  const oscTri = ctx.createOscillator();
  oscTri.type = 'triangle';
  oscTri.detune.setValueAtTime(-3.5, t0);

  oscSaw.frequency.setValueAtTime(startFreq, t0);
  oscTri.frequency.setValueAtTime(startFreq, t0);
  if (slideFromMidi !== null && slideFromMidi !== midi) {
    const slideEnd = t0 + Math.min(0.11, dur * 0.42);
    oscSaw.frequency.exponentialRampToValueAtTime(targetFreq, slideEnd);
    oscTri.frequency.exponentialRampToValueAtTime(targetFreq, slideEnd);
  }

  // Expressive fretless vibrato on longer notes
  if (dur > 0.35) {
    const vib = ctx.createOscillator();
    const vibGain = ctx.createGain();
    vib.frequency.setValueAtTime(5.2, t0);
    vibGain.gain.setValueAtTime(0.0, t0);
    vibGain.gain.linearRampToValueAtTime(9.0, t0 + 0.18);
    vib.connect(vibGain);
    vibGain.connect(oscSaw.detune);
    vibGain.connect(oscTri.detune);
    vib.start(t0);
    vib.stop(endT + 0.02);
  }

  // Resonant "mwah" filter envelope
  const vcf = ctx.createBiquadFilter();
  vcf.type = 'lowpass';
  vcf.Q.setValueAtTime(3.4, t0);
  vcf.frequency.setValueAtTime(280, t0);
  vcf.frequency.exponentialRampToValueAtTime(860 * vel + 260, t0 + 0.055);
  vcf.frequency.exponentialRampToValueAtTime(390, endT);

  const sawGain = ctx.createGain();
  sawGain.gain.setValueAtTime(0.58, t0);
  const triGain = ctx.createGain();
  triGain.gain.setValueAtTime(0.75, t0);

  const env = ctx.createGain();
  const peak = 0.21 * vel;
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.016);
  env.gain.setValueAtTime(peak * 0.86, t0 + Math.max(0.02, dur - 0.03));
  env.gain.exponentialRampToValueAtTime(0.0001, endT);

  oscSaw.connect(sawGain);
  oscTri.connect(triGain);
  sawGain.connect(vcf);
  triGain.connect(vcf);
  vcf.connect(env);
  env.connect(dest);

  oscSaw.start(t0);
  oscTri.start(t0);
  oscSaw.stop(endT + 0.02);
  oscTri.stop(endT + 0.02);
}

/**
 * Schedules an expressive 1980s Smooth-Jazz Breathy FM Alto Saxophone note
 * with reed FM harmonics, dual body formants, grace-note scoop, vibrato, and breath turbulence.
 */
function scheduleFmAltoSaxNote(ctx, dest, noiseBuf, midi, t0, dur, vel = 0.85, scoopSemitones = 0) {
  const targetFreq = midiToFreq(midi);
  const startFreq = scoopSemitones !== 0 ? midiToFreq(midi + scoopSemitones) : targetFreq;
  const endT = t0 + dur + 0.08;

  const car = ctx.createOscillator();
  car.type = 'sine';
  const mod1 = ctx.createOscillator();
  mod1.type = 'sine';
  const mod2 = ctx.createOscillator();
  mod2.type = 'triangle';

  car.frequency.setValueAtTime(startFreq, t0);
  mod1.frequency.setValueAtTime(startFreq, t0);
  mod2.frequency.setValueAtTime(startFreq * 2.0, t0);

  if (scoopSemitones !== 0) {
    const scoopT = t0 + Math.min(0.075, dur * 0.32);
    car.frequency.exponentialRampToValueAtTime(targetFreq, scoopT);
    mod1.frequency.exponentialRampToValueAtTime(targetFreq, scoopT);
    mod2.frequency.exponentialRampToValueAtTime(targetFreq * 2.0, scoopT);
  }

  // Expressive delayed sax vibrato (~5.6 Hz)
  const vib = ctx.createOscillator();
  const vibGain = ctx.createGain();
  vib.frequency.setValueAtTime(5.6, t0);
  vibGain.gain.setValueAtTime(0.0, t0);
  vibGain.gain.linearRampToValueAtTime(dur > 0.28 ? 18.0 : 7.0, t0 + Math.min(0.16, dur * 0.5));
  vib.connect(vibGain);
  vibGain.connect(car.detune);
  vibGain.connect(mod1.detune);

  // Reed embouchure FM index envelope (brassier on attack, warm smooth-jazz sustain)
  const mod1Gain = ctx.createGain();
  mod1Gain.gain.setValueAtTime(targetFreq * 0.4, t0);
  mod1Gain.gain.linearRampToValueAtTime(targetFreq * (2.35 * vel), t0 + 0.038);
  mod1Gain.gain.exponentialRampToValueAtTime(targetFreq * (1.35 * vel), t0 + Math.max(0.08, dur * 0.7));

  const mod2Gain = ctx.createGain();
  mod2Gain.gain.setValueAtTime(targetFreq * 0.85 * vel, t0);
  mod2Gain.gain.exponentialRampToValueAtTime(targetFreq * 0.35, endT);

  mod1.connect(mod1Gain);
  mod1Gain.connect(car.frequency);
  mod2.connect(mod2Gain);
  mod2Gain.connect(car.frequency);

  // Dual brass/conical bore formant filters
  const formant1 = ctx.createBiquadFilter();
  formant1.type = 'peaking';
  formant1.frequency.setValueAtTime(920, t0);
  formant1.Q.setValueAtTime(1.8, t0);
  formant1.gain.setValueAtTime(5.5, t0);

  const formant2 = ctx.createBiquadFilter();
  formant2.type = 'lowpass';
  formant2.frequency.setValueAtTime(3400, t0);
  formant2.Q.setValueAtTime(1.1, t0);

  const saxEnv = ctx.createGain();
  const peak = 0.165 * vel;
  saxEnv.gain.setValueAtTime(0.0001, t0);
  saxEnv.gain.linearRampToValueAtTime(peak, t0 + 0.028);
  saxEnv.gain.setValueAtTime(peak * 0.88, t0 + Math.max(0.04, dur - 0.025));
  saxEnv.gain.exponentialRampToValueAtTime(0.0001, endT);

  car.connect(formant1);
  formant1.connect(formant2);
  formant2.connect(saxEnv);
  saxEnv.connect(dest);

  // Breathy reed air turbulence transient
  if (noiseBuf) {
    const breathSrc = ctx.createBufferSource();
    breathSrc.buffer = noiseBuf;
    breathSrc.loop = true;
    const breathBp = ctx.createBiquadFilter();
    breathBp.type = 'bandpass';
    breathBp.frequency.setValueAtTime(2350, t0);
    breathBp.Q.setValueAtTime(1.6, t0);

    const breathGain = ctx.createGain();
    breathGain.gain.setValueAtTime(0.0001, t0);
    breathGain.gain.linearRampToValueAtTime(0.036 * vel, t0 + 0.018);
    breathGain.gain.exponentialRampToValueAtTime(0.007 * vel, t0 + Math.min(0.11, dur * 0.5));
    breathGain.gain.exponentialRampToValueAtTime(0.0001, endT);

    breathSrc.connect(breathBp);
    breathBp.connect(breathGain);
    breathGain.connect(dest);
    breathSrc.start(t0, (t0 * 1.37) % 2.5);
    breathSrc.stop(endT + 0.02);
  }

  car.start(t0);
  mod1.start(t0);
  mod2.start(t0);
  vib.start(t0);
  car.stop(endT + 0.02);
  mod1.stop(endT + 0.02);
  mod2.stop(endT + 0.02);
  vib.stop(endT + 0.02);
}

/**
 * Schedules 1980s LinnDrum/707-style Drum Machine hits with iconic nonlinear Gated-Reverb Snare!
 */
function schedule80sGatedDrums(ctx, dest, whiteNoise, pinkNoise, barStartT, beatSec) {
  const scheduleKick = (t, vel = 0.9) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(142, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.095);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.24);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.28 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);

    // Punchy beater click
    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(920, t);
    click.frequency.exponentialRampToValueAtTime(140, t + 0.016);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.075 * vel, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

    osc.connect(g);
    g.connect(dest);
    click.connect(cg);
    cg.connect(dest);

    osc.start(t);
    osc.stop(t + 0.27);
    click.start(t);
    click.stop(t + 0.022);
  };

  const scheduleGatedSnare = (t, vel = 0.85) => {
    // 1. Punchy 80s drum-machine snare shell body
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(218, t);
    body.frequency.exponentialRampToValueAtTime(126, t + 0.085);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.linearRampToValueAtTime(0.18 * vel, t + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    body.connect(bodyGain);
    bodyGain.connect(dest);
    body.start(t);
    body.stop(t + 0.14);

    // 2. Crisp snare wire snap + Nonlinear 80s Gated-Reverb Burst (holds flat ~195ms then slams shut!)
    const nSrc = ctx.createBufferSource();
    nSrc.buffer = pinkNoise || whiteNoise;
    nSrc.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1650, t);
    bp.Q.setValueAtTime(0.75, t);

    const gateEnv = ctx.createGain();
    gateEnv.gain.setValueAtTime(0.0001, t);
    gateEnv.gain.linearRampToValueAtTime(0.165 * vel, t + 0.003);
    // Nonlinear Phil-Collins / 80s mall-pop gated room plateau -> abrupt gate close!
    gateEnv.gain.linearRampToValueAtTime(0.105 * vel, t + 0.045);
    gateEnv.gain.setValueAtTime(0.092 * vel, t + 0.185);
    gateEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.235);

    nSrc.connect(bp);
    bp.connect(gateEnv);
    gateEnv.connect(dest);
    nSrc.start(t, (t * 0.91) % 2.0);
    nSrc.stop(t + 0.25);
  };

  const scheduleHat = (t, open = false, vel = 0.5) => {
    const src = ctx.createBufferSource();
    src.buffer = whiteNoise;
    src.loop = true;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(7200, t);

    const dur = open ? 0.16 : 0.045;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.055 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(hp);
    hp.connect(g);
    g.connect(dest);
    src.start(t, (t * 1.73) % 2.5);
    src.stop(t + dur + 0.01);
  };

  // Classic 80s smooth-jazz / mall-groove drum pattern over 4 beats
  scheduleKick(barStartT + 0.0 * beatSec, 0.92);
  scheduleKick(barStartT + 1.5 * beatSec, 0.68);
  scheduleKick(barStartT + 2.0 * beatSec, 0.85);
  scheduleKick(barStartT + 3.5 * beatSec, 0.62);

  scheduleGatedSnare(barStartT + 1.0 * beatSec, 0.86);
  scheduleGatedSnare(barStartT + 3.0 * beatSec, 0.90);

  for (let step = 0; step < 8; step++) {
    const ht = barStartT + step * 0.5 * beatSec;
    const isOpen = step === 7;
    const hVel = step % 2 === 0 ? 0.68 : 0.42;
    scheduleHat(ht, isOpen, hVel);
  }
}

/**
 * Step 1 (`PROMPT.md` lines 103–105):
 * Synthesizes an original ~9.2s 1980s smooth-jazz / shopping-mall piece at 151.2 BPM
 * transposed +4 semitones (`F# Major`, MIDI 66) into a stereo `AudioBuffer` via an inner
 * `OfflineAudioContext`.
 */
export async function prepareVaporwaveSourceBuffer(sampleRate = 48000) {
  const OfflineCtx = resolveAudioCtor();
  const totalSec = 9.2; // Covers 4+ full 151.2-BPM bars (16+ beats) + lush decay tail
  const innerCtx = new OfflineCtx(2, Math.ceil(totalSec * sampleRate), sampleRate);

  const rng = createSeededRng(19840818);
  const whiteNoise = makeNoiseBuffer(innerCtx, 3.0, 'white', 8081);
  const pinkNoise = makeNoiseBuffer(innerCtx, 3.0, 'pink', 8082);
  const studioIR = makeImpulseResponse(innerCtx, 1.35, 3.2, 8083);

  const master = innerCtx.createGain();
  master.gain.setValueAtTime(0.88, 0);
  master.connect(innerCtx.destination);

  // Subtle 1980s Lexicon-style studio room send inside the source recording itself
  const studioVerb = innerCtx.createConvolver();
  studioVerb.buffer = studioIR;
  const studioWet = innerCtx.createGain();
  studioWet.gain.setValueAtTime(0.22, 0);
  studioVerb.connect(studioWet);
  studioWet.connect(master);

  const mapScale = getEraScaleMapper('major', SRC_ROOT_MIDI); // F# Major (66)

  // Quick 80s drum pickup flam right before Beat 0 so entry brake (107.00s) grabs a crisp transient
  {
    const pickT = Math.max(0.015, SRC_LEAD_IN - 0.055);
    const nSrc = innerCtx.createBufferSource();
    nSrc.buffer = pinkNoise;
    const bp = innerCtx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, pickT);
    const g = innerCtx.createGain();
    g.gain.setValueAtTime(0.09, pickT);
    g.gain.exponentialRampToValueAtTime(0.0001, pickT + 0.055);
    nSrc.connect(bp);
    bp.connect(g);
    g.connect(master);
    nSrc.start(pickT);
    nSrc.stop(pickT + 0.06);
  }

  // 1. Lush 1980s DX7 FM Electric Piano Maj7 / min9 / 13sus4 Chord Voicings (4 bars = 16 beats)
  // In F# Major (sounds in D Major when slowed 0.7937x!):
  //   F#maj9 -> D#m9 | Bmaj7#11 -> C#13sus4 | F#maj9 -> G#m9 -> C#9sus4 | F#maj9
  const chordChanges = [
    { beat: 0.0, dur: 2.0, notes: [54, 58, 61, 65, 68], pan: -0.22 }, // F#maj9
    { beat: 2.0, dur: 2.0, notes: [51, 54, 58, 61, 65], pan: 0.22 },  // D#m9
    { beat: 4.0, dur: 2.0, notes: [47, 54, 58, 63, 65], pan: -0.25 }, // Bmaj7(#11) (Bar 2!)
    { beat: 6.0, dur: 2.0, notes: [49, 56, 59, 63, 66], pan: 0.25 },  // C#13sus4
    { beat: 8.0, dur: 2.0, notes: [54, 58, 61, 65, 68], pan: -0.20 }, // F#maj9
    { beat: 10.0, dur: 1.0, notes: [56, 59, 63, 66, 70], pan: 0.18 }, // G#m9
    { beat: 11.0, dur: 1.0, notes: [49, 59, 63, 66, 70], pan: -0.18 },// C#13sus4
    { beat: 12.0, dur: 4.0, notes: [54, 58, 61, 65, 68], pan: 0.0 },  // Extra safety bar F#maj9
  ];

  const epBus = innerCtx.createGain();
  epBus.gain.setValueAtTime(0.95, 0);
  epBus.connect(master);
  epBus.connect(studioVerb);

  for (const ch of chordChanges) {
    const tChord = SRC_LEAD_IN + ch.beat * SRC_BEAT_SEC;
    const durSec = ch.dur * SRC_BEAT_SEC;
    ch.notes.forEach((midi, idx) => {
      // Gentle rolled smooth-jazz keyboard arpeggiation (14ms per voice)
      const rollOff = idx * 0.014;
      const voicePan = ch.pan + (idx - 2) * 0.08;
      scheduleDx7EPianoNote(innerCtx, epBus, midi, tChord + rollOff, durSec - rollOff, 0.72, voicePan);
    });
    // Tasteful syncopated upper-tine comping stab on the "& of 2" (beat + 1.5)
    if (ch.dur >= 2.0) {
      const compT = tChord + 1.5 * SRC_BEAT_SEC;
      ch.notes.slice(2).forEach((midi, idx) => {
        scheduleDx7EPianoNote(innerCtx, epBus, midi + 12, compT + idx * 0.008, 0.42 * SRC_BEAT_SEC, 0.44, -ch.pan);
      });
    }
  }

  // 2. Warm Fretless Bass with Expressive Pitch Slides
  const bassLine = [
    { beat: 0.0, dur: 1.45, midi: 42, slideFrom: 37 }, // F#2 (slide up from C#2)
    { beat: 1.5, dur: 0.48, midi: 49, slideFrom: null }, // C#3
    { beat: 2.0, dur: 1.45, midi: 39, slideFrom: 42 }, // D#2 (slide down)
    { beat: 3.5, dur: 0.48, midi: 46, slideFrom: null }, // A#2
    { beat: 4.0, dur: 1.45, midi: 35, slideFrom: 39 }, // B1/B2 -> 47? Let's use 47 (B2) for rich audible warmth!
    { beat: 5.5, dur: 0.48, midi: 42, slideFrom: null },
    { beat: 6.0, dur: 1.45, midi: 37, slideFrom: 35 }, // C#2
    { beat: 7.5, dur: 0.48, midi: 44, slideFrom: 42 }, // G#2
    { beat: 8.0, dur: 1.45, midi: 42, slideFrom: 37 }, // F#2
    { beat: 9.5, dur: 0.48, midi: 49, slideFrom: null },
    { beat: 10.0, dur: 0.95, midi: 44, slideFrom: 42 }, // G#2
    { beat: 11.0, dur: 0.95, midi: 37, slideFrom: 44 }, // C#2 turnaround
    { beat: 12.0, dur: 3.8, midi: 42, slideFrom: 37 },  // F#2 safety sustain
  ];
  // Keep bass in punchy 40..54 MIDI range so it stays warm & clear even after -4st slowdown
  for (const b of bassLine) {
    const midi = b.midi < 38 ? b.midi + 12 : b.midi;
    const slide = b.slideFrom !== null && b.slideFrom < 38 ? b.slideFrom + 12 : b.slideFrom;
    scheduleFretlessBassNote(
      innerCtx,
      master,
      midi,
      SRC_LEAD_IN + b.beat * SRC_BEAT_SEC,
      b.dur * SRC_BEAT_SEC,
      0.86,
      slide
    );
  }

  // 3. Breathy FM Alto Saxophone playing a Smooth-Jazz Variation of `MAIN_MELODY_MOTIF`
  const saxBus = innerCtx.createGain();
  saxBus.gain.setValueAtTime(0.96, 0);
  saxBus.connect(master);
  saxBus.connect(studioVerb);

  const motif = Array.isArray(MAIN_MELODY_MOTIF) && MAIN_MELODY_MOTIF.length > 0
    ? MAIN_MELODY_MOTIF
    : [
        { beat: 0.0, dur: 0.75, deg: 0, oct: 0, vel: 0.9 },
        { beat: 0.75, dur: 0.25, deg: 1, oct: 0, vel: 0.75 },
        { beat: 1.0, dur: 0.5, deg: 2, oct: 0, vel: 0.85 },
        { beat: 1.5, dur: 0.5, deg: 4, oct: 0, vel: 0.88 },
        { beat: 2.0, dur: 1.0, deg: 5, oct: 0, vel: 0.92 },
        { beat: 3.0, dur: 1.0, deg: 4, oct: 0, vel: 0.85 },
        { beat: 4.0, dur: 0.75, deg: 5, oct: 0, vel: 0.94 },
        { beat: 4.75, dur: 0.25, deg: 6, oct: 0, vel: 0.82 },
        { beat: 5.0, dur: 1.0, deg: 4, oct: 0, vel: 0.9 },
        { beat: 6.0, dur: 0.5, deg: 2, oct: 0, vel: 0.84 },
        { beat: 6.5, dur: 0.5, deg: 1, oct: 0, vel: 0.8 },
        { beat: 7.0, dur: 1.0, deg: 2, oct: 0, vel: 0.86 },
        { beat: 8.0, dur: 0.75, deg: 4, oct: 0, vel: 0.9 },
        { beat: 8.75, dur: 0.25, deg: 2, oct: 0, vel: 0.78 },
        { beat: 9.0, dur: 1.0, deg: 1, oct: 0, vel: 0.84 },
        { beat: 10.0, dur: 1.5, deg: 0, oct: 0, vel: 0.95 },
      ];

  motif.forEach((ev, idx) => {
    // Jazz lay-back micro-timing (+18ms behind the beat on offbeats, crisp on Bar-2 Beat 4 stutter target!)
    const isStutterDownbeat = Math.abs(ev.beat - 4.0) < 0.08;
    const layback = isStutterDownbeat ? 0 : (idx % 2 === 1 ? 0.022 : 0.008) + (rng() - 0.5) * 0.006;
    const noteT = SRC_LEAD_IN + ev.beat * SRC_BEAT_SEC + layback;
    const noteDur = Math.max(0.12, ev.dur * SRC_BEAT_SEC * 0.94);
    const midi = mapScale(ev.deg, (ev.oct ?? 0) + 1); // Alto sax sparkling register
    const scoop = (ev.accent || ev.dur >= 0.75 || isStutterDownbeat) ? -1.5 : 0;
    scheduleFmAltoSaxNote(innerCtx, saxBus, whiteNoise, midi, noteT, noteDur, ev.vel ?? 0.86, scoop);
  });

  // Smooth-jazz sax tail lick across Bar 4 (beats 12..15) so exit acceleration never runs dry
  scheduleFmAltoSaxNote(
    innerCtx,
    saxBus,
    whiteNoise,
    mapScale(4, 1),
    SRC_LEAD_IN + 12.0 * SRC_BEAT_SEC,
    2.4 * SRC_BEAT_SEC,
    0.78,
    -1
  );

  // 4. 80s Gated-Reverb Drum Machine across 4 bars (16 beats)
  const drumBus = innerCtx.createGain();
  drumBus.gain.setValueAtTime(0.84, 0);
  drumBus.connect(master);
  for (let bar = 0; bar < 4; bar++) {
    schedule80sGatedDrums(
      innerCtx,
      drumBus,
      whiteNoise,
      pinkNoise,
      SRC_LEAD_IN + bar * 4 * SRC_BEAT_SEC,
      SRC_BEAT_SEC
    );
  }

  return innerCtx.startRendering();
}

/**
 * Schedules a subtle magnetic tape-head splice click + micro-dropout transient
 * at each Bar-2 `跳针` loop seam (`109.00, 109.25, 109.50, 109.75, 110.00s`).
 */
function scheduleTapeSpliceClick(ctx, dest, whiteNoise, t, strength = 1.0) {
  if (!whiteNoise) return;
  const src = ctx.createBufferSource();
  src.buffer = whiteNoise;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2100, t);
  bp.Q.setValueAtTime(2.2, t);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.055 * strength, t + 0.0012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.011);

  src.connect(bp);
  bp.connect(g);
  g.connect(dest);
  src.start(t, (t * 0.77) % 2.0);
  src.stop(t + 0.014);
}

/**
 * Steps 2–4 (`PROMPT.md` lines 106–110):
 * Schedules Era #18 Vaporwave (`107.0..113.0s`) onto the master `OfflineAudioContext`
 * by manipulating `vaporSourceBuffer` as a physical 1980s cassette tape!
 */
export function scheduleVaporwaveEra(ctx, musicBus, vaporSourceBuffer, sharedAssets = {}) {
  if (!vaporSourceBuffer) return;

  const t0 = 107.0;
  const t1 = 113.0;

  // Era output bus targeting ~0.34 linear peak with click-free 15ms/30ms boundary crossfades
  const eraBus = ctx.createGain();
  eraBus.gain.setValueAtTime(0.0001, t0 - 0.005);
  eraBus.gain.linearRampToValueAtTime(0.92, t0 + 0.015);
  eraBus.gain.setValueAtTime(0.92, t1 - 0.02);
  eraBus.gain.linearRampToValueAtTime(0.0001, t1 + 0.032);
  eraBus.connect(musicBus);

  // Tape Deck Signal Chain:
  //   [Tape Source Nodes] -> [3900Hz 12dB Lowpass (Cassette Muffler)] -> Dry (44%) + 3.85s Mall Reverb (56% Wet!) -> eraBus
  const tapeInput = ctx.createGain();
  tapeInput.gain.setValueAtTime(1.0, t0);

  const cassetteLowpass = ctx.createBiquadFilter();
  cassetteLowpass.type = 'lowpass';
  cassetteLowpass.frequency.setValueAtTime(4800, t0);
  // As tape brakes down into #18, high frequencies warm/muffle to ~3850 Hz, then brighten on exit speedup!
  cassetteLowpass.frequency.exponentialRampToValueAtTime(3850, t0 + 0.42);
  cassetteLowpass.frequency.setValueAtTime(3850, 112.72);
  cassetteLowpass.frequency.exponentialRampToValueAtTime(5200, t1);
  cassetteLowpass.Q.setValueAtTime(0.82, t0);

  // Warm subtle cassette saturation shelf around 220 Hz
  const tapeWarmth = ctx.createBiquadFilter();
  tapeWarmth.type = 'lowshelf';
  tapeWarmth.frequency.setValueAtTime(240, t0);
  tapeWarmth.gain.setValueAtTime(2.6, t0);

  tapeInput.connect(tapeWarmth);
  tapeWarmth.connect(cassetteLowpass);

  const dryGain = ctx.createGain();
  dryGain.gain.setValueAtTime(0.44, t0);

  const wetGain = ctx.createGain();
  wetGain.gain.setValueAtTime(0.58, t0); // High wet ratio mall-atrium wash!

  const mallConvolver = ctx.createConvolver();
  mallConvolver.buffer =
    sharedAssets.cathedralReverbIR || makeImpulseResponse(ctx, 3.85, 2.35, 1818);

  cassetteLowpass.connect(dryGain);
  dryGain.connect(eraBus);

  cassetteLowpass.connect(mallConvolver);
  mallConvolver.connect(wetGain);
  wetGain.connect(eraBus);

  // Continuous 0.5 Hz Tape Wow LFO (±15 cents) + 3.2 Hz Capstan Flutter (±2.5 cents) modulating `detune`
  const wowLfo = ctx.createOscillator();
  wowLfo.type = 'sine';
  wowLfo.frequency.setValueAtTime(0.5, t0);
  const wowDepth = ctx.createGain();
  wowDepth.gain.setValueAtTime(15.5, t0); // ±15.5 cents slow cassette wow!
  wowLfo.connect(wowDepth);

  const flutterLfo = ctx.createOscillator();
  flutterLfo.type = 'sine';
  flutterLfo.frequency.setValueAtTime(3.2, t0);
  const flutterDepth = ctx.createGain();
  flutterDepth.gain.setValueAtTime(2.6, t0);
  flutterLfo.connect(flutterDepth);

  wowLfo.start(t0);
  flutterLfo.start(t0);
  wowLfo.stop(t1 + 0.1);
  flutterLfo.stop(t1 + 0.1);

  const attachTapeWow = (bufSrc) => {
    wowDepth.connect(bufSrc.detune);
    flutterDepth.connect(bufSrc.detune);
  };

  // Gentle Continuous Magnetic Cassette Tape Hiss (`PROMPT.md` line 108: 叠一层很轻的磁带底噪)
  const hissNoise = sharedAssets.pinkNoise || sharedAssets.whiteNoise;
  if (hissNoise) {
    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = hissNoise;
    hissSrc.loop = true;

    const hissHp = ctx.createBiquadFilter();
    hissHp.type = 'highpass';
    hissHp.frequency.setValueAtTime(1400, t0);

    const hissLp = ctx.createBiquadFilter();
    hissLp.type = 'lowpass';
    hissLp.frequency.setValueAtTime(4300, t0);

    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0.0001, t0);
    hissGain.gain.linearRampToValueAtTime(0.011, t0 + 0.08);
    // Slightly heightened VHS tracking hiss during Bar-2 stutter [109.0..110.2s]
    hissGain.gain.setValueAtTime(0.011, 108.98);
    hissGain.gain.linearRampToValueAtTime(0.019, 109.04);
    hissGain.gain.setValueAtTime(0.017, 110.00);
    hissGain.gain.linearRampToValueAtTime(0.011, 110.35);
    hissGain.gain.setValueAtTime(0.011, t1 - 0.04);
    hissGain.gain.linearRampToValueAtTime(0.0001, t1 + 0.02);

    hissSrc.connect(hissHp);
    hissHp.connect(hissLp);
    hissLp.connect(hissGain);
    hissGain.connect(eraBus);
    hissSrc.start(t0, 0.35);
    hissSrc.stop(t1 + 0.04);
  }

  // =========================================================================
  // Segment 1 (`107.00s -> 109.00s`): Entry Tape-Brake (`1.00 -> 0.7937`) + Bar 1 Groove!
  // Integral compensation: linear ramp 1.00 -> R over 0.42s consumes an extra
  // `0.5 * (1.0 - R) * 0.42 = 0.043323s` of source buffer, so starting `0.043323s`
  // before `SRC_LEAD_IN` locks Beat 1 (`107.50s`)..Beat 4 (`109.00s`) 100% onto 120 BPM!
  // =========================================================================
  const brakeDur = 0.42;
  const brakeExtraSrc = 0.5 * (1.0 - VAPOR_TAPE_RATE) * brakeDur; // 0.0433229s
  const seg1Offset = Math.max(0, SRC_LEAD_IN - brakeExtraSrc);

  const seg1 = ctx.createBufferSource();
  seg1.buffer = vaporSourceBuffer;
  seg1.playbackRate.setValueAtTime(1.0, 107.0);
  seg1.playbackRate.linearRampToValueAtTime(VAPOR_TAPE_RATE, 107.0 + brakeDur);
  attachTapeWow(seg1);

  const seg1Env = ctx.createGain();
  seg1Env.gain.setValueAtTime(1.0, 107.0);
  seg1Env.gain.setValueAtTime(1.0, 108.994);
  seg1Env.gain.linearRampToValueAtTime(0.0001, 109.004);
  seg1.connect(seg1Env);
  seg1Env.connect(tapeInput);
  seg1.start(107.0, seg1Offset);
  seg1.stop(109.01);

  // =========================================================================
  // Segment 2 (`109.00s -> 110.00s`): Bar-2 Tape-Loop Stutter Gag (`跳针` — 4 x 0.25s half-beat!)
  // Slices the lush Bar-2 Beat-1 FM Sax + Bmaj7#11 DX7 chord (`SRC_LEAD_IN + 4 * SRC_BEAT_SEC`)
  // and repeats it 4 times (`4 * 0.25s = 1.00s`) synced to `s18_vaporwave.js`'s 0.25s glitch!
  // =========================================================================
  const stutterSrcOffset = SRC_LEAD_IN + 4.0 * SRC_BEAT_SEC;
  const sliceFilmDur = 0.25; // Half-beat at 120 BPM (= 0.198425s of 151.2 BPM source buffer)

  for (let rep = 0; rep < 4; rep++) {
    const sliceStart = 109.0 + rep * sliceFilmDur;
    const sliceEnd = sliceStart + sliceFilmDur;

    const stutSrc = ctx.createBufferSource();
    stutSrc.buffer = vaporSourceBuffer;
    // Slight capstan tension dip on the final 4th repeat before snapping free!
    const repRate = rep === 3 ? VAPOR_TAPE_RATE * 0.985 : VAPOR_TAPE_RATE;
    stutSrc.playbackRate.setValueAtTime(repRate, sliceStart);
    attachTapeWow(stutSrc);

    const stutEnv = ctx.createGain();
    stutEnv.gain.setValueAtTime(0.0001, sliceStart - 0.003);
    stutEnv.gain.linearRampToValueAtTime(1.04, sliceStart + 0.004);
    stutEnv.gain.setValueAtTime(1.0, sliceEnd - 0.006);
    stutEnv.gain.linearRampToValueAtTime(0.0001, sliceEnd + 0.003);

    stutSrc.connect(stutEnv);
    stutEnv.connect(tapeInput);
    stutSrc.start(sliceStart - 0.003, Math.max(0, stutterSrcOffset - 0.002));
    stutSrc.stop(sliceEnd + 0.006);

    scheduleTapeSpliceClick(
      ctx,
      eraBus,
      sharedAssets.whiteNoise,
      sliceStart,
      rep === 0 ? 1.15 : 0.9
    );
  }
  // Final splice release tick right as normal tape resumes at 110.00s
  scheduleTapeSpliceClick(ctx, eraBus, sharedAssets.whiteNoise, 110.0, 1.1);

  // =========================================================================
  // Segment 3 (`110.00s -> 113.00s`): Resume 0.7937x Playback + Strong-Beat Exit Speed-Up!
  // Resumes right on Beat 6 (`SRC_LEAD_IN + 6 * SRC_BEAT_SEC`) so Bar 2's second half
  // and all of Bar 3 (`111.0..113.0s`) resolve on-grid, accelerating `0.7937 -> 1.00`
  // across `112.72..113.00s` into Era #19!
  // =========================================================================
  const seg3 = ctx.createBufferSource();
  seg3.buffer = vaporSourceBuffer;
  seg3.playbackRate.setValueAtTime(VAPOR_TAPE_RATE * 0.97, 110.0);
  // Quick 45ms capstan recovery lock into steady 0.7937005x
  seg3.playbackRate.linearRampToValueAtTime(VAPOR_TAPE_RATE, 110.045);
  seg3.playbackRate.setValueAtTime(VAPOR_TAPE_RATE, 112.72);
  // Exit Tape Acceleration back to 1.00x right onto the 113.00s strong-beat frame crossing!
  seg3.playbackRate.linearRampToValueAtTime(1.0, 113.0);
  attachTapeWow(seg3);

  const seg3Env = ctx.createGain();
  seg3Env.gain.setValueAtTime(0.0001, 109.997);
  seg3Env.gain.linearRampToValueAtTime(1.0, 110.005);
  seg3Env.gain.setValueAtTime(1.0, 112.98);
  seg3Env.gain.linearRampToValueAtTime(0.0001, 113.03);

  seg3.connect(seg3Env);
  seg3Env.connect(tapeInput);
  seg3.start(109.997, SRC_LEAD_IN + 6.0 * SRC_BEAT_SEC);
  seg3.stop(113.04);
}
