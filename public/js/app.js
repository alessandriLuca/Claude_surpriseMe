import { saveSettings, settings, setMusic, sfx, unlockAudio } from "./audio.js";
import { confetti, drawLights, floatEmoji } from "./fx.js";
import { Net } from "./net.js";
import { initNonna, nonnaSay, nonnaSilence } from "./nonna.js";
import { BETWEEN } from "./screens/between.js";
import { BOTTA } from "./screens/botta.js";
import { BUGIARDO } from "./screens/bugiardo.js";
import { CHI } from "./screens/chi.js";
import { ESPRESSO } from "./screens/espresso.js";
import { renderHome } from "./screens/home.js";
import { LOBBY } from "./screens/lobby.js";
import { PIGIATURA } from "./screens/pigiatura.js";
import { PITTORE } from "./screens/pittore.js";
import { buzz, clear, h, storage, toast } from "./ui.js";

const GAME_SCREENS = { espresso: ESPRESSO, botta: BOTTA, pittore: PITTORE, chi: CHI, bugiardo: BUGIARDO, pigiatura: PIGIATURA };
const REACTIONS = ["🤌", "😂", "👏", "🍕", "😱", "🔥", "💩", "❤️"];

export const app = {
  net: null,
  code: null,
  st: null,
  hello: null,
  you: null,
  spectator: false,
  screen: null, // { key, api }
  drawLog: [],
  root: document.getElementById("app"),
  get isHost() {
    return !!this.st && this.st.hostId === this.you;
  },
  get me() {
    return this.st?.players.find((p) => p.id === this.you) ?? null;
  },
  send(obj) {
    this.net?.send(obj);
  },
  act(obj) {
    this.send({ t: "act", ...obj });
  },
  toLocal(ts) {
    return this.net ? this.net.toLocal(ts) : ts;
  },
  serverNow() {
    return this.net ? this.net.serverNow() : Date.now();
  },
  goHome,
  joinRoom,
};

window.__sagra = app; // utile per il debug e per i test end-to-end

// ------------------------------------------------------------------ avvio

function boot() {
  drawLights();
  initNonna();
  setupTopbar();
  setupReactions();
  requestAnimationFrame(timerLoop);
  document.addEventListener("pointerdown", unlockAudio, { once: false, passive: true });
  document.addEventListener("keydown", unlockAudio, { once: true });
  // quando si scrive (tastiera aperta sul telefono) la barra delle reazioni si toglie di mezzo
  document.addEventListener("focusin", (e) => {
    if (e.target.matches("input, textarea")) document.body.classList.add("typing");
  });
  document.addEventListener("focusout", () => document.body.classList.remove("typing"));

  const m = location.pathname.match(/^\/([A-Za-z]{4})\/?$/);
  const params = new URLSearchParams(location.search);
  if (m) {
    const code = m[1].toUpperCase();
    if (params.get("tv") === "1") return joinRoom(code, { spectator: true });
    if (getToken(code, false).token) return joinRoom(code, { name: storage.get("name", ""), avatar: storage.get("avatar") });
    return renderHome(app, code);
  }
  renderHome(app);
}

function goHome() {
  app.net?.close();
  app.net = null;
  app.st = null;
  app.code = null;
  app.you = null;
  app.screen?.api?.destroy?.();
  app.screen = null;
  document.body.classList.remove("tv");
  document.getElementById("codePill").classList.add("hidden");
  document.getElementById("btnScores").classList.add("hidden");
  document.getElementById("reactBar").classList.add("hidden");
  document.getElementById("connBanner").classList.add("hidden");
  hideTimer();
  history.replaceState(null, "", "/");
  setMusic(false);
  nonnaSilence();
  renderHome(app);
}

/** Entra in una stanza. opts: { name, avatar, spectator } */
function joinRoom(code, opts) {
  app.net?.close();
  app.code = code;
  app.spectator = !!opts.spectator;
  document.body.classList.toggle("tv", app.spectator);
  history.replaceState(null, "", "/" + code + (app.spectator ? "?tv=1" : ""));
  const pill = document.getElementById("codePill");
  pill.textContent = code;
  pill.classList.remove("hidden");
  document.getElementById("btnScores").classList.remove("hidden");
  if (!app.spectator) document.getElementById("reactBar").classList.remove("hidden");

  clear(app.root).appendChild(h("div.big-wait.on-night", h("div.e", "🍝"), h("h2", "Apparecchio la tavola…")));

  const net = new Net(code);
  app.net = net;
  net.addEventListener("open", () => {
    document.getElementById("connBanner").classList.add("hidden");
    const { token, source } = getToken(code, app.spectator);
    if (token) net.send({ t: "join", token, tokenSource: source, spectator: app.spectator, name: opts.name, avatar: opts.avatar });
    else if (app.spectator) net.send({ t: "join", spectator: true });
    else net.send({ t: "join", name: opts.name, avatar: opts.avatar });
  });
  net.addEventListener("down", () => document.getElementById("connBanner").classList.remove("hidden"));
  net.addEventListener("fatal", (e) => {
    toast(e.detail, "err");
    forgetToken(code);
    goHome();
  });
  net.addEventListener("msg", (e) => onMessage(e.detail));
  net.connect();
}

// ------------------------------------------------------------------ token

// Il token di ogni scheda sta in sessionStorage (così due schede sono due giocatori);
// una copia in localStorage permette di rientrare dopo aver chiuso il browser.
function tokenKey(code, spectator) {
  return (spectator ? "tv:" : "tok:") + code;
}

function getToken(code, spectator) {
  const k = tokenKey(code, spectator);
  try {
    const t = sessionStorage.getItem("sagra:" + k);
    if (t) return { token: t, source: "session" };
  } catch {
    /* niente */
  }
  const t = storage.get(k);
  return t ? { token: t, source: "local" } : { token: null, source: null };
}

function saveToken(code, spectator, token) {
  const k = tokenKey(code, spectator);
  try {
    sessionStorage.setItem("sagra:" + k, token);
  } catch {
    /* niente */
  }
  storage.set(k, token);
}

function forgetToken(code) {
  for (const sp of [false, true]) {
    const k = tokenKey(code, sp);
    try {
      sessionStorage.removeItem("sagra:" + k);
    } catch {
      /* niente */
    }
    storage.del(k);
  }
}

// ------------------------------------------------------------------ messaggi

function onMessage(m) {
  switch (m.t) {
    case "hello":
      app.hello = m;
      break;
    case "joined":
      app.you = m.id;
      saveToken(app.code, app.spectator, m.token);
      if (!app.spectator) storage.set("lastRoom", app.code);
      break;
    case "state": {
      const prev = app.st;
      app.st = m;
      app.you = m.you;
      onState(prev, m);
      break;
    }
    case "nonna":
      nonnaSay(m.text, m.mood);
      break;
    case "fx":
      sfx(m.name);
      if (m.name === "final") confetti(260);
      if (m.name === "sweep") confetti(120);
      if (m.name === "correct") buzz(40);
      if (m.name === "burn") buzz(200);
      break;
    case "react": {
      const p = app.st?.players.find((x) => x.id === m.from);
      floatEmoji(m.emoji, p?.name);
      sfx("pop");
      break;
    }
    case "toast":
      toast(m.text);
      break;
    case "err":
      toast(m.msg, "err");
      if (m.fatal) {
        forgetToken(app.code);
        goHome();
      } else if (!app.st) {
        // join rifiutato: torna alla home col codice precompilato
        const code = app.code;
        app.net?.close();
        app.net = null;
        renderHome(app, code);
      }
      break;
    case "kicked":
      toast("Sei stato accompagnato alla porta dall'host. 🚪", "err");
      forgetToken(app.code);
      goHome();
      break;
    case "redraw":
      // teniamo un registro del disegno corrente: serve a chi monta la schermata dopo
      app.drawLog = [m];
      app.screen?.api?.onMsg?.(m);
      break;
    case "draw":
      app.drawLog.push(m);
      app.screen?.api?.onMsg?.(m);
      break;
    default:
      app.screen?.api?.onMsg?.(m);
  }
}

function screenFor(st) {
  switch (st.phase) {
    case "lobby":
      return { key: "lobby", mod: LOBBY };
    case "intro":
    case "interlude":
    case "final":
      return { key: st.phase + ":" + st.gameIndex, mod: BETWEEN };
    case "playing": {
      const mod = GAME_SCREENS[st.game?.kind];
      if (!mod) return { key: "loading", mod: BETWEEN };
      return { key: "game:" + st.game.kind + ":" + mod.key(st.game), mod };
    }
  }
  return { key: "?", mod: BETWEEN };
}

function onState(prev, st) {
  const { key, mod } = screenFor(st);
  if (!app.screen || app.screen.key !== key) {
    app.screen?.api?.destroy?.();
    clear(app.root);
    const api = mod.mount(app.root, app, st) || {};
    app.screen = { key, api };
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    app.screen.api.update?.(st, prev);
  }
  // musica solo fuori dai giochi
  setMusic(st.phase !== "playing");
  updateSideScores();
}

// ------------------------------------------------------------------ timer globale

let lastSec = null;
function timerLoop() {
  requestAnimationFrame(timerLoop);
  const bar = document.getElementById("timer");
  const cd = document.getElementById("countdown");
  const st = app.st;
  if (!st || !st.deadline) {
    hideTimer();
    return;
  }
  if (!timerLoop.start || timerLoop.deadline !== st.deadline) {
    timerLoop.deadline = st.deadline;
    timerLoop.start = app.serverNow();
  }
  const left = Math.max(0, st.deadline - app.serverNow());
  const total = Math.max(1, st.deadline - timerLoop.start);
  bar.classList.remove("hidden");
  cd.classList.remove("hidden");
  bar.style.width = (100 * left) / total + "%";
  const sec = Math.ceil(left / 1000);
  cd.textContent = sec;
  cd.classList.toggle("hurry", sec <= 5 && sec > 0 && st.phase === "playing");
  if (sec !== lastSec) {
    if (sec <= 5 && sec > 0 && st.phase === "playing") sfx("tick");
    lastSec = sec;
  }
}

function hideTimer() {
  document.getElementById("timer").classList.add("hidden");
  document.getElementById("countdown").classList.add("hidden");
  timerLoop.start = null;
}

// ------------------------------------------------------------------ barra in alto

function setupTopbar() {
  const bs = document.getElementById("btnSound");
  const bm = document.getElementById("btnMusic");
  const bv = document.getElementById("btnVoice");
  const paint = () => {
    bs.classList.toggle("off", !settings.sfx);
    bm.classList.toggle("off", !settings.music);
    bv.classList.toggle("off", !settings.voice);
    bs.textContent = settings.sfx ? "🔊" : "🔇";
  };
  paint();
  bs.onclick = () => {
    settings.sfx = !settings.sfx;
    saveSettings();
    paint();
    unlockAudio();
    sfx("click");
  };
  bm.onclick = () => {
    settings.music = !settings.music;
    saveSettings();
    paint();
    unlockAudio();
    setMusic(!app.st || app.st.phase !== "playing");
  };
  bv.onclick = () => {
    settings.voice = !settings.voice;
    saveSettings();
    paint();
    if (!settings.voice) nonnaSilence();
    else nonnaSay("Eccomi! Adesso mi senti?", "happy");
  };
  document.getElementById("brand").onclick = () => {
    if (!app.code || confirm("Vuoi davvero lasciare la tavolata?")) goHome();
  };
  const side = document.getElementById("sideScores");
  document.getElementById("btnScores").onclick = () => {
    side.classList.toggle("open");
    updateSideScores();
  };
  side.onclick = () => side.classList.remove("open");
}

function updateSideScores() {
  const side = document.getElementById("sideScores");
  if (!side.classList.contains("open") || !app.st) return;
  const ranked = app.st.players.slice().sort((a, b) => b.score - a.score);
  clear(side).append(
    h("h2", { style: { color: "var(--gold)" } }, "🏆 Classifica"),
    h(
      "div.scoreboard",
      ranked.map((p, i) =>
        h(
          "div.srow",
          h("span.pos", String(i + 1)),
          h("span.av", p.avatar),
          h("span.nm", p.name + (p.id === app.you ? " (tu)" : "")),
          h("span.pts", String(p.score)),
        ),
      ),
    ),
    h("p.muted.light", { style: { marginTop: "16px" } }, "Tocca per chiudere"),
  );
}

function setupReactions() {
  const bar = document.getElementById("reactBar");
  let last = 0;
  for (const e of REACTIONS) {
    bar.appendChild(
      h("button", {
        title: "Reazione " + e,
        onclick: () => {
          const now = Date.now();
          if (now - last < 600) return; // niente spam
          last = now;
          app.send({ t: "react", emoji: e });
        },
      }, e),
    );
  }
}

boot();
