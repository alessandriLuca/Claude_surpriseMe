// Nonna Pina: la presentatrice. Un SVG disegnato a mano, una nuvoletta
// e (se il browser lo permette) la voce sintetizzata in italiano.

import { settings } from "./audio.js";

const MOUTHS = {
  happy: '<path d="M40 70 Q50 80 60 70" stroke="#7a2b2b" stroke-width="3" fill="#c0392b" stroke-linecap="round"/>',
  proud: '<path d="M38 68 Q50 84 62 68 Z" fill="#7a2b2b"/><path d="M42 70 Q50 74 58 70" fill="#fff"/>',
  angry: '<path d="M40 75 Q50 67 60 75" stroke="#7a2b2b" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  shock: '<ellipse cx="50" cy="73" rx="6" ry="8" fill="#7a2b2b"/>',
  sly: '<path d="M40 72 Q52 78 62 68" stroke="#7a2b2b" stroke-width="3" fill="none" stroke-linecap="round"/>',
  talk: '<ellipse cx="50" cy="72" rx="8" ry="5" fill="#7a2b2b"/>',
};

const BROWS = {
  happy: '<path d="M30 42 Q36 38 42 41M58 41 Q64 38 70 42" stroke="#9e9e9e" stroke-width="3" fill="none" stroke-linecap="round"/>',
  proud: '<path d="M30 40 Q36 35 42 39M58 39 Q64 35 70 40" stroke="#9e9e9e" stroke-width="3" fill="none" stroke-linecap="round"/>',
  angry: '<path d="M30 38 L43 44M57 44 L70 38" stroke="#757575" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  shock: '<path d="M30 36 Q36 31 42 35M58 35 Q64 31 70 36" stroke="#9e9e9e" stroke-width="3" fill="none" stroke-linecap="round"/>',
  sly: '<path d="M30 42 Q36 40 42 42M58 38 Q64 34 70 38" stroke="#9e9e9e" stroke-width="3" fill="none" stroke-linecap="round"/>',
};

function svg(mood, talking) {
  const mouth = talking ? MOUTHS.talk : MOUTHS[mood] || MOUTHS.happy;
  const brows = BROWS[mood] || BROWS.happy;
  return `<svg viewBox="0 0 100 115" aria-label="Nonna Pina" role="img">
    <!-- scialle -->
    <path d="M14 112 Q16 88 50 86 Q84 88 86 112 Z" fill="#7b2cbf"/>
    <path d="M30 92 L50 112 L70 92" fill="#9d4edd"/>
    <circle cx="50" cy="100" r="3" fill="#ffc43d"/>
    <!-- chignon -->
    <circle cx="50" cy="12" r="11" fill="#d9d9d9" stroke="#bdbdbd" stroke-width="2"/>
    <!-- testa -->
    <ellipse cx="50" cy="55" rx="31" ry="33" fill="#f6c9a8"/>
    <!-- capelli -->
    <path d="M19 52 Q18 20 50 20 Q82 20 81 52 Q76 34 62 30 Q50 38 36 30 Q24 36 19 52 Z" fill="#e0e0e0" stroke="#c4c4c4" stroke-width="1.5"/>
    <!-- orecchini -->
    <circle cx="19" cy="64" r="3.5" fill="#ffc43d"/><circle cx="81" cy="64" r="3.5" fill="#ffc43d"/>
    ${brows}
    <!-- occhiali -->
    <g fill="rgba(255,255,255,.35)" stroke="#4a3426" stroke-width="2.5">
      <circle cx="37" cy="52" r="9"/><circle cx="63" cy="52" r="9"/>
    </g>
    <path d="M46 52 Q50 49 54 52" stroke="#4a3426" stroke-width="2.5" fill="none"/>
    <circle cx="37" cy="53" r="2.8" fill="#2a1b0f"/><circle cx="63" cy="53" r="2.8" fill="#2a1b0f"/>
    <!-- guance -->
    <circle cx="28" cy="66" r="6" fill="#ff8fa3" opacity=".55"/><circle cx="72" cy="66" r="6" fill="#ff8fa3" opacity=".55"/>
    <!-- naso -->
    <path d="M50 56 Q46 64 50 65 Q54 64 52 60" stroke="#d9967a" stroke-width="2" fill="none" stroke-linecap="round"/>
    <!-- neo -->
    <circle cx="64" cy="73" r="1.4" fill="#6d4c41"/>
    ${mouth}
  </svg>`;
}

let el, bubble, face;
let mood = "happy";
let hideTimer = null;
let mouthTimer = null;
let voice = null;
let shownAt = 0;
let pending = null;
let pendingTimer = null;
let token = 0;
const MIN_SHOW_MS = 1700;

function pickVoice() {
  if (!("speechSynthesis" in window)) return null;
  const vs = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("it"));
  // preferisci voci femminili se riconoscibili dal nome
  const fem = vs.find((v) => /alice|elsa|federica|paola|female|donna|google italiano/i.test(v.name));
  return fem || vs[0] || null;
}

export function initNonna() {
  el = document.getElementById("nonna");
  el.innerHTML = "";
  face = document.createElement("div");
  face.innerHTML = svg(mood, false);
  bubble = document.createElement("div");
  bubble.className = "bubble";
  el.appendChild(face);
  el.appendChild(bubble);
  face.addEventListener("click", () => {
    bubble.classList.toggle("show");
  });
  if ("speechSynthesis" in window) {
    voice = pickVoice();
    speechSynthesis.addEventListener?.("voiceschanged", () => (voice = pickVoice()));
  }
}

function setFace(m, talking) {
  face.innerHTML = svg(m, talking);
}

/**
 * La nonna dice sempre l'ultima cosa successa: se una battuta arriva mentre
 * ne sta dicendo un'altra da poco, aspetta un attimo e poi passa alla nuova
 * (le battute intermedie vengono saltate, così non resta mai indietro).
 */
export function nonnaSay(text, m = "happy") {
  if (!el) return;
  const since = Date.now() - shownAt;
  if (since < MIN_SHOW_MS) {
    pending = { text, m };
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      const p = pending;
      pending = null;
      if (p) show(p.text, p.m);
    }, MIN_SHOW_MS - since);
    return;
  }
  show(text, m);
}

function show(text, m) {
  const my = ++token;
  shownAt = Date.now();
  mood = m;
  bubble.textContent = text;
  bubble.classList.add("show");
  el.classList.add("talking");
  clearInterval(mouthTimer);
  clearTimeout(hideTimer);
  let open = false;
  mouthTimer = setInterval(() => {
    open = !open;
    setFace(mood, open);
  }, 140);
  const readMs = Math.min(4500, 1200 + text.length * 45);
  const done = () => {
    if (my !== token) return;
    clearInterval(mouthTimer);
    el.classList.remove("talking");
    setFace(mood, false);
    hideTimer = setTimeout(() => {
      if (my === token) bubble.classList.remove("show");
    }, 2600);
  };
  if (settings.voice && voice && "speechSynthesis" in window) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 1.1;
      u.pitch = 1.25;
      u.onend = done;
      u.onerror = done;
      speechSynthesis.speak(u);
      setTimeout(done, readMs + 5000); // rete di sicurezza
      return;
    } catch {
      /* si passa al timer */
    }
  }
  setTimeout(done, readMs);
}

export function nonnaSilence() {
  pending = null;
  clearTimeout(pendingTimer);
  try {
    if ("speechSynthesis" in window) speechSynthesis.cancel();
  } catch {
    /* niente */
  }
}
