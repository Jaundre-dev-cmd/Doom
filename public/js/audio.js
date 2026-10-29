// Procedural, positional game audio built on the Web Audio API — every
// sound is synthesised (filtered noise bursts + oscillators), so there are
// no audio files to source or license. Sounds in the world are spatialised
// with PannerNodes relative to the camera, and distant gunfire gets duller
// (low-passed) and quieter the way it does in reality.

let ctx = null;
let master = null;
let noise = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 6;
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(comp).connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

export function setMasterVolume(v) {
  if (master) master.gain.value = v;
}

const listenerPos = { x: 0, y: 0, z: 0 };

export function setListener(pos, forward) {
  if (!ctx) return;
  listenerPos.x = pos.x;
  listenerPos.y = pos.y;
  listenerPos.z = pos.z;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setValueAtTime(pos.x, t);
    l.positionY.setValueAtTime(pos.y, t);
    l.positionZ.setValueAtTime(pos.z, t);
    l.forwardX.setValueAtTime(forward.x, t);
    l.forwardY.setValueAtTime(forward.y, t);
    l.forwardZ.setValueAtTime(forward.z, t);
    l.upX.setValueAtTime(0, t);
    l.upY.setValueAtTime(1, t);
    l.upZ.setValueAtTime(0, t);
  } else {
    l.setPosition(pos.x, pos.y, pos.z);
    l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
  }
}

function distanceTo(pos) {
  if (!pos) return 0;
  return Math.hypot(pos.x - listenerPos.x, pos.y - listenerPos.y, pos.z - listenerPos.z);
}

// Output chain for a sound: optional panner + distance low-pass.
function output(pos, refDistance = 6) {
  if (!pos) return master;
  const panner = ctx.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = refDistance;
  panner.rolloffFactor = 1.1;
  panner.maxDistance = 400;
  if (panner.positionX) {
    panner.positionX.value = pos.x;
    panner.positionY.value = pos.y;
    panner.positionZ.value = pos.z;
  } else {
    panner.setPosition(pos.x, pos.y, pos.z);
  }
  const air = ctx.createBiquadFilter();
  air.type = 'lowpass';
  air.frequency.value = Math.max(700, 18000 / (1 + distanceTo(pos) / 25));
  air.connect(panner).connect(master);
  return air;
}

function noiseBurst(dest, { start = 0, dur = 0.2, gain = 1, type = 'lowpass', freq = 2000, q = 0.7, attack = 0.002, curve = 3 }) {
  const t = ctx.currentTime + start;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.3);
}

function thump(dest, { start = 0, from = 140, to = 40, dur = 0.18, gain = 0.8, type = 'sine' }) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

const GUN_SOUNDS = {
  pistol: { crack: 3200, body: 0.7, boom: [180, 50], tail: 0.35, gain: 0.8 },
  shotgun: { crack: 1800, body: 1, boom: [120, 35], tail: 0.6, gain: 1 },
  chaingun: { crack: 2600, body: 0.6, boom: [150, 45], tail: 0.25, gain: 0.6 },
  rocket: { crack: 900, body: 1, boom: [90, 30], tail: 0.7, gain: 0.9 },
  ak47: { crack: 2400, body: 0.9, boom: [140, 40], tail: 0.45, gain: 0.85 },
  m4a1: { crack: 5200, body: 0.35, boom: [220, 90], tail: 0.18, gain: 0.45, suppressed: true },
  mp5: { crack: 4800, body: 0.3, boom: [240, 100], tail: 0.15, gain: 0.4, suppressed: true },
  awp: { crack: 2000, body: 1, boom: [100, 28], tail: 1.1, gain: 1.1 },
};

export function playGunshot(weapon, pos = null) {
  if (!ctx) return;
  const s = GUN_SOUNDS[weapon] || GUN_SOUNDS.ak47;
  const out = output(pos, 8);
  const v = pos ? 1 : 0.85;
  noiseBurst(out, { dur: 0.06, gain: s.gain * v, type: 'highpass', freq: s.crack, q: 0.5 });
  noiseBurst(out, { dur: 0.16 * s.body + 0.05, gain: s.gain * 0.8 * v, type: 'lowpass', freq: s.suppressed ? 1400 : 2600, q: 0.8 });
  thump(out, { from: s.boom[0], to: s.boom[1], dur: 0.12 + s.body * 0.1, gain: s.gain * 0.9 * v });
  // Echo off the surroundings — louder and longer for big calibres.
  if (!s.suppressed) noiseBurst(out, { start: 0.05, dur: s.tail, gain: s.gain * 0.18 * v, type: 'bandpass', freq: 600, q: 0.6, attack: 0.03, curve: 2 });
}

export function playExplosion(pos) {
  if (!ctx) return;
  const out = output(pos, 12);
  noiseBurst(out, { dur: 0.25, gain: 1.4, type: 'lowpass', freq: 4000 });
  noiseBurst(out, { dur: 1.6, gain: 1.1, type: 'lowpass', freq: 700, attack: 0.01, curve: 2.5 });
  thump(out, { from: 90, to: 22, dur: 0.9, gain: 1.4 });
  noiseBurst(out, { start: 0.25, dur: 1.2, gain: 0.25, type: 'bandpass', freq: 3000, q: 0.4, attack: 0.05, curve: 2 }); // debris
}

export function playFootstep(pos, loudness = 1, surface = 'grass') {
  if (!ctx) return;
  const out = output(pos, 3);
  const freq = surface === 'metal' ? 2600 : surface === 'hard' ? 1600 : 900;
  noiseBurst(out, { dur: 0.09, gain: 0.25 * loudness, type: 'bandpass', freq: freq * (0.85 + Math.random() * 0.3), q: 1.2 });
  thump(out, { from: 90, to: 50, dur: 0.06, gain: 0.15 * loudness });
}

export function playLanding(intensity) {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.15, gain: 0.3 * intensity, type: 'lowpass', freq: 700 });
  thump(master, { from: 110, to: 40, dur: 0.12, gain: 0.35 * intensity });
}

export function playHitmarker(kind = 'body') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  osc.frequency.value = kind === 'head' ? 2400 : kind === 'kill' ? 1300 : 1800;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'kill' ? 0.18 : 0.06));
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + 0.2);
  if (kind === 'head') noiseBurst(master, { dur: 0.05, gain: 0.25, type: 'highpass', freq: 5000 });
}

export function playHurt() {
  if (!ctx) return;
  thump(master, { from: 70, to: 35, dur: 0.18, gain: 0.5 });
  noiseBurst(master, { dur: 0.12, gain: 0.2, type: 'lowpass', freq: 500 });
}

// Magazine out / in / bolt — spread across the reload time.
export function playReload(durationMs) {
  if (!ctx) return;
  const d = durationMs / 1000;
  const click = (start, freq, gain) => noiseBurst(master, { start, dur: 0.05, gain, type: 'bandpass', freq, q: 3 });
  click(0.1, 1800, 0.35);
  click(d * 0.35, 1200, 0.3);
  click(d * 0.7, 2200, 0.4);
  click(d * 0.88, 3000, 0.45);
  click(d * 0.92, 1600, 0.4);
}

export function playDryFire() {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.04, gain: 0.3, type: 'bandpass', freq: 3500, q: 4 });
}

export function playPinPull() {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.05, gain: 0.3, type: 'bandpass', freq: 4200, q: 6 });
  noiseBurst(master, { start: 0.12, dur: 0.06, gain: 0.25, type: 'bandpass', freq: 2800, q: 5 });
}

export function playBounce(pos, strength = 1) {
  if (!ctx) return;
  const out = output(pos, 3);
  noiseBurst(out, { dur: 0.07, gain: 0.35 * strength, type: 'bandpass', freq: 2200, q: 4 });
}

export function playSwitch() {
  if (!ctx) return;
  noiseBurst(master, { dur: 0.05, gain: 0.2, type: 'bandpass', freq: 1400, q: 2 });
  noiseBurst(master, { start: 0.15, dur: 0.05, gain: 0.25, type: 'bandpass', freq: 2400, q: 3 });
}

// Brass casing hitting the ground.
export function playShellTink(pos, strength = 1) {
  if (!ctx) return;
  const out = output(pos, 2);
  const t = ctx.currentTime;
  for (const f of [4200, 6100]) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f * (0.95 + Math.random() * 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.15);
  }
}

// Jet roar building up, screaming overhead, and fading away.
export function playJetFlyby(peakInSec, gain = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const end = t + peakInSec + 2.5;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(4200, t + peakInSec);
  f.frequency.exponentialRampToValueAtTime(250, end);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9 * gain, t + peakInSec);
  g.gain.exponentialRampToValueAtTime(0.0001, end);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(end + 0.1);
  // Turbine whine with a doppler drop as it passes.
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(900, t);
  osc.frequency.linearRampToValueAtTime(1100, t + peakInSec);
  osc.frequency.linearRampToValueAtTime(520, t + peakInSec + 0.6);
  const og = ctx.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(0.05 * gain, t + peakInSec);
  og.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(og).connect(master);
  osc.start(t);
  osc.stop(end + 0.1);
}

// Short radio/tablet chirps.
export function playRadio(kind = 'confirm') {
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = kind === 'confirm' ? [880, 1320] : kind === 'uav' ? [660, 990, 1320] : kind === 'enemy' ? [520, 390] : [1200];
  notes.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.07, t + i * 0.09 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.08);
    osc.connect(g).connect(master);
    osc.start(t + i * 0.09);
    osc.stop(t + i * 0.09 + 0.1);
  });
  noiseBurst(master, { dur: 0.08, gain: 0.08, type: 'bandpass', freq: 2500, q: 1 });
}

// ---------------------------------------------------------------------------
// Horror / zombie-survival audio. Same building blocks as above, plus a few
// helpers for sustained voiced sounds (moans, screams, drones and chords).

const rand = (a, b) => a + Math.random() * (b - a);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Disconnect nodes that don't free themselves (feedback loops, shared filters).
function cleanupAfter(sec, nodes) {
  setTimeout(() => nodes.forEach((n) => { try { n.disconnect(); } catch { /* already gone */ } }), sec * 1000 + 200);
}

// Looping noise source — noiseBurst's one-shot buffer is too short for long beds.
// dur = 0 leaves it running until the caller stops it.
function noiseLoop(t, dur) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  src.start(t, Math.random() * 1.5);
  if (dur) src.stop(t + dur + 0.05);
  return src;
}

// Sustained filtered noise: swell in, decay out, optional filter sweep.
function noiseSwell(dest, { start = 0, dur = 1, gain = 0.3, type = 'lowpass', freq = 800, to = 0, q = 0.7, attack = 0.1 }) {
  const t = ctx.currentTime + start;
  const src = noiseLoop(t, dur);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(dest);
  src.onended = () => g.disconnect();
}

// Held oscillator note with attack / hold / release. Returns the oscillator so
// callers can schedule extra pitch movement on it.
function tone(dest, { start = 0, freq = 220, to = 0, dur = 1, gain = 0.1, type = 'sine', attack = 0.02, release = 0.3, detune = 0 }) {
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  osc.onended = () => g.disconnect();
  return osc;
}

// Low-frequency modulator added onto an AudioParam. dur = 0 runs until stopped.
function lfo(param, { start = 0, dur = 0, rate = 5, depth = 10, type = 'sine' }) {
  const t = ctx.currentTime + start;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(rate, t);
  const g = ctx.createGain();
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start(t);
  if (dur) o.stop(t + dur + 0.05);
  o.addEventListener('ended', () => g.disconnect());
  return o;
}

// Feedback delay — a cheap stand-in for reverb bouncing off the tree line.
function echo(dest, { time = 0.3, feedback = 0.4, lp = 2000, life = 4 }) {
  const input = ctx.createGain();
  const d = ctx.createDelay(1.5);
  d.delayTime.value = time;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lp;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  input.connect(dest);
  input.connect(d).connect(f).connect(fb).connect(d);
  f.connect(dest);
  cleanupAfter(life, [input, d, f, fb]);
  return input;
}

// A throat: rough saw/square "vocal folds" + breath noise lurching around an
// irregular pitch contour, shaped by two formant bandpasses plus a chesty
// low-pass, then amplitude-fluttered for the wet gurgle.
function voice(dest, { start = 0, dur = 1.5, pitch = 80, jitter = 0.2, slide = 1, rasp = 0.4, gain = 0.4,
  formants = [500, 1000], q = 5, gurgle = 10, gurgleDepth = 0.5, vibrato = 0, attack = 0.2 }) {
  const t = ctx.currentTime + start;
  const end = t + dur;
  const pts = [];
  for (let tt = t; tt < end; tt += rand(0.07, 0.28)) {
    pts.push([tt, pitch * (1 + (slide - 1) * ((tt - t) / dur)) * rand(1 - jitter, 1 + jitter)]);
  }
  const folds = ctx.createGain();
  const oscs = [];
  for (const [type, mul, lvl] of [['sawtooth', 1, 0.5], ['square', 1.012, 0.15], ['sawtooth', 0.502, 0.35]]) {
    const o = ctx.createOscillator();
    o.type = type;
    pts.forEach(([tt, f], i) => (i ? o.frequency.linearRampToValueAtTime(f * mul, tt) : o.frequency.setValueAtTime(f * mul, tt)));
    const g = ctx.createGain();
    g.gain.value = lvl;
    o.connect(g).connect(folds);
    if (vibrato) lfo(o.frequency, { start, dur, rate: vibrato, depth: pitch * mul * 0.03 });
    o.start(t);
    o.stop(end + 0.05);
    oscs.push(o);
  }
  const breath = noiseLoop(t, dur);
  const bg = ctx.createGain();
  bg.gain.value = rasp;
  breath.connect(bg).connect(folds);

  const mouth = ctx.createGain();
  mouth.gain.value = 1.6; // make-up for the narrow formant filters
  formants.forEach((fq, i) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    // Jaw opens then sags — formants drift up then down.
    f.frequency.setValueAtTime(fq * 0.7, t);
    f.frequency.linearRampToValueAtTime(fq * rand(1, 1.2), t + dur * 0.35);
    f.frequency.linearRampToValueAtTime(fq * 0.8, end);
    const fg = ctx.createGain();
    fg.gain.value = i ? 0.6 : 1;
    folds.connect(f).connect(fg).connect(mouth);
  });
  const chest = ctx.createBiquadFilter();
  chest.type = 'lowpass';
  chest.frequency.value = 280;
  const cg = ctx.createGain();
  cg.gain.value = 0.35;
  folds.connect(chest).connect(cg).connect(mouth);

  // Gurgle: irregular amplitude flutter, rate wandering like fluid in the throat.
  const wet = ctx.createGain();
  wet.gain.value = 1 - gurgleDepth / 2;
  if (gurgleDepth > 0) {
    const gl = lfo(wet.gain, { start, dur, rate: gurgle, depth: gurgleDepth / 2, type: 'triangle' });
    for (let tt = t + 0.1; tt < end; tt += rand(0.1, 0.3)) gl.frequency.linearRampToValueAtTime(gurgle * rand(0.5, 1.6), tt);
  }
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain, t + attack);
  env.gain.setTargetAtTime(gain * 0.6, t + attack, dur * 0.4);
  env.gain.setTargetAtTime(0.0001, end - dur * 0.25, dur * 0.08);
  mouth.connect(wet).connect(env).connect(dest);
  oscs[0].onended = () => { env.disconnect(); folds.disconnect(); };
}

// Groan / moan. Walkers are deep and wet; runners are higher, raspier snarls.
export function playZombieGroan(pos, kind = 'walker', intensity = 1) {
  if (!ctx) return;
  const out = output(pos, 4);
  const runner = kind === 'runner';
  const dur = runner ? rand(0.8, 1.4) : rand(1.1, 2.2);
  voice(out, {
    dur,
    pitch: runner ? rand(95, 140) : rand(55, 95),
    jitter: runner ? 0.25 : 0.18,
    slide: rand(0.75, 1.1),
    rasp: runner ? 1 : rand(0.25, 0.5),
    gain: 0.45 * intensity,
    formants: runner ? [rand(600, 800), rand(1300, 1700)] : [rand(380, 520), rand(800, 1050)],
    q: runner ? 3 : 5,
    gurgle: runner ? rand(18, 28) : rand(7, 14),
    gurgleDepth: runner ? 0.4 : 0.6,
    attack: runner ? 0.08 : rand(0.15, 0.3),
  });
  if (runner) noiseSwell(out, { dur: dur * 0.8, gain: 0.15 * intensity, type: 'highpass', freq: 3200, q: 0.6, attack: 0.08 }); // hiss
  else if (Math.random() < 0.5) noiseBurst(out, { start: dur * rand(0.3, 0.8), dur: 0.08, gain: 0.15 * intensity, type: 'bandpass', freq: 350, q: 5 }); // wet swallow
}

export function playZombieAttack(pos) {
  if (!ctx) return;
  const out = output(pos, 4);
  voice(out, { dur: rand(0.4, 0.6), pitch: rand(110, 150), jitter: 0.25, slide: 1.3, rasp: 1.2, gain: 0.6, formants: [700, 1500], q: 3, gurgle: 30, gurgleDepth: 0.4, attack: 0.03 });
  noiseSwell(out, { start: 0.08, dur: 0.35, gain: 0.35, type: 'bandpass', freq: 300, to: 2400, q: 1.5, attack: 0.18 }); // lunge whoosh
  noiseBurst(out, { start: 0.42, dur: 0.05, gain: 0.3, type: 'bandpass', freq: 1800, q: 3 }); // jaw snap
}

// Bullet into rotten flesh: smack, squelch, spatter.
export function playZombieHit(pos) {
  if (!ctx) return;
  const out = output(pos, 4);
  thump(out, { from: rand(140, 180), to: 55, dur: 0.08, gain: 0.5 });
  noiseBurst(out, { dur: 0.07, gain: 0.45, type: 'lowpass', freq: 1200, q: 1 });
  noiseBurst(out, { start: 0.02, dur: 0.12, gain: 0.3, type: 'bandpass', freq: rand(450, 700), q: 4 });
  noiseBurst(out, { start: rand(0.08, 0.14), dur: 0.06, gain: 0.12, type: 'bandpass', freq: rand(1500, 2200), q: 6 });
}

// Choking, sinking gurgle, then the body hitting the ground.
export function playZombieDeath(pos) {
  if (!ctx) return;
  const out = output(pos, 5);
  const dur = rand(0.9, 1.4);
  voice(out, { dur, pitch: rand(70, 100), jitter: 0.3, slide: 0.55, rasp: 0.8, gain: 0.5, formants: [rand(400, 550), 950], gurgle: rand(18, 26), gurgleDepth: 0.9, attack: 0.05 });
  const fall = dur + rand(0.05, 0.25);
  thump(out, { start: fall, from: 95, to: 32, dur: 0.3, gain: 0.8 });
  noiseBurst(out, { start: fall, dur: 0.25, gain: 0.35, type: 'lowpass', freq: 450 });
  noiseBurst(out, { start: fall + rand(0.15, 0.3), dur: 0.1, gain: 0.15, type: 'lowpass', freq: 700 }); // limb flop
}

// A scream through the woods — distant ones are muffled and echo off the trees.
export function playScream(pos, distant = true) {
  if (!ctx) return;
  const dur = rand(1.2, 2);
  const out = output(pos, distant ? 40 : 10);
  const wet = echo(out, { time: rand(0.28, 0.45), feedback: distant ? 0.5 : 0.3, lp: 900, life: dur + 5 });
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = distant ? 1100 : 5000;
  lp.connect(wet);
  cleanupAfter(dur + 0.5, [lp]);
  voice(lp, { dur, pitch: rand(480, 700), jitter: 0.04, slide: 0.7, rasp: 0.5, gain: distant ? 0.5 : 0.35, formants: [900, 2300], q: 3, gurgleDepth: 0, vibrato: 6.5, attack: 0.08 });
}

// Random point out in the dark around the listener, for ambient one-shots.
function farPoint(min = 35, max = 90) {
  const a = Math.random() * Math.PI * 2;
  const d = rand(min, max);
  return { x: listenerPos.x + Math.cos(a) * d, y: listenerPos.y + rand(-1, 4), z: listenerPos.z + Math.sin(a) * d };
}

// Wooden creak: a slow pulse train (individual "clicks" of stressed wood) through a resonance.
function creak(pos) {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = rand(700, 1400);
  f.Q.value = 6;
  f.connect(output(pos, 15));
  const dur = rand(0.6, 1.4);
  tone(f, { freq: rand(22, 40), to: rand(14, 30), dur, gain: 0.5, type: 'sawtooth', attack: 0.15, release: 0.3 });
  cleanupAfter(dur, [f]);
}

function branchCrack(pos) {
  const out = output(pos, 15);
  const n = 3 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) noiseBurst(out, { start: rand(0, 0.25), dur: 0.03, gain: rand(0.2, 0.4), type: 'highpass', freq: rand(1800, 3500), q: 1 });
  thump(out, { from: 220, to: 90, dur: 0.06, gain: 0.15 });
}

// Distant howl — two animals slightly apart in pitch, swooping up then down.
function howl(pos) {
  const dur = rand(2, 3.2);
  const wet = echo(output(pos, 25), { time: 0.42, feedback: 0.45, lp: 800, life: dur + 5 });
  for (const mul of [1, rand(1.15, 1.3)]) {
    const start = mul === 1 ? 0 : rand(0.3, 0.8);
    const t = ctx.currentTime + start;
    const o = tone(wet, { start, freq: 330 * mul, dur, gain: 0.12, type: 'triangle', attack: 0.4, release: 1 });
    o.frequency.linearRampToValueAtTime(560 * mul, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(390 * mul, t + dur);
    lfo(o.frequency, { start, dur, rate: 5, depth: 8 });
  }
}

let amb = null;
let horrorIntensity = 0;

function scheduleAmbientEvent() {
  if (!amb) return;
  amb.timer = setTimeout(() => {
    if (!amb) return;
    const r = Math.random();
    if (r < 0.3) creak(farPoint(15, 45));
    else if (r < 0.55) branchCrack(farPoint(20, 60));
    else if (r < 0.75) howl(farPoint(70, 140));
    else if (r < 0.92 || horrorIntensity < 0.5) playZombieGroan(farPoint(30, 70), 'walker', 0.6);
    else playScream(farPoint(80, 150), true);
    scheduleAmbientEvent();
  }, rand(5000, 14000) / (1 + horrorIntensity * 1.5));
}

// Looping night-forest bed: wind, sub drone, and a tension layer driven by
// setHorrorIntensity. Safe to call repeatedly; stopHorrorAmbience frees it all.
export function startHorrorAmbience() {
  if (!ctx || amb) return;
  const t = ctx.currentTime;
  const bus = ctx.createGain();
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.exponentialRampToValueAtTime(1, t + 3);
  bus.connect(master);
  const srcs = [];
  const osc = (dest, type, freq, gain, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(dest);
    o.start(t);
    srcs.push(o);
  };
  const filter = (type, freq, q, dest) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    f.connect(dest);
    return f;
  };

  // Wind: low-passed noise whose brightness and level breathe slowly.
  const wg = ctx.createGain();
  wg.gain.value = 0.12;
  wg.connect(bus);
  const wf = filter('lowpass', 380, 1.5, wg);
  const wind = noiseLoop(t, 0);
  wind.connect(wf);
  srcs.push(wind, lfo(wf.frequency, { rate: 0.06, depth: 220 }), lfo(wg.gain, { rate: 0.11, depth: 0.06 }));

  // Drone: detuned sub oscillators beating slowly against each other.
  const dg = ctx.createGain();
  dg.gain.value = 0.09;
  dg.connect(bus);
  const df = filter('lowpass', 260, 0.7, dg);
  osc(df, 'sawtooth', 41.2, 0.5);
  osc(df, 'sawtooth', 41.55, 0.5);
  osc(df, 'triangle', 61.7, 0.4);
  osc(df, 'sine', 87.3, 0.3);

  // Tension: dissonant high string cluster with tremolo, plus a low throb.
  const tension = ctx.createGain();
  tension.gain.value = 0.0001;
  tension.connect(bus);
  const trem = ctx.createGain();
  trem.gain.value = 0.5;
  trem.connect(tension);
  const tf = filter('bandpass', 1800, 0.8, trem);
  for (const f of [1046.5, 1108.7, 1480, 1568]) osc(tf, 'sawtooth', f, 0.25, rand(-8, 8));
  const throb = ctx.createGain();
  throb.gain.value = 0.5;
  throb.connect(tension);
  osc(throb, 'sine', 49, 1.2);
  const tremLfo = lfo(trem.gain, { rate: 4, depth: 0.5 });
  const throbLfo = lfo(throb.gain, { rate: 0.9, depth: 0.5 });
  srcs.push(tremLfo, throbLfo);

  amb = { bus, srcs, tension, tremLfo, throbLfo, timer: 0 };
  setHorrorIntensity(horrorIntensity);
  scheduleAmbientEvent();
}

export function stopHorrorAmbience() {
  if (!amb) return;
  const { bus, srcs, timer } = amb;
  amb = null;
  clearTimeout(timer);
  const t = ctx.currentTime;
  bus.gain.cancelScheduledValues(t);
  bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), t);
  bus.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
  for (const s of srcs) {
    s.addEventListener('ended', () => s.disconnect());
    s.stop(t + 1.6);
  }
  srcs[0].addEventListener('ended', () => bus.disconnect());
}

// 0 = calm night, 1 = horde at the door. Also speeds up ambient events.
export function setHorrorIntensity(v) {
  horrorIntensity = clamp01(v);
  if (!amb) return;
  const t = ctx.currentTime;
  amb.tension.gain.setTargetAtTime(0.0001 + horrorIntensity * 0.08, t, 1.5);
  amb.tremLfo.frequency.setTargetAtTime(3 + horrorIntensity * 6, t, 1);
  amb.throbLfo.frequency.setTargetAtTime(0.8 + horrorIntensity * 1.6, t, 1);
}

// One "lub-dub". rate > 1 = faster, tighter beat.
export function playHeartbeat(rate = 1) {
  if (!ctx) return;
  const r = Math.min(3, Math.max(0.5, rate));
  thump(master, { from: 65, to: 38, dur: 0.14, gain: 0.75 });
  noiseBurst(master, { dur: 0.06, gain: 0.12, type: 'lowpass', freq: 180 });
  thump(master, { start: Math.max(0.12, 0.28 / r), from: 58, to: 34, dur: 0.12, gain: 0.55 });
}

// Lightning crack + rolling rumble. 0 = overhead, 1 = far away (later, duller, quieter).
export function playThunder(distance01 = 0.5) {
  if (!ctx) return;
  const d = clamp01(distance01);
  const near = 1 - d;
  const lag = d * 2.5; // sound arrives after the flash
  if (near > 0.35) {
    const n = 3 + Math.floor(near * 5);
    for (let i = 0; i < n; i++) noiseBurst(master, { start: lag + rand(0, 0.18), dur: rand(0.04, 0.12), gain: 0.5 * near, type: 'highpass', freq: rand(1500, 4000), q: 0.5 });
    thump(master, { start: lag, from: 120, to: 30, dur: 0.6, gain: 0.8 * near });
  }
  const dur = rand(4, 7) + d * 2;
  const g = 0.25 + 0.6 * near;
  noiseSwell(master, { start: lag, dur, gain: g, type: 'lowpass', freq: 300 + near * 900, to: 90, attack: 0.05 + d * 0.6 });
  // Rolling: overlapping rumbles as the sound bounces off hills.
  for (let i = 0; i < 3; i++) {
    noiseSwell(master, { start: lag + rand(0.4, dur * 0.6), dur: rand(1.5, 3), gain: g * rand(0.4, 0.8), type: 'lowpass', freq: rand(120, 260), to: 60, q: 1.2, attack: rand(0.2, 0.6) });
  }
  thump(master, { start: lag + 0.1, from: 55, to: 28, dur: 2.5, gain: 0.5 * g });
}

// Jump-scare hit: clustered semitones + tritones, a screech and a noise blast.
export function playStinger() {
  if (!ctx) return;
  const t = ctx.currentTime;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(7000, t);
  f.frequency.exponentialRampToValueAtTime(900, t + 1.5);
  f.connect(master);
  cleanupAfter(1.6, [f]);
  for (const fr of [110, 116.5, 155.6, 233.1, 246.9, 349.2, 1244.5, 1318.5]) {
    tone(f, { freq: fr, dur: 1.5, gain: 0.07, type: 'sawtooth', attack: 0.005, release: 1.3, detune: rand(-15, 15) });
  }
  tone(f, { freq: 1900, to: 2700, dur: 1.2, gain: 0.05, type: 'sawtooth', attack: 0.01, release: 0.9 }); // screech
  noiseSwell(master, { dur: 1.4, gain: 0.5, type: 'bandpass', freq: 5000, to: 600, q: 0.6, attack: 0.04 });
  thump(master, { from: 90, to: 28, dur: 0.7, gain: 0.9 });
}

// New wave: low brass-like horn swelling open, with a slow siren over it.
export function playRoundStart(round = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const dur = 3.5;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(150, t);
  f.frequency.exponentialRampToValueAtTime(900 + Math.min(round, 10) * 60, t + 1.6);
  f.frequency.exponentialRampToValueAtTime(200, t + dur);
  f.connect(master);
  cleanupAfter(dur + 0.3, [f]);
  const base = 55 * Math.pow(2, -Math.min(round, 12) / 48); // later waves sit subtly deeper
  for (const [mul, det] of [[1, -7], [1, 7], [1.5, 0], [2, 4]]) {
    tone(f, { freq: base * mul, dur, gain: 0.14, type: 'sawtooth', attack: 1.2, release: 1.4, detune: det });
  }
  if (round >= 5) tone(f, { freq: base * 1.414, dur, gain: 0.08, type: 'sawtooth', attack: 1.5, release: 1.4 }); // tritone dread
  const siren = tone(master, { freq: 180, dur, gain: 0.05, type: 'triangle', attack: 1, release: 1.2 });
  siren.frequency.linearRampToValueAtTime(420, t + 1.8);
  siren.frequency.linearRampToValueAtTime(240, t + dur);
  noiseSwell(master, { dur, gain: 0.08, type: 'lowpass', freq: 200, to: 120, attack: 1.2 });
}

// Wave survived: soft, unresolved minor-add9 chord ringing into the dark.
export function playRoundClear() {
  if (!ctx) return;
  const e = echo(master, { time: 0.37, feedback: 0.35, lp: 1800, life: 6 });
  [220, 261.63, 329.63, 493.88].forEach((fr, i) => {
    tone(e, { start: i * 0.12, freq: fr, dur: 3.2 - i * 0.12, gain: 0.06, type: 'triangle', attack: 0.5, release: 2, detune: rand(-6, 6) });
  });
  tone(e, { start: 0.6, freq: 1318.5, dur: 2.4, gain: 0.025, attack: 0.3, release: 1.8 });
}
