// Tutto l'audio è sintetizzato al volo con la Web Audio API:
// niente file da scaricare. Effetti sonori + una tarantella originale in loop.

import { storage } from "./ui.js";

let ctx = null;
let master = null;
let sfxGain = null;
let musicGain = null;
let noiseBuf = null;

export const settings = {
  sfx: storage.get("sfx", true),
  music: storage.get("music", true),
  voice: storage.get("voice", true),
};

export function saveSettings() {
  storage.set("sfx", settings.sfx);
  storage.set("music", settings.music);
  storage.set("voice", settings.voice);
}

/** Va chiamata dopo un gesto dell'utente (regole dei browser). */
export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    master.connect(ctx.destination);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.55;
    sfxGain.connect(master);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function tone({ freq, type = "square", start = 0, dur = 0.15, vol = 0.3, slide = null, out = sfxGain, attack = 0.005, release = 0.08, detune = 0 }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  o.detune.value = detune;
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + attack);
  g.gain.setValueAtTime(vol, t0 + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + release + 0.02);
}

function noise({ start = 0, dur = 0.1, vol = 0.2, freq = 3000, q = 1, type = "bandpass", out = sfxGain }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + start;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(out);
  s.start(t0, Math.random() * 0.5);
  s.stop(t0 + dur + 0.02);
}

const SFX = {
  click() {
    tone({ freq: 880, dur: 0.04, vol: 0.12, type: "triangle" });
  },
  join() {
    tone({ freq: mtof(72), dur: 0.08, vol: 0.2 });
    tone({ freq: mtof(79), dur: 0.12, vol: 0.2, start: 0.09 });
  },
  start() {
    [60, 64, 67, 72].forEach((m, i) => tone({ freq: mtof(m), dur: 0.12, vol: 0.22, start: i * 0.1, type: "sawtooth" }));
    tone({ freq: mtof(76), dur: 0.5, vol: 0.22, start: 0.42, type: "sawtooth" });
  },
  ding() {
    tone({ freq: 1568, dur: 0.5, vol: 0.2, type: "sine", release: 0.6 });
    tone({ freq: 2093, dur: 0.4, vol: 0.1, type: "sine", start: 0.02, release: 0.5 });
  },
  burn() {
    noise({ dur: 0.5, vol: 0.35, freq: 600, q: 0.7, type: "lowpass" });
    tone({ freq: 140, slide: 60, dur: 0.45, vol: 0.25, type: "sawtooth" });
  },
  correct() {
    [72, 76, 79, 84].forEach((m, i) => tone({ freq: mtof(m), dur: 0.09, vol: 0.2, start: i * 0.06, type: "triangle" }));
  },
  fail() {
    // il classico "uà uà uà uàaa" del trombone triste
    [[63, 0], [62, 0.32], [61, 0.64]].forEach(([m, s]) => tone({ freq: mtof(m), slide: mtof(m) * 0.97, dur: 0.28, vol: 0.22, start: s, type: "sawtooth" }));
    tone({ freq: mtof(60), slide: mtof(58.5), dur: 0.9, vol: 0.22, start: 0.96, type: "sawtooth" });
  },
  sweep() {
    [67, 72, 76, 79].forEach((m, i) => tone({ freq: mtof(m), dur: 0.1, vol: 0.2, start: i * 0.08, type: "square" }));
    tone({ freq: mtof(84), dur: 0.6, vol: 0.22, start: 0.34, type: "square" });
    for (let i = 0; i < 6; i++) noise({ start: 0.34 + i * 0.07, dur: 0.06, vol: 0.12, freq: 8000 });
  },
  reveal() {
    for (let i = 0; i < 10; i++) noise({ start: i * 0.045, dur: 0.05, vol: 0.06 + i * 0.012, freq: 1800, q: 0.8 });
    tone({ freq: mtof(79), dur: 0.25, vol: 0.18, start: 0.48, type: "triangle" });
  },
  hint() {
    tone({ freq: 1200, dur: 0.05, vol: 0.12, type: "sine" });
    tone({ freq: 1600, dur: 0.07, vol: 0.12, type: "sine", start: 0.07 });
  },
  brew() {
    // la moka che borbotta
    for (let i = 0; i < 8; i++) noise({ start: i * 0.09 + Math.random() * 0.04, dur: 0.07, vol: 0.06, freq: 400 + Math.random() * 500, q: 4 });
  },
  go() {
    tone({ freq: 1046, dur: 0.12, vol: 0.28, type: "square" });
  },
  tick() {
    tone({ freq: 1000, dur: 0.03, vol: 0.1, type: "square" });
  },
  interlude() {
    [72, 71, 72, 76].forEach((m, i) => tone({ freq: mtof(m), dur: 0.1, vol: 0.15, start: i * 0.11, type: "triangle" }));
  },
  final() {
    const seq = [60, 64, 67, 72, 67, 72, 76, 79, 84];
    seq.forEach((m, i) => tone({ freq: mtof(m), dur: 0.12, vol: 0.2, start: i * 0.09, type: "sawtooth" }));
    tone({ freq: mtof(72), dur: 1.2, vol: 0.12, start: 0.85, type: "sawtooth" });
    tone({ freq: mtof(76), dur: 1.2, vol: 0.12, start: 0.85, type: "sawtooth" });
    tone({ freq: mtof(79), dur: 1.2, vol: 0.12, start: 0.85, type: "sawtooth" });
    for (let i = 0; i < 12; i++) noise({ start: 0.85 + i * 0.08, dur: 0.07, vol: 0.1, freq: 7000 });
  },
  pop() {
    tone({ freq: 500, slide: 1400, dur: 0.06, vol: 0.15, type: "sine" });
  },
  send() {
    tone({ freq: 600, slide: 1200, dur: 0.1, vol: 0.12, type: "triangle" });
  },
};

export function sfx(name) {
  if (!settings.sfx || !ctx) return;
  const f = SFX[name];
  if (f) {
    try {
      f();
    } catch {
      /* niente */
    }
  }
}

// ------------------------------------------------------------------ musica

// Tarantella originale in La minore, 6/8. 0 = tieni la nota, -1 = pausa.
const MELODY = [
  76, 76, 76, 74, 72, 71,
  72, 72, 72, 71, 69, 68,
  69, 71, 72, 74, 76, 77,
  76, 0, 0, 64, 68, 71,
  76, 76, 76, 74, 72, 71,
  72, 72, 72, 71, 69, 68,
  69, 72, 76, 74, 71, 68,
  69, 0, 0, 69, -1, -1,
  72, 74, 76, 77, 76, 74,
  72, 74, 76, 77, 76, 74,
  77, 76, 74, 76, 74, 72,
  71, 0, 0, 68, 71, 74,
  72, 74, 76, 77, 76, 74,
  72, 74, 76, 79, 77, 76,
  74, 72, 71, 72, 71, 68,
  69, 0, 0, 69, -1, -1,
];
// un accordo per battuta (radice del basso, terza, quinta in semitoni)
const CHORDS = [
  [45, 3, 7], [45, 3, 7], [45, 3, 7], [40, 4, 7],
  [45, 3, 7], [45, 3, 7], [40, 4, 7], [45, 3, 7],
  [48, 4, 7], [48, 4, 7], [50, 3, 7], [40, 4, 7],
  [48, 4, 7], [48, 4, 7], [40, 4, 7], [45, 3, 7],
];

let musicOn = false;
let step = 0;
let nextTime = 0;
let timer = null;
const EIGHTH = 60 / 138 / 3;

function scheduleMusic() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + 0.25) {
    const i = step % MELODY.length;
    const bar = Math.floor(i / 6);
    const beat = i % 6;
    const note = MELODY[i];
    const start = nextTime - ctx.currentTime;
    if (note > 0) {
      let len = 1;
      while (MELODY[(i + len) % MELODY.length] === 0) len++;
      const dur = EIGHTH * len * 0.92;
      // "fisarmonica": due dente di sega leggermente scordate
      tone({ freq: mtof(note), type: "sawtooth", start, dur, vol: 0.07, out: musicGain, attack: 0.01, release: 0.05, detune: -7 });
      tone({ freq: mtof(note), type: "square", start, dur, vol: 0.04, out: musicGain, attack: 0.01, release: 0.05, detune: 8 });
    }
    const [root, third, fifth] = CHORDS[bar];
    if (beat === 0 || beat === 3) {
      // basso "zum"
      tone({ freq: mtof(beat === 0 ? root : root + fifth - 12 + 12), type: "triangle", start, dur: EIGHTH * 1.2, vol: 0.22, out: musicGain, release: 0.04 });
      noise({ start, dur: 0.05, vol: beat === 0 ? 0.08 : 0.05, freq: 9000, q: 0.5, out: musicGain });
    } else if (beat === 1 || beat === 4) {
      // accordo "pa"
      for (const iv of [12, 12 + third, 12 + fifth]) {
        tone({ freq: mtof(root + iv), type: "triangle", start, dur: EIGHTH * 0.9, vol: 0.05, out: musicGain, release: 0.03 });
      }
      noise({ start, dur: 0.04, vol: 0.035, freq: 10000, q: 0.5, out: musicGain });
    } else {
      noise({ start, dur: 0.03, vol: 0.025, freq: 11000, q: 0.5, out: musicGain });
    }
    nextTime += EIGHTH;
    step++;
  }
}

export function setMusic(on) {
  musicOn = on && settings.music;
  if (!ctx) return;
  const t = ctx.currentTime;
  musicGain.gain.cancelScheduledValues(t);
  musicGain.gain.setValueAtTime(musicGain.gain.value, t);
  musicGain.gain.linearRampToValueAtTime(musicOn ? 0.55 : 0, t + 0.6);
  if (musicOn && !timer) {
    nextTime = ctx.currentTime + 0.05;
    step = 0;
    timer = setInterval(scheduleMusic, 60);
  } else if (!musicOn && timer) {
    const tt = timer;
    timer = null;
    setTimeout(() => {
      if (!timer) clearInterval(tt);
      else clearInterval(tt);
    }, 700);
  }
}

export function isMusicPlaying() {
  return musicOn;
}
