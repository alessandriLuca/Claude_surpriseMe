// L'Affettatrice: arcade da giocare da soli. Dal fondo del tagliere volano
// salumi, formaggi e verdure: striscia il dito per affettarli al volo.
// Non farne cadere nessuno e non toccare i petardi!

import { saveSettings, settings, sfx, unlockAudio } from "./audio.js";
import { confetti } from "./fx.js";
import { initNonna, nonnaSay } from "./nonna.js";
import { h, storage, toast } from "./ui.js";

// ------------------------------------------------------------------ catalogo

const FOODS = [
  { e: "🍅", juice: "#e63946" },
  { e: "🍆", juice: "#b48ad1" },
  { e: "🧀", juice: "#ffd166" },
  { e: "🍋", juice: "#fff176" },
  { e: "🍉", juice: "#ff5d73" },
  { e: "🍑", juice: "#ffb38a" },
  { e: "🍐", juice: "#d4e157" },
  { e: "🍊", juice: "#ffa62b" },
  { e: "🥒", juice: "#9ccc65" },
  { e: "🫑", juice: "#66bb6a" },
  { e: "🧅", juice: "#f3e5f5" },
  { e: "🥖", juice: "#e0b06a" },
  { e: "🍕", juice: "#f4a261" },
  { e: "🥥", juice: "#ffffff" },
  { e: "🍈", juice: "#c5e1a5" },
];
const GOLD = { e: "🍷", juice: "#9d0208", points: 5, gold: true };
const BOMB = { e: "🧨", bomb: true };

const NONNA_LINES = {
  start: ["Affetta, affetta! Come il salame a Natale.", "Occhio ai petardi, che quelli non si mangiano!", "Vediamo se sei più veloce della mia affettatrice."],
  combo: ["Che mano! Sembri il salumiere del paese!", "Zac zac zac! Bravo!", "Così si affetta!"],
  miss: ["Ti è caduto per terra! Ai miei tempi si raccoglieva.", "Spreco! Con la fame che c'è nel mondo!"],
  bomb: ["Ma sei matto? Quello era un petardo!", "BOOM! Ti sei bruciato le sopracciglia!"],
  over: ["Vabbè, la prossima volta va meglio.", "Non male. Ma io alla tua età facevo il doppio.", "Basta così, che si fredda la cena."],
  record: ["Nuovo record! Chiamate il giornale del paese!", "Record! Ti meriti una fetta di torta."],
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// ------------------------------------------------------------------ stato

const cv = document.getElementById("board");
const g = cv.getContext("2d");
let W = 0;
let H = 0;
let DPR = 1;
let S = 1; // scala dei pezzi

let items = [];
let halves = [];
let drops = [];
let popups = [];
let trail = [];
let running = false;
let paused = false;
let score = 0;
let lives = 3;
let level = 0;
let elapsed = 0;
let spawnTimer = 0;
let startedAt = 0;
let flash = 0;
let shakeT = 0;
let pointerDown = false;
let swipe = { count: 0, t: 0, x: 0, y: 0 };
let lastT = 0;
let best = storage.get("aff:best", 0);
let maxCombo = 0;

function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = innerWidth;
  H = innerHeight;
  cv.width = Math.round(W * DPR);
  cv.height = Math.round(H * DPR);
  cv.style.width = W + "px";
  cv.style.height = H + "px";
  S = Math.max(0.75, Math.min(1.35, Math.min(W, H) / 640));
  drawBoard.cache = null;
}

// ------------------------------------------------------------------ tagliere

function drawBoard() {
  if (!drawBoard.cache || drawBoard.cache.width !== cv.width) {
    const c = document.createElement("canvas");
    c.width = cv.width;
    c.height = cv.height;
    const b = c.getContext("2d");
    const grad = b.createLinearGradient(0, 0, c.width, c.height);
    grad.addColorStop(0, "#b9824f");
    grad.addColorStop(0.5, "#a46d3c");
    grad.addColorStop(1, "#8c5a2e");
    b.fillStyle = grad;
    b.fillRect(0, 0, c.width, c.height);
    // venature del legno
    b.globalAlpha = 0.12;
    for (let i = 0; i < 60; i++) {
      b.strokeStyle = i % 3 ? "#5a3515" : "#e8b98a";
      b.lineWidth = (1 + Math.random() * 3) * DPR;
      b.beginPath();
      const y = Math.random() * c.height;
      b.moveTo(0, y);
      for (let x = 0; x <= c.width; x += 40 * DPR) b.lineTo(x, y + Math.sin(x / (90 * DPR) + i) * 8 * DPR);
      b.stroke();
    }
    // segni di coltello
    b.globalAlpha = 0.08;
    b.strokeStyle = "#2b1606";
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * c.width;
      const y = Math.random() * c.height;
      const a = Math.random() * Math.PI;
      const l = (20 + Math.random() * 60) * DPR;
      b.lineWidth = 1.2 * DPR;
      b.beginPath();
      b.moveTo(x, y);
      b.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      b.stroke();
    }
    // vignetta
    b.globalAlpha = 1;
    const v = b.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.max(c.width, c.height) * 0.75);
    v.addColorStop(0, "rgba(0,0,0,0)");
    v.addColorStop(1, "rgba(20,8,0,0.55)");
    b.fillStyle = v;
    b.fillRect(0, 0, c.width, c.height);
    drawBoard.cache = c;
  }
  g.drawImage(drawBoard.cache, 0, 0);
}

// ------------------------------------------------------------------ pezzi

function gravity() {
  return H * 1.25;
}

function spawn(kind) {
  const r = 38 * S;
  const x = W * (0.15 + Math.random() * 0.7);
  const peak = H * (0.18 + Math.random() * 0.32); // altezza raggiunta (dall'alto)
  const vy = -Math.sqrt(2 * gravity() * (H + r - peak));
  const tx = W * (0.25 + Math.random() * 0.5);
  const flight = (2 * -vy) / gravity();
  const vx = ((tx - x) / flight) * 1.6;
  items.push({ ...kind, x, y: H + r, vx, vy, r, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 5, born: elapsed });
}

function wave() {
  const n = 1 + Math.floor(Math.random() * (1 + Math.min(4, level)));
  const bombChance = Math.min(0.28, 0.06 + level * 0.03);
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      if (!running) return;
      const roll = Math.random();
      if (roll < bombChance && elapsed > 4) spawn(BOMB);
      else if (roll > 0.965) spawn(GOLD);
      else spawn(pick(FOODS));
    }, i * (120 + Math.random() * 180));
  }
  sfx("pop");
}

function drawEmoji(e, x, y, r, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.font = `${r * 2}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(e, 0, r * 0.08);
  g.restore();
}

function slice(it, ax, ay) {
  it.cut = true;
  // direzione del taglio → le due metà si allontanano in perpendicolare
  const len = Math.hypot(ax, ay) || 1;
  const dx = ax / len;
  const dy = ay / len;
  const px = -dy;
  const py = dx;
  const ang = Math.atan2(dy, dx);
  for (const side of [-1, 1]) {
    halves.push({
      e: it.e,
      x: it.x,
      y: it.y,
      r: it.r,
      rot: it.rot,
      cutAng: ang - it.rot,
      side,
      vx: it.vx * 0.5 + px * side * 160 * S,
      vy: it.vy * 0.4 + py * side * 160 * S - 80 * S,
      vr: it.vr + side * 3,
      life: 0,
    });
  }
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (80 + Math.random() * 320) * S;
    drops.push({ x: it.x, y: it.y, vx: Math.cos(a) * sp + dx * 120 * S, vy: Math.sin(a) * sp, r: (2 + Math.random() * 5) * S, c: it.juice, life: 0 });
  }
  // macchia sul tagliere
  drops.push({ x: it.x, y: it.y, vx: 0, vy: 0, r: it.r * 0.9, c: it.juice, life: 0, stain: true });
}

function explode(it) {
  it.cut = true;
  flash = 1;
  shakeT = 0.45;
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = (150 + Math.random() * 600) * S;
    drops.push({ x: it.x, y: it.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: (2 + Math.random() * 6) * S, c: Math.random() < 0.5 ? "#ffd166" : "#ff5d00", life: 0 });
  }
  sfx("burn");
  buzz(300);
  popup(it.x, it.y, "BOOM! 💥", "#ff5d00", 1.4);
  nonnaSay(pick(NONNA_LINES.bomb), "angry");
  loseLife();
}

function popup(x, y, text, color = "#fff", size = 1) {
  popups.push({ x, y, text, color, size, life: 0 });
}

function buzz(ms) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* niente */
  }
}

function loseLife() {
  lives--;
  renderLives();
  if (lives <= 0) gameOver();
}

// ------------------------------------------------------------------ input

function segmentHits(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx - x1) * dx + (cy - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const qx = x1 + t * dx - cx;
  const qy = y1 + t * dy - cy;
  return qx * qx + qy * qy <= r * r;
}

function onMove(x, y) {
  const now = performance.now();
  const prev = trail[trail.length - 1];
  trail.push({ x, y, t: now });
  if (!prev || !running || paused) return;
  const dist = Math.hypot(x - prev.x, y - prev.y);
  if (dist < 4) return;
  for (const it of items) {
    if (it.cut) continue;
    if (!segmentHits(prev.x, prev.y, x, y, it.x, it.y, it.r * 0.9)) continue;
    if (it.bomb) {
      explode(it);
      continue;
    }
    slice(it, x - prev.x, y - prev.y);
    const pts = it.points ?? 1;
    score += pts;
    if (it.gold) {
      popup(it.x, it.y, "+5 🍷", "#ffd166", 1.2);
      sfx("correct");
    } else {
      sfx("click");
    }
    // combo: tagli nello stesso gesto
    if (now - swipe.t > 260) swipe.count = 0;
    swipe.count++;
    swipe.t = now;
    swipe.x = it.x;
    swipe.y = it.y;
    if (swipe.count >= 3) {
      score += 1;
      if (swipe.count > maxCombo) maxCombo = swipe.count;
      if (swipe.count === 3) {
        sfx("sweep");
        nonnaSay(pick(NONNA_LINES.combo), "proud");
      }
      popup(it.x, it.y - it.r, `COMBO x${swipe.count}!`, "#ffc43d", 1 + Math.min(0.6, swipe.count * 0.08));
    }
    renderScore();
  }
}

function pointer(e) {
  const r = cv.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

cv.addEventListener("pointerdown", (e) => {
  unlockAudio();
  pointerDown = true;
  trail = [];
  cv.setPointerCapture(e.pointerId);
  const [x, y] = pointer(e);
  onMove(x, y);
});
cv.addEventListener("pointermove", (e) => {
  if (!pointerDown && e.pointerType !== "mouse") return;
  if (!pointerDown) {
    // col mouse si affetta anche senza tenere premuto, purché ci si muova veloce
    const [x, y] = pointer(e);
    const prev = trail[trail.length - 1];
    if (prev && performance.now() - prev.t < 40 && Math.hypot(x - prev.x, y - prev.y) > 12) onMove(x, y);
    else trail = [{ x, y, t: performance.now() }];
    return;
  }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of evs) {
    const [x, y] = pointer(ev);
    onMove(x, y);
  }
});
const up = () => {
  pointerDown = false;
};
cv.addEventListener("pointerup", up);
cv.addEventListener("pointercancel", up);

// ------------------------------------------------------------------ ciclo

function update(dt) {
  elapsed += dt;
  level = Math.floor(elapsed / 15);
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    wave();
    spawnTimer = Math.max(0.75, 1.9 - level * 0.18) + Math.random() * 0.5;
  }
  const G = gravity();
  for (const it of items) {
    it.vy += G * dt;
    it.x += it.vx * dt;
    it.y += it.vy * dt;
    it.rot += it.vr * dt;
    if (it.x < it.r && it.vx < 0) it.vx *= -0.6;
    if (it.x > W - it.r && it.vx > 0) it.vx *= -0.6;
    if (!it.cut && it.vy > 0 && it.y > H + it.r * 1.5) {
      it.gone = true;
      if (!it.bomb && running) {
        popup(Math.max(30, Math.min(W - 30, it.x)), H - 40, "✗", "#ff3b3b", 1.6);
        sfx("fail");
        buzz(120);
        if (Math.random() < 0.5) nonnaSay(pick(NONNA_LINES.miss), "angry");
        loseLife();
      }
    }
  }
  items = items.filter((it) => !it.cut && !it.gone);
  for (const hv of halves) {
    hv.vy += G * dt;
    hv.x += hv.vx * dt;
    hv.y += hv.vy * dt;
    hv.rot += hv.vr * dt;
    hv.life += dt;
  }
  halves = halves.filter((hv) => hv.y < H + 120 && hv.life < 4);
  for (const d of drops) {
    d.life += dt;
    if (!d.stain) {
      d.vy += G * 0.6 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
    }
  }
  drops = drops.filter((d) => (d.stain ? d.life < 2.2 : d.life < 1.1));
  for (const p of popups) {
    p.life += dt;
    p.y -= 40 * dt;
  }
  popups = popups.filter((p) => p.life < 1.1);
  flash = Math.max(0, flash - dt * 2.5);
  shakeT = Math.max(0, shakeT - dt);
}

function render() {
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawBoard();
  // tremolio dopo un'esplosione
  const ox = shakeT > 0 ? (Math.random() - 0.5) * 24 * shakeT : 0;
  const oy = shakeT > 0 ? (Math.random() - 0.5) * 24 * shakeT : 0;
  g.setTransform(DPR, 0, 0, DPR, ox * DPR, oy * DPR);

  // macchie
  for (const d of drops) {
    if (!d.stain) continue;
    g.globalAlpha = 0.35 * (1 - d.life / 2.2);
    g.fillStyle = d.c;
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // pezzi interi
  for (const it of items) {
    if (it.bomb) {
      // alone rosso pulsante sui petardi
      g.globalAlpha = 0.35 + 0.25 * Math.sin(elapsed * 14);
      g.fillStyle = "#ff3b3b";
      g.beginPath();
      g.arc(it.x, it.y, it.r * 1.15, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    if (it.gold) {
      g.globalAlpha = 0.45;
      g.fillStyle = "#ffd166";
      g.beginPath();
      g.arc(it.x, it.y, it.r * 1.25, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    drawEmoji(it.e, it.x, it.y, it.r, it.rot);
  }

  // metà tagliate
  for (const hv of halves) {
    g.save();
    g.translate(hv.x, hv.y);
    g.rotate(hv.rot);
    g.beginPath();
    // semipiano dal lato giusto della linea di taglio
    const a = hv.cutAng;
    const R = hv.r * 2;
    g.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    g.lineTo(Math.cos(a + (Math.PI / 2) * hv.side) * R + Math.cos(a) * R, Math.sin(a + (Math.PI / 2) * hv.side) * R + Math.sin(a) * R);
    g.lineTo(Math.cos(a + (Math.PI / 2) * hv.side) * R - Math.cos(a) * R, Math.sin(a + (Math.PI / 2) * hv.side) * R - Math.sin(a) * R);
    g.lineTo(-Math.cos(a) * R, -Math.sin(a) * R);
    g.closePath();
    g.clip();
    g.font = `${hv.r * 2}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(hv.e, 0, hv.r * 0.08);
    g.restore();
  }

  // schizzi
  for (const d of drops) {
    if (d.stain) continue;
    g.globalAlpha = 1 - d.life / 1.1;
    g.fillStyle = d.c;
    g.beginPath();
    g.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;

  // lama
  const now = performance.now();
  trail = trail.filter((p) => now - p.t < 140);
  if (trail.length > 1) {
    for (let i = 1; i < trail.length; i++) {
      const a = trail[i - 1];
      const b = trail[i];
      const k = i / trail.length;
      g.strokeStyle = `rgba(255,255,255,${0.15 + 0.75 * k})`;
      g.lineWidth = 2 + 9 * k;
      g.lineCap = "round";
      g.shadowColor = "rgba(180,220,255,.9)";
      g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
    }
    g.shadowBlur = 0;
  }

  // scritte
  for (const p of popups) {
    g.globalAlpha = 1 - p.life / 1.1;
    g.font = `${Math.round(30 * p.size * S)}px "Lilita One", sans-serif`;
    g.textAlign = "center";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(40,10,0,.75)";
    g.strokeText(p.text, p.x, p.y);
    g.fillStyle = p.color;
    g.fillText(p.text, p.x, p.y);
  }
  g.globalAlpha = 1;

  if (flash > 0) {
    g.fillStyle = `rgba(255,240,200,${flash * 0.8})`;
    g.fillRect(-30, -30, W + 60, H + 60);
  }
}

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
  lastT = t;
  if (running && !paused) update(dt);
  else if (!running) {
    // in menu i pezzi continuano a cadere per bellezza
    elapsed += dt;
    for (const it of items) {
      it.vy += gravity() * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      it.rot += it.vr * dt;
    }
    items = items.filter((it) => it.y < H + 200);
    for (const hv of halves) {
      hv.vy += gravity() * dt;
      hv.x += hv.vx * dt;
      hv.y += hv.vy * dt;
      hv.rot += hv.vr * dt;
    }
    halves = halves.filter((hv) => hv.y < H + 120);
    update.menuT = (update.menuT ?? 0) - dt;
    if (update.menuT <= 0 && items.length < 4) {
      spawn(pick(FOODS));
      update.menuT = 0.9;
    }
    for (const d of drops) {
      d.life += dt;
      if (!d.stain) {
        d.vy += gravity() * 0.6 * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
    }
    drops = drops.filter((d) => (d.stain ? d.life < 2.2 : d.life < 1.1));
    // in menu si può affettare per gioco
    for (const p of popups) p.life += dt;
    popups = popups.filter((p) => p.life < 1.1);
  }
  render();
}

// menu: anche lì si affetta (senza punti)
const menuSlice = (x, y) => {
  const prev = trail[trail.length - 2];
  if (!prev || running) return;
  for (const it of items) {
    if (!it.cut && segmentHits(prev.x, prev.y, x, y, it.x, it.y, it.r)) {
      slice(it, x - prev.x, y - prev.y);
      sfx("click");
    }
  }
  items = items.filter((it) => !it.cut);
};
cv.addEventListener("pointermove", (e) => {
  if (running || !pointerDown) return;
  const [x, y] = pointer(e);
  menuSlice(x, y);
});

// ------------------------------------------------------------------ HUD e schermate

const hud = document.getElementById("hud");
const overlay = document.getElementById("overlay");
const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");

function renderScore() {
  scoreEl.textContent = String(score);
  scoreEl.classList.remove("bump");
  void scoreEl.offsetWidth;
  scoreEl.classList.add("bump");
}

function renderLives() {
  livesEl.replaceChildren(...[0, 1, 2].map((i) => h("span" + (i < lives ? "" : ".lost"), "🍝")));
}

function start() {
  unlockAudio();
  items = [];
  halves = [];
  drops = [];
  popups = [];
  score = 0;
  lives = 3;
  level = 0;
  elapsed = 0;
  maxCombo = 0;
  spawnTimer = 0.8;
  startedAt = performance.now();
  running = true;
  paused = false;
  overlay.replaceChildren();
  overlay.classList.add("hidden");
  hud.classList.remove("hidden");
  renderScore();
  renderLives();
  sfx("start");
  nonnaSay(pick(NONNA_LINES.start), "happy");
}

function gameOver() {
  if (!running) return;
  running = false;
  const ms = Math.round(performance.now() - startedAt);
  const record = score > best;
  if (record) {
    best = score;
    storage.set("aff:best", best);
  }
  sfx(record ? "final" : "fail");
  if (record && score > 0) {
    confetti(200);
    nonnaSay(pick(NONNA_LINES.record), "proud");
  } else nonnaSay(pick(NONNA_LINES.over), "sly");
  setTimeout(() => showOver(ms, record), 700);
}

async function fetchTop() {
  try {
    const r = await fetch("/api/affettatrice/top");
    if (r.ok) return await r.json();
  } catch {
    /* offline */
  }
  return { all: [], today: [] };
}

function boardList(list, highlight) {
  if (!list.length) return h("p.muted", { style: { margin: "6px 0" } }, "Ancora nessuno. Il primo posto è tuo!");
  return h(
    "ol.aff-board",
    list.slice(0, 10).map((e, i) =>
      h("li" + (highlight && e.name.toLowerCase() === highlight.toLowerCase() ? ".me" : ""), h("span.pos", i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1)), h("span.av", e.avatar), h("span.nm", e.name), h("b", String(e.score))),
    ),
  );
}

function boards(data, me) {
  let tab = storage.get("aff:tab", "today");
  const box = h("div");
  const tabs = h("div.seg");
  const paint = () => {
    tabs.replaceChildren(
      h("button" + (tab === "today" ? ".sel" : ""), { type: "button", onclick: () => ((tab = "today"), storage.set("aff:tab", tab), paint()) }, "Oggi"),
      h("button" + (tab === "all" ? ".sel" : ""), { type: "button", onclick: () => ((tab = "all"), storage.set("aff:tab", tab), paint()) }, "Di sempre"),
    );
    box.replaceChildren(boardList(tab === "today" ? data.today : data.all, me));
  };
  paint();
  return h("div", h("div.row", { style: { justifyContent: "space-between", margin: "4px 0 6px" } }, h("h3", "🏆 Classifica"), tabs), box);
}

async function showMenu() {
  hud.classList.add("hidden");
  overlay.classList.remove("hidden");
  const data = await fetchTop();
  overlay.replaceChildren(
    h(
      "div.card.checkered.aff-card",
      h("div.aff-logo", "L'Affettatrice"),
      h("p.aff-tag", "Affetta al volo tutto quello che salta fuori dal tagliere."),
      h(
        "ul.aff-rules",
        h("li", "👆 Striscia il dito (o il mouse) per affettare."),
        h("li", "🍝 Se lasci cadere 3 cose, è finita."),
        h("li", "🧨 Non toccare i petardi!"),
        h("li", "🍷 Il vino vale 5 punti. Più tagli in un colpo solo = combo."),
      ),
      best ? h("p.aff-best", "Il tuo record: ", h("b", String(best))) : null,
      h("button.btn.block.green", { onclick: start }, "🔪 Affetta!"),
      boards(data, storage.get("name", "")),
      h("a.btn.ghost.small.block", { href: "/", style: { marginTop: "12px" } }, "← Torna alla Sagra"),
    ),
  );
}

async function showOver(ms, record) {
  hud.classList.add("hidden");
  overlay.classList.remove("hidden");
  const name = h("input.field", { placeholder: "Il tuo nome", maxLength: 18, value: storage.get("name", ""), "aria-label": "Il tuo nome" });
  const avatar = storage.get("avatar", "🔪");
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
          const r = await fetch("/api/affettatrice/score", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: n, avatar, score, ms }),
          });
          const j = await r.json();
          if (!j.ok) {
            toast(j.error || "Non sono riuscito a salvare.", "err");
            sendBtn.disabled = false;
            return;
          }
          if (j.rankToday) toast(`Sei ${j.rankToday}° nella classifica di oggi! 🎉`);
          else toast("Salvato! Per entrare in classifica serve qualche fetta in più.");
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
      h("div.aff-over", record && score > 0 ? "NUOVO RECORD!" : "Fine dei giochi!"),
      h("div.aff-final", String(score)),
      h("p.center.muted", { style: { marginTop: 0 } }, `${(ms / 1000).toFixed(0)} secondi · combo migliore x${Math.max(maxCombo, 1)} · record ${best}`),
      score > 0 ? h("div.row", { style: { flexWrap: "nowrap" } }, h("div.grow", name), sendBtn) : null,
      h("div.row", { style: { marginTop: "12px" } }, h("button.btn.green.grow", { onclick: start }, "🔁 Rigioca"), h("button.btn.ghost", { onclick: showMenu }, "Menu")),
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
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && running) {
    paused = !paused;
    toast(paused ? "Pausa ⏸️ (Esc per riprendere)" : "Si riparte!");
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && running) paused = true;
  else if (!document.hidden && running && paused) toast("Pausa ⏸️ — premi Esc o tocca per riprendere");
});
cv.addEventListener("pointerdown", () => {
  if (running && paused) paused = false;
});

window.__aff = {
  get state() {
    return { running, score, lives, items: items.map((i) => ({ x: i.x, y: i.y, r: i.r, bomb: !!i.bomb, vy: i.vy })) };
  },
  start,
  gameOver,
};

addEventListener("resize", resize);
resize();
initNonna();
renderLives();
requestAnimationFrame(loop);
showMenu();
