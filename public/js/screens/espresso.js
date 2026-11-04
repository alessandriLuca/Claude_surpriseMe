import { sfx } from "../audio.js";
import { buzz, h } from "../ui.js";
import { gameHead } from "./common.js";

const MOKA = `<svg class="moka" viewBox="0 0 120 160" aria-hidden="true">
  <g class="steam" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" opacity=".9">
    <path d="M46 26 q-6 -8 0 -16 q6 -8 0 -16"/>
    <path d="M60 24 q-6 -8 0 -16 q6 -8 0 -16"/>
    <path d="M74 26 q-6 -8 0 -16 q6 -8 0 -16"/>
  </g>
  <path d="M30 40 L90 40 L80 80 L40 80 Z" fill="#c9ced6" stroke="#59606b" stroke-width="3"/>
  <path d="M30 40 L60 30 L90 40" fill="#aab1bb" stroke="#59606b" stroke-width="3"/>
  <circle cx="60" cy="27" r="5" fill="#2a1b0f"/>
  <path d="M90 46 Q108 52 100 70 L86 70" fill="none" stroke="#2a1b0f" stroke-width="7" stroke-linecap="round"/>
  <path d="M30 42 L18 46 L28 52" fill="#aab1bb" stroke="#59606b" stroke-width="3"/>
  <rect x="38" y="80" width="44" height="8" fill="#59606b"/>
  <path d="M40 88 L80 88 L92 140 L28 140 Z" fill="#c9ced6" stroke="#59606b" stroke-width="3"/>
  <path d="M48 96 L52 132 M60 96 L60 132 M72 96 L68 132" stroke="#9aa1ab" stroke-width="2"/>
  <ellipse cx="60" cy="150" rx="44" ry="7" fill="#1d4ed8" opacity=".85"/>
  <path d="M30 150 q6 -12 10 0 q6 -14 10 0 q6 -12 10 0 q6 -14 10 0 q6 -12 10 0 q6 -14 10 0" fill="#60a5fa"/>
</svg>`;

export const ESPRESSO = {
  key: (g) => g.phase + ":" + g.round,
  mount(root, app, st) {
    const g = st.game;
    const head = gameHead(app, "espresso", `Round ${g.round} di ${g.rounds}`);
    const dots = h("div.round-dots", Array.from({ length: g.rounds }, (_, i) => h("i" + (i < g.round ? ".on" : ""))));

    if (g.phase === "result") {
      return mountResult(root, app, st, head, dots);
    }

    const stage = h("div.espresso-stage." + (g.phase === "ready" ? "ready" : "wait"));
    stage.innerHTML = MOKA;
    const msg = h("div.msg", g.phase === "ready" ? "Preparati…" : "ASPETTA…");
    const sub = h("div.sub", g.phase === "ready" ? "Tieni il dito pronto. Si preme quando diventa VERDE." : "Non premere ancora! Il caffè sta salendo…");
    stage.append(msg, sub);
    root.append(head, stage, dots);

    if (g.phase !== "armed") return {};

    const canTap = !app.spectator && g.participant && !g.tapped;
    if (!g.participant && !app.spectator) sub.textContent = "Guardi questo giro: entri nel prossimo gioco.";
    let goShown = null;
    let done = !canTap;
    if (g.tapped) {
      done = true;
      stage.className = "espresso-stage " + (g.myEarly ? "burned" : "wait");
      msg.textContent = g.myEarly ? "BRUCIATO! 🔥" : "Fatto!";
    }
    const goAt = app.toLocal(g.armedAt + g.goDelay);
    const timer = setTimeout(() => {
      if (stage.classList.contains("burned")) return;
      stage.className = "espresso-stage go";
      msg.textContent = "ORA! ☕";
      sub.textContent = canTap ? "PREMI! PREMI! PREMI!" : "";
      sfx("go");
      goShown = performance.now();
    }, Math.max(0, goAt - Date.now()));

    const onTap = (e) => {
      e.preventDefault();
      if (done) return;
      done = true;
      if (goShown == null) {
        app.act({ a: "tap", early: true });
        stage.className = "espresso-stage burned";
        msg.textContent = "BRUCIATO! 🔥";
        sub.textContent = "Troppo presto! Caffè rovinato.";
        buzz(200);
      } else {
        const ms = Math.round(performance.now() - goShown);
        app.act({ a: "tap", ms });
        msg.textContent = ms + " ms";
        sub.textContent = ms < 250 ? "Fulmine! ⚡" : ms < 350 ? "Bel riflesso!" : ms < 500 ? "Normale amministrazione." : "Ti eri addormentato?";
        buzz(30);
      }
    };
    if (canTap) {
      stage.addEventListener("pointerdown", onTap);
      const onKey = (e) => {
        if (e.code === "Space" || e.code === "Enter") onTap(e);
      };
      document.addEventListener("keydown", onKey);
      return {
        destroy() {
          clearTimeout(timer);
          document.removeEventListener("keydown", onKey);
        },
      };
    }
    return { destroy: () => clearTimeout(timer) };
  },
};

function mountResult(root, app, st, head, dots) {
  const g = st.game;
  const rows = (g.results ?? []).slice().sort((a, b) => {
    const ka = a.early ? 2 : a.ms == null ? 1 : 0;
    const kb = b.early ? 2 : b.ms == null ? 1 : 0;
    return ka - kb || (a.ms ?? 0) - (b.ms ?? 0);
  });
  const list = h(
    "div.scoreboard.results-list",
    rows.map((r, i) => {
      const p = st.players.find((x) => x.id === r.id);
      return h(
        "div.srow",
        { style: { animationDelay: i * 0.07 + "s" } },
        h("span.pos", r.early ? "🔥" : r.ms == null ? "💤" : i === 0 ? "🥇" : String(i + 1)),
        h("span.av", p?.avatar ?? "❔"),
        h("span.nm", p?.name ?? "?", " ", h("span.ms", r.early ? "bruciato" : r.ms == null ? "non pervenuto" : r.ms + " ms")),
        h("span.pts", { style: { color: r.points < 0 ? "var(--red)" : "var(--green)" } }, (r.points > 0 ? "+" : "") + r.points),
      );
    }),
  );
  root.append(head, h("div.card", h("h2", "☕ Classifica del caffè"), list), dots);
  return {};
}
