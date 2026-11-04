// Pigna trova il fazzoletto: guida Pigna per le stanze, segui il naso,
// annusa i nascondigli e trova il fazzoletto prima che scada il tempo.

import { saveSettings, settings, sfx, unlockAudio } from "./audio.js";
import { confetti } from "./fx.js";
import { initNonna, nonnaSay } from "./nonna.js";
import { distances, generateLevel, path, walkable } from "./pigna-level.js";
import { h, storage, toast } from "./ui.js";

const LINES = {
  start: ["Pigna! Dov'è il fazzoletto? Cercalo!", "Annusa, Pigna, annusa!", "Il fazzoletto della domenica è sparito di nuovo…"],
  found: ["Brava Pigna! Biscottino!", "Eccolo! Tutto sbavato, ma eccolo.", "Che naso! Meglio di un tartufaio."],
  empty: ["Lì non c'è niente!", "Acqua, acqua…", "Ritenta, Pigna!"],
  cat: ["Il gatto! Pigna, lascialo stare!", "Quel gatto è un dispettoso!", "Ffff! Il gatto ha soffiato!"],
  bone: ["Un osso! Pigna ringrazia.", "Gnam!"],
  hot: ["Fuochino!", "Ci siamo quasi!"],
  over: ["Tempo scaduto! Il fazzoletto lo cerco io domani.", "Vabbè, Pigna, andiamo a fare la nanna."],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ stato

const stage = document.getElementById("stage");
const cv = document.getElementById("pgBoard");
let g = cv.getContext("2d"); // contesto attivo (il ritratto del menu lo scambia per un attimo)
let DPR = 1;
let T = 40; // lato di una casella in px CSS

let lv = null;
let level = 1;
let score = 0;
let levelScore = 0;
let dist = []; // distanze dal fazzoletto
let maxDist = 1;
let dog = { x: 0, y: 0, px: 0, py: 0, dir: 1, moveT: 1, wag: 0, dig: 0, scared: 0, happy: 0 };
let queue = [];
let searched = new Set();
let bones = new Set();
let cats = [];
let timeLeft = 60;
let running = false;
let paused = false;
let barkUsed = false;
let arrow = null; // {dx, dy, t}
let floats = [];
let sniffs = [];
let startedAt = 0;
let lastT = 0;
let catTimer = 0;
let lastHotLine = 0;
let best = storage.get("pg:best", 0);
let foundAnim = 0;
let tick = 0;

const STEP_MS = 140;

// ------------------------------------------------------------------ dimensioni

function resize() {
  if (!lv) return;
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = stage.getBoundingClientRect();
  T = Math.floor(Math.min(r.width / lv.cols, r.height / lv.rows, 64));
  const w = T * lv.cols;
  const hgt = T * lv.rows;
  cv.width = Math.round(w * DPR);
  cv.height = Math.round(hgt * DPR);
  cv.style.width = w + "px";
  cv.style.height = hgt + "px";
}

// ------------------------------------------------------------------ disegno

function emoji(e, x, y, size) {
  // colore pieno: Chrome applica alle emoji la trasparenza del fillStyle
  g.fillStyle = "#000";
  g.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(e, x, y + size * 0.06);
}

/** Pigna: cagnolina color biscotto, orecchie scure, collarino rosso. */
function drawDog(cx, cy, s, dir, wag, t, state) {
  g.save();
  g.translate(cx, cy);
  if (dir < 0) g.scale(-1, 1);
  const bob = state.dig > 0 ? Math.sin(t * 40) * s * 0.04 : Math.sin(t * 8) * s * 0.015;
  const scare = state.scared > 0 ? Math.sin(t * 60) * s * 0.05 : 0;
  g.translate(scare, bob);
  // ombra
  g.fillStyle = "rgba(0,0,0,.18)";
  g.beginPath();
  g.ellipse(0, s * 0.38, s * 0.42, s * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // coda che scodinzola (più veloce quando si è vicini)
  g.save();
  g.translate(-s * 0.32, -s * 0.02);
  g.rotate(-0.6 + Math.sin(t * (6 + wag * 22)) * (0.25 + wag * 0.45));
  g.strokeStyle = "#c98a4b";
  g.lineWidth = s * 0.09;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 0);
  g.quadraticCurveTo(-s * 0.12, -s * 0.18, -s * 0.05, -s * 0.3);
  g.stroke();
  g.restore();
  // zampe
  g.fillStyle = "#b5773d";
  const step = state.moving ? Math.sin(t * 30) * s * 0.05 : 0;
  for (const [lx, o] of [[-0.2, step], [-0.05, -step], [0.12, -step], [0.25, step]]) {
    g.beginPath();
    g.roundRect(lx * s - s * 0.045, s * 0.18 + o * 0.3, s * 0.09, s * 0.2, s * 0.04);
    g.fill();
  }
  // corpo
  g.fillStyle = "#d9a05b";
  g.beginPath();
  g.ellipse(0, s * 0.1, s * 0.36, s * 0.2, 0, 0, Math.PI * 2);
  g.fill();
  // pancia chiara
  g.fillStyle = "#f3d7a7";
  g.beginPath();
  g.ellipse(s * 0.04, s * 0.17, s * 0.22, s * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  // testa (si abbassa quando annusa o scava)
  const headDown = state.dig > 0 || state.sniff ? s * 0.08 : 0;
  g.save();
  g.translate(s * 0.3, -s * 0.12 + headDown);
  g.fillStyle = "#d9a05b";
  g.beginPath();
  g.ellipse(0, 0, s * 0.2, s * 0.18, 0, 0, Math.PI * 2);
  g.fill();
  // muso
  g.fillStyle = "#f3d7a7";
  g.beginPath();
  g.ellipse(s * 0.15, s * 0.05, s * 0.11, s * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "#2a1b0f";
  g.beginPath();
  g.ellipse(s * 0.24, s * 0.02, s * 0.04, s * 0.032, 0, 0, Math.PI * 2);
  g.fill();
  // occhio
  if (state.happy > 0) {
    g.strokeStyle = "#2a1b0f";
    g.lineWidth = s * 0.025;
    g.beginPath();
    g.arc(s * 0.05, -s * 0.04, s * 0.035, Math.PI, 0);
    g.stroke();
  } else {
    g.fillStyle = "#2a1b0f";
    g.beginPath();
    g.arc(s * 0.05, -s * 0.05, s * 0.033, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(s * 0.06, -s * 0.06, s * 0.011, 0, Math.PI * 2);
    g.fill();
  }
  // lingua quando è felice
  if (state.happy > 0 || state.wag > 0.75) {
    g.fillStyle = "#ff7b9c";
    g.beginPath();
    g.ellipse(s * 0.17, s * 0.13, s * 0.035, s * 0.05, 0.2, 0, Math.PI * 2);
    g.fill();
  }
  // orecchio scuro a penzoloni
  g.fillStyle = "#7a4a24";
  g.beginPath();
  g.ellipse(-s * 0.08, -s * 0.02, s * 0.07, s * 0.15, 0.35 + Math.sin(t * 10) * (state.moving ? 0.2 : 0.04), 0, Math.PI * 2);
  g.fill();
  g.restore();
  // collarino con medaglietta
  g.strokeStyle = "#d62828";
  g.lineWidth = s * 0.05;
  g.beginPath();
  g.arc(s * 0.22, -s * 0.02, s * 0.12, Math.PI * 0.55, Math.PI * 1.05);
  g.stroke();
  g.fillStyle = "#ffc43d";
  g.beginPath();
  g.arc(s * 0.13, s * 0.08, s * 0.035, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** Il fazzoletto: quadrato a quadretti bianco e rosso. */
function drawHanky(cx, cy, s, t) {
  g.save();
  g.translate(cx, cy);
  g.rotate(Math.sin(t * 3) * 0.15);
  const n = 4;
  const c = s / n;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      g.fillStyle = (i + j) % 2 ? "#ffffff" : "#d62828";
      g.fillRect(-s / 2 + i * c, -s / 2 + j * c, c, c);
    }
  g.strokeStyle = "rgba(0,0,0,.25)";
  g.lineWidth = 1;
  g.strokeRect(-s / 2, -s / 2, s, s);
  g.restore();
}

function render(t) {
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  const [f1, f2] = lv.theme.floor;
  for (let y = 0; y < lv.rows; y++) {
    for (let x = 0; x < lv.cols; x++) {
      const k = y * lv.cols + x;
      if (lv.grid[k] === 1 && !lv.deco[k]) {
        g.fillStyle = lv.theme.wall;
        g.fillRect(x * T, y * T, T, T);
        g.fillStyle = "rgba(255,255,255,.07)";
        g.fillRect(x * T, y * T, T, T * 0.18);
        continue;
      }
      g.fillStyle = (x + y) % 2 ? f1 : f2;
      g.fillRect(x * T, y * T, T, T);
    }
  }
  // scie dell'odore: le caselle più vicine al fazzoletto brillano appena (solo vicino a Pigna)
  for (let y = 0; y < lv.rows; y++) {
    for (let x = 0; x < lv.cols; x++) {
      const k = y * lv.cols + x;
      if (lv.grid[k] === 1) continue;
      const near = Math.abs(x - dog.x) + Math.abs(y - dog.y);
      if (near > 2) continue;
      const heat = 1 - dist[k] / maxDist;
      g.fillStyle = `rgba(255,${Math.round(180 - heat * 150)},60,${0.06 + heat * 0.22})`;
      g.fillRect(x * T, y * T, T, T);
    }
  }
  // decorazioni: ostacoli e nascondigli
  for (let y = 0; y < lv.rows; y++) {
    for (let x = 0; x < lv.cols; x++) {
      const k = y * lv.cols + x;
      const d = lv.deco[k];
      if (!d) continue;
      const isSpot = lv.spots.includes(k);
      if (isSpot && searched.has(k) && k !== lv.target) {
        g.globalAlpha = 0.35;
        emoji(d, x * T + T / 2, y * T + T / 2, T * 0.62);
        g.globalAlpha = 1;
        emoji("✖️", x * T + T * 0.78, y * T + T * 0.25, T * 0.3);
        continue;
      }
      if (isSpot && !searched.has(k)) {
        // alone dorato che pulsa: qui si può annusare
        g.fillStyle = `rgba(255,196,61,${0.28 + 0.12 * Math.sin(t * 4 + k)})`;
        g.beginPath();
        g.arc(x * T + T / 2, y * T + T / 2, T * 0.44, 0, Math.PI * 2);
        g.fill();
      }
      emoji(d, x * T + T / 2, y * T + T / 2 + (isSpot ? Math.sin(t * 3 + k) * T * 0.03 : 0), T * (isSpot ? 0.66 : 0.8));
      if (isSpot && !searched.has(k)) emoji("❔", x * T + T * 0.8, y * T + T * 0.22, T * 0.28);
    }
  }
  // ossi
  for (const k of bones) emoji("🦴", (k % lv.cols) * T + T / 2, Math.floor(k / lv.cols) * T + T / 2, T * 0.5);
  // gatti
  for (const c of cats) emoji("🐈", c.px * T + T / 2, c.py * T + T / 2, T * 0.72);
  // fazzoletto trovato
  if (foundAnim > 0) {
    const tx = lv.target % lv.cols;
    const ty = Math.floor(lv.target / lv.cols);
    drawHanky(tx * T + T / 2, ty * T + T / 2 - (1 - foundAnim) * T * 0.8, T * 0.6, t);
  }
  // sbuffi di naso
  for (const p of sniffs) {
    g.globalAlpha = 1 - p.life;
    emoji("💨", p.x, p.y, T * 0.3);
  }
  g.globalAlpha = 1;
  // Pigna (interpolata tra le caselle)
  const k = Math.min(1, dog.moveT);
  const dx = dog.px + (dog.x - dog.px) * k;
  const dy = dog.py + (dog.y - dog.py) * k;
  const heat = 1 - (dist[dog.y * lv.cols + dog.x] ?? maxDist) / maxDist;
  drawDog(dx * T + T / 2, dy * T + T / 2, T * 0.95, dog.dir, heat, t, {
    dig: dog.dig,
    scared: dog.scared,
    happy: dog.happy,
    moving: dog.moveT < 1,
    sniff: lv.spots.includes(dog.y * lv.cols + dog.x),
    wag: heat,
  });
  // freccia dell'aiutino
  if (arrow && arrow.t > 0) {
    g.save();
    g.globalAlpha = Math.min(1, arrow.t);
    g.translate(dx * T + T / 2 + arrow.dx * T * 0.9, dy * T + T / 2 + arrow.dy * T * 0.9);
    g.rotate(Math.atan2(arrow.dy, arrow.dx));
    g.fillStyle = "#ffc43d";
    g.strokeStyle = "#9d0208";
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(T * 0.35, 0);
    g.lineTo(-T * 0.15, -T * 0.25);
    g.lineTo(-T * 0.05, 0);
    g.lineTo(-T * 0.15, T * 0.25);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  // scritte che salgono
  for (const f of floats) {
    g.globalAlpha = 1 - f.life;
    g.font = `${Math.round(T * 0.42)}px "Lilita One", sans-serif`;
    g.textAlign = "center";
    g.lineWidth = 4;
    g.strokeStyle = "rgba(40,10,0,.7)";
    g.strokeText(f.text, f.x, f.y - f.life * T);
    g.fillStyle = f.color;
    g.fillText(f.text, f.x, f.y - f.life * T);
  }
  g.globalAlpha = 1;
}

// ------------------------------------------------------------------ logica

function floatText(x, y, text, color = "#fff") {
  floats.push({ x: x * T + T / 2, y: y * T + T * 0.2, text, color, life: 0 });
}

function loadLevel(n) {
  lv = generateLevel(n, n * 7919 + (storage.get("pg:seed", 0) | 0));
  level = n;
  levelScore = 0;
  dist = distances(lv, lv.target % lv.cols, Math.floor(lv.target / lv.cols));
  maxDist = Math.max(1, ...dist);
  const [sx, sy] = lv.start;
  dog = { x: sx, y: sy, px: sx, py: sy, dir: 1, moveT: 1, wag: 0, dig: 0, scared: 0, happy: 0 };
  queue = [];
  searched = new Set();
  bones = new Set(lv.bones);
  cats = lv.cats.map((k) => ({ x: k % lv.cols, y: Math.floor(k / lv.cols), px: k % lv.cols, py: Math.floor(k / lv.cols) }));
  timeLeft = lv.timeLimit;
  barkUsed = false;
  arrow = null;
  floats = [];
  sniffs = [];
  foundAnim = 0;
  document.getElementById("level").textContent = "Livello " + n;
  document.getElementById("room").textContent = lv.theme.name;
  document.getElementById("btnBark").disabled = false;
  resize();
  updateNose();
}

function updateNose() {
  const d = dist[dog.y * lv.cols + dog.x];
  const heat = Math.max(0, 1 - d / maxDist);
  const bar = document.getElementById("noseBar");
  bar.style.width = Math.round(8 + heat * 92) + "%";
  bar.style.background = `hsl(${Math.round(210 - heat * 210)}, 85%, 55%)`;
  const txt = d === 0 ? "QUI!" : heat > 0.85 ? "Fuoco!" : heat > 0.65 ? "Caldo" : heat > 0.4 ? "Tiepido" : heat > 0.2 ? "Fresco" : "Freddo";
  document.getElementById("noseTxt").textContent = txt;
  if (heat > 0.85 && performance.now() - lastHotLine > 9000 && d > 0) {
    lastHotLine = performance.now();
    nonnaSay(pick(LINES.hot), "sly");
  }
}

function tryStep(dx, dy) {
  if (!running || paused || dog.dig > 0 || dog.scared > 0) return false;
  const nx = dog.x + dx;
  const ny = dog.y + dy;
  if (!walkable(lv, nx, ny)) return false;
  dog.px = dog.x;
  dog.py = dog.y;
  dog.x = nx;
  dog.y = ny;
  dog.moveT = 0;
  if (dx) dog.dir = dx;
  sfx("tick");
  sniffs.push({ x: dog.x * T + T * (dog.dir > 0 ? 0.85 : 0.15), y: dog.y * T + T * 0.45, life: 0 });
  arrived();
  return true;
}

function arrived() {
  const k = dog.y * lv.cols + dog.x;
  updateNose();
  if (bones.has(k)) {
    bones.delete(k);
    levelScore += 25;
    score += 25;
    renderScore();
    floatText(dog.x, dog.y, "+25 🦴", "#ffd166");
    sfx("correct");
    if (Math.random() < 0.4) nonnaSay(pick(LINES.bone), "happy");
  }
  if (lv.spots.includes(k) && !searched.has(k)) {
    queue = [];
    dog.dig = 0.6;
    sfx("brew");
    setTimeout(() => dug(k), 600);
  }
  checkCats();
}

function dug(k) {
  if (!running) return;
  searched.add(k);
  dog.dig = 0;
  if (k === lv.target) {
    found();
  } else {
    floatText(dog.x, dog.y, "niente…", "#ffffff");
    sfx("fail");
    if (Math.random() < 0.6) nonnaSay(pick(LINES.empty), "angry");
  }
}

function found() {
  running = false;
  foundAnim = 1;
  dog.happy = 3;
  const bonus = Math.round(timeLeft * 3);
  const pts = 150 + bonus + (barkUsed ? 0 : 50);
  levelScore += pts;
  score += pts;
  renderScore();
  floatText(dog.x, dog.y, "+" + pts, "#ffc43d");
  sfx("final");
  confetti(140);
  nonnaSay(pick(LINES.found), "proud");
  setTimeout(() => showLevelDone(bonus), 1300);
}

function checkCats() {
  for (const c of cats) {
    if (Math.abs(c.x - dog.x) + Math.abs(c.y - dog.y) <= 1 && dog.scared <= 0) {
      dog.scared = 0.9;
      queue = [];
      timeLeft = Math.max(0, timeLeft - 5);
      floatText(dog.x, dog.y, "-5 s 🐈", "#ff6b6b");
      sfx("burn");
      try {
        navigator.vibrate?.(150);
      } catch {
        /* niente */
      }
      nonnaSay(pick(LINES.cat), "angry");
      // il gatto scappa lontano
      const d = distances(lv, dog.x, dog.y);
      let bestK = -1;
      let bestD = -1;
      for (let i = 0; i < d.length; i++) {
        if (d[i] > bestD && !lv.spots.includes(i) && !cats.some((o) => o !== c && o.y * lv.cols + o.x === i)) {
          bestD = d[i];
          bestK = i;
        }
      }
      if (bestK >= 0) {
        c.x = c.px = bestK % lv.cols;
        c.y = c.py = Math.floor(bestK / lv.cols);
      }
    }
  }
}

function moveCats() {
  for (const c of cats) {
    const opts = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].filter(([dx, dy]) => {
      const nx = c.x + dx;
      const ny = c.y + dy;
      return walkable(lv, nx, ny) && !(nx === dog.x && ny === dog.y) && !cats.some((o) => o !== c && o.x === nx && o.y === ny);
    });
    if (!opts.length) continue;
    const [dx, dy] = pick(opts);
    c.px = c.x;
    c.py = c.y;
    c.x += dx;
    c.y += dy;
  }
  checkCats();
}

function bark() {
  if (!running || barkUsed) return;
  barkUsed = true;
  document.getElementById("btnBark").disabled = true;
  sfx("join");
  floatText(dog.x, dog.y, "BAU!", "#ffffff");
  const tx = lv.target % lv.cols;
  const ty = Math.floor(lv.target / lv.cols);
  const p = path(lv, dog.x, dog.y, tx, ty);
  if (p && p.length) {
    arrow = { dx: p[0][0] - dog.x, dy: p[0][1] - dog.y, t: 3 };
    toast("Pigna ha fiutato la direzione! 👃");
  } else if (p && !p.length) {
    toast("È proprio qui sotto!");
  }
}

function renderScore() {
  const el = document.getElementById("score");
  el.textContent = String(score);
  el.classList.remove("bump");
  void el.offsetWidth;
  el.classList.add("bump");
}

function update(dt) {
  tick += dt;
  if (dog.moveT < 1) dog.moveT += (dt * 1000) / STEP_MS;
  if (dog.moveT >= 1 && queue.length && dog.dig <= 0 && dog.scared <= 0) {
    const [nx, ny] = queue.shift();
    if (!tryStep(nx - dog.x, ny - dog.y)) queue = [];
  }
  dog.scared = Math.max(0, dog.scared - dt);
  dog.happy = Math.max(0, dog.happy - dt);
  if (dog.dig > 0) dog.dig = Math.max(0.01, dog.dig - dt);
  for (const c of cats) {
    c.px += (c.x - c.px) * Math.min(1, dt * 8);
    c.py += (c.y - c.py) * Math.min(1, dt * 8);
  }
  for (const f of floats) f.life += dt * 0.9;
  floats = floats.filter((f) => f.life < 1);
  for (const s of sniffs) s.life += dt * 1.6;
  sniffs = sniffs.filter((s) => s.life < 1);
  if (arrow) arrow.t -= dt;
  if (foundAnim > 0) foundAnim = Math.max(0.001, foundAnim - dt * 0.8);
  if (!running || paused) return;
  catTimer -= dt;
  if (catTimer <= 0) {
    moveCats();
    catTimer = Math.max(0.35, 0.8 - level * 0.04);
  }
  const before = Math.ceil(timeLeft);
  timeLeft -= dt;
  const now = Math.ceil(timeLeft);
  if (now !== before && now <= 5 && now > 0) sfx("tick");
  document.getElementById("timeTxt").textContent = String(Math.max(0, now));
  const tb = document.getElementById("timeBar");
  tb.style.width = Math.max(0, (100 * timeLeft) / lv.timeLimit) + "%";
  tb.classList.toggle("hurry", timeLeft < 10);
  if (timeLeft <= 0) gameOver();
}

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
  lastT = t;
  if (!lv) return;
  update(dt);
  render(t / 1000);
}

// ------------------------------------------------------------------ input

const KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
document.addEventListener("keydown", (e) => {
  const d = KEYS[e.key];
  if (d) {
    e.preventDefault();
    unlockAudio();
    queue = [];
    if (dog.moveT >= 1) tryStep(d[0], d[1]);
    else queue = [[dog.x + d[0], dog.y + d[1]]];
  } else if (e.key === "b" || e.key === " ") {
    bark();
  } else if (e.key === "Escape" && running) {
    paused = !paused;
    toast(paused ? "Pausa ⏸️" : "Si riparte!");
  }
});

let touch = null;
cv.addEventListener("pointerdown", (e) => {
  unlockAudio();
  touch = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (paused) paused = false;
});
cv.addEventListener("pointerup", (e) => {
  if (!touch || !running) return;
  const dx = e.clientX - touch.x;
  const dy = e.clientY - touch.y;
  touch = null;
  if (Math.hypot(dx, dy) > 28) {
    // scorrimento: un passo nella direzione
    const d = Math.abs(dx) > Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
    queue = [];
    tryStep(d[0], d[1]);
    return;
  }
  // tocco: Pigna va fin lì
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / T);
  const y = Math.floor((e.clientY - r.top) / T);
  const p = path(lv, dog.x, dog.y, x, y);
  if (p) queue = p;
  else sfx("click");
});

document.getElementById("btnBark").onclick = bark;

// ------------------------------------------------------------------ schermate

const overlay = document.getElementById("overlay");

function startGame() {
  unlockAudio();
  score = 0;
  startedAt = performance.now();
  renderScore();
  beginLevel(1);
}

function beginLevel(n) {
  loadLevel(n);
  overlay.classList.add("hidden");
  overlay.replaceChildren();
  running = true;
  paused = false;
  catTimer = 1;
  sfx("start");
  nonnaSay(n === 1 ? pick(LINES.start) : `${lv.theme.name}! Cerca bene, Pigna.`, "happy");
}

function showLevelDone(bonus) {
  overlay.classList.remove("hidden");
  overlay.replaceChildren(
    h(
      "div.card.checkered.aff-card",
      h("div.aff-over", "Trovato! 🎉"),
      h("p.center", { style: { fontWeight: 800, marginTop: 4 } }, `Livello ${level} · ${lv.theme.name}`),
      h(
        "ul.aff-rules",
        h("li", "🧣 Fazzoletto: +150"),
        h("li", `⏱️ Tempo avanzato: +${bonus}`),
        h("li", barkUsed ? "🐶 Aiutino usato: niente bonus" : "🐶 Senza aiutino: +50"),
        h("li", `⭐ Punteggio totale: ${score}`),
      ),
      h("button.btn.block.green", { onclick: () => beginLevel(level + 1) }, `Avanti, livello ${level + 1} ▶`),
    ),
  );
}

function gameOver() {
  if (!running) return;
  running = false;
  const ms = Math.round(performance.now() - startedAt);
  const record = score > best;
  if (record) {
    best = score;
    storage.set("pg:best", best);
  }
  sfx(record && score > 0 ? "final" : "fail");
  nonnaSay(pick(LINES.over), "sly");
  if (record && score > 0) confetti(160);
  setTimeout(() => showOver(ms, record), 600);
}

async function fetchTop() {
  try {
    const r = await fetch("/api/pigna/top");
    if (r.ok) return await r.json();
  } catch {
    /* offline */
  }
  return { all: [], today: [] };
}

function boardList(list, me) {
  if (!list.length) return h("p.muted", { style: { margin: "6px 0" } }, "Ancora nessuno. Il primo posto è tuo!");
  return h(
    "ol.aff-board",
    list.slice(0, 10).map((e, i) =>
      h("li" + (me && e.name.toLowerCase() === me.toLowerCase() ? ".me" : ""), h("span.pos", i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1)), h("span.av", e.avatar), h("span.nm", e.name), h("b", String(e.score))),
    ),
  );
}

function boards(data, me) {
  let tab = storage.get("pg:tab", "today");
  const box = h("div");
  const tabs = h("div.seg");
  const paint = () => {
    tabs.replaceChildren(
      h("button" + (tab === "today" ? ".sel" : ""), { type: "button", onclick: () => ((tab = "today"), storage.set("pg:tab", tab), paint()) }, "Oggi"),
      h("button" + (tab === "all" ? ".sel" : ""), { type: "button", onclick: () => ((tab = "all"), storage.set("pg:tab", tab), paint()) }, "Di sempre"),
    );
    box.replaceChildren(boardList(tab === "today" ? data.today : data.all, me));
  };
  paint();
  return h("div", h("div.row", { style: { justifyContent: "space-between", margin: "10px 0 6px" } }, h("h3", "🏆 Classifica"), tabs), box);
}

async function showMenu() {
  overlay.classList.remove("hidden");
  const data = await fetchTop();
  overlay.replaceChildren(
    h(
      "div.card.checkered.aff-card",
      h("canvas.pg-portrait", { width: 240, height: 170 }),
      h("div.aff-logo", "Pigna trova il fazzoletto"),
      h("p.aff-tag", "Il fazzoletto della domenica è sparito. Solo il naso di Pigna può trovarlo!"),
      h(
        "ul.aff-rules",
        h("li", "👆 Tocca una casella e Pigna ci va (o usa frecce e scorrimenti)."),
        h("li", "👃 Segui il naso: più diventa rosso, più sei vicino."),
        h("li", "❔ Passa sui nascondigli per annusarli: in uno c'è il fazzoletto."),
        h("li", "🦴 Gli ossi danno punti. 🐈 Il gatto ti fa perdere 5 secondi!"),
        h("li", "🐶 «Bau!» indica la strada, ma una volta sola per livello."),
      ),
      best ? h("p.aff-best", "Il tuo record: ", h("b", String(best))) : null,
      h("button.btn.block.green", { onclick: startGame }, "🐾 Cerca, Pigna!"),
      boards(data, storage.get("name", "")),
      h("a.btn.ghost.small.block", { href: "/", style: { marginTop: "12px" } }, "← Torna alla Sagra"),
    ),
  );
  drawPortrait(overlay.querySelector(".pg-portrait"));
}

function drawPortrait(c) {
  if (!c) return;
  const pg = c.getContext("2d");
  // riusa drawDog e drawHanky su un altro canvas
  const t0 = performance.now();
  const anim = () => {
    if (!c.isConnected) return;
    pg.clearRect(0, 0, c.width, c.height);
    const old = gSwap(pg);
    drawDog(110, 95, 150, 1, 0.9, (performance.now() - t0) / 1000, { happy: 0, wag: 0.9 });
    drawHanky(205, 125, 34, (performance.now() - t0) / 1000);
    gSwap(old);
    requestAnimationFrame(anim);
  };
  anim();
}

/** Scambia il contesto di disegno attivo (per il ritratto nel menu). */
function gSwap(ctx) {
  const prev = g;
  g = ctx;
  return prev;
}

async function showOver(ms, record) {
  overlay.classList.remove("hidden");
  const name = h("input.field", { placeholder: "Il tuo nome", maxLength: 18, value: storage.get("name", ""), "aria-label": "Il tuo nome" });
  const avatar = "🐶";
  const boardBox = h("div");
  const sendBtn = h(
    "button.btn.small.gold",
    {
      onclick: async () => {
        const n = name.value.trim();
        if (!n) {
          toast("Scrivi un nome!", "err");
          return name.focus();
        }
        storage.set("name", n);
        sendBtn.disabled = true;
        try {
          const r = await fetch("/api/pigna/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, avatar, score, ms }) });
          const j = await r.json();
          if (!j.ok) {
            toast(j.error || "Non sono riuscito a salvare.", "err");
            sendBtn.disabled = false;
            return;
          }
          if (j.rankToday) toast(`Sei ${j.rankToday}° nella classifica di oggi! 🐾`);
          else toast("Salvato!");
          boardBox.replaceChildren(boards(j, n));
          sendBtn.textContent = "✔ Salvato";
        } catch {
          toast("Sei offline? Non riesco a salvare.", "err");
          sendBtn.disabled = false;
        }
      },
    },
    "Salva in classifica",
  );
  overlay.replaceChildren(
    h(
      "div.card.checkered.aff-card",
      h("div.aff-over", record && score > 0 ? "NUOVO RECORD!" : "Tempo scaduto!"),
      h("div.aff-final", String(score)),
      h("p.center.muted", { style: { marginTop: 0 } }, `Arrivati al livello ${level} (${lv.theme.name}) · record ${best}`),
      score > 0 ? h("div.row", { style: { flexWrap: "nowrap" } }, h("div.grow", name), sendBtn) : null,
      h("div.row", { style: { marginTop: "12px" } }, h("button.btn.green.grow", { onclick: startGame }, "🔁 Rigioca"), h("button.btn.ghost", { onclick: showMenu }, "Menu")),
      boardBox,
    ),
  );
  boardBox.replaceChildren(boards(await fetchTop(), name.value.trim()));
}

// ------------------------------------------------------------------ avvio

const bs = document.getElementById("btnSound");
const paintSound = () => {
  bs.textContent = settings.sfx ? "🔊" : "🔇";
  bs.classList.toggle("off", !settings.sfx);
};
bs.onclick = () => {
  settings.sfx = !settings.sfx;
  saveSettings();
  paintSound();
};
paintSound();
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) paused = true;
});
addEventListener("resize", resize);

window.__pigna = {
  get state() {
    return { running, level, score, timeLeft, dog: { x: dog.x, y: dog.y }, target: lv ? [lv.target % lv.cols, Math.floor(lv.target / lv.cols)] : null, spots: lv?.spots.map((k) => [k % lv.cols, Math.floor(k / lv.cols)]) };
  },
  goTo(x, y) {
    const p = path(lv, dog.x, dog.y, x, y);
    if (p) queue = p;
    return !!p;
  },
  gameOver,
};

initNonna();
loadLevel(1);
requestAnimationFrame(loop);
showMenu();
