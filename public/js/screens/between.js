import { confetti } from "../fx.js";
import { h, nameOf, avatarOf } from "../ui.js";

function scoreboard(st, deltas, offset = 0) {
  const ranked = st.players.slice().sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...ranked.map((p) => p.score));
  return h(
    "div.scoreboard",
    ranked.map((p, i) => {
      const d = deltas ? p.score - (deltas[p.id] ?? 0) : 0;
      const bar = h("div.bar", { style: { width: "0%" } });
      requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = (100 * p.score) / max + "%")));
      return h(
        "div.srow",
        { style: { animationDelay: i * 0.08 + "s" } },
        bar,
        h("span.pos", i + offset === 0 ? "🥇" : i + offset === 1 ? "🥈" : i + offset === 2 ? "🥉" : String(i + offset + 1)),
        h("span.av", p.avatar),
        h("span.nm", p.name),
        h("span.pts", String(p.score), d > 0 ? h("span.delta", "+" + d) : null),
      );
    }),
  );
}

function skipButton(app, label) {
  if (!app.isHost) return null;
  return h("button.btn.small.ghost", { onclick: () => app.send({ t: "skip" }) }, label);
}

export const BETWEEN = {
  key: () => "between",
  mount(root, app, st) {
    if (st.phase === "intro") return mountIntro(root, app, st);
    if (st.phase === "interlude") return mountInterlude(root, app, st);
    if (st.phase === "final") return mountFinal(root, app, st);
    root.append(h("div.big-wait.on-night", h("div.e", "⏳"), h("h2", "Un attimo…")));
  },
};

function mountIntro(root, app, st) {
  const g = app.hello?.games?.[st.currentKind] ?? { title: st.currentKind, emoji: "🎲", rules: [] };
  const n = st.playlist.length;
  root.append(
    h(
      "div.card.checkered.intro-card",
      h("div.step", `Gioco ${st.gameIndex + 1} di ${n}`),
      h("div.big-emoji", g.emoji),
      h("h1", g.title),
      h("p", { style: { fontSize: "19px", fontWeight: 800 } }, g.tagline),
      h("ol", g.rules.map((r) => h("li", r))),
      h("div.row", { style: { justifyContent: "center", marginTop: "10px" } }, skipButton(app, "Ho capito, si parte! ▶")),
    ),
  );
}

function mountInterlude(root, app, st) {
  const next = st.playlist[st.gameIndex + 1];
  const g = next ? app.hello?.games?.[next] : null;
  root.append(
    h(
      "div.card.intro-card",
      { style: { textAlign: "left" } },
      h("h1", { style: { textAlign: "center" } }, "📋 Classifica"),
      scoreboard(st, st.lastGameScores),
      g ? h("p.center", { style: { marginTop: "16px", fontWeight: 800 } }, `Prossimo gioco: ${g.emoji} ${g.title}`) : null,
      h("div.row", { style: { justifyContent: "center" } }, skipButton(app, "Avanti ▶")),
    ),
  );
}

function mountFinal(root, app, st) {
  const ranked = st.players.slice().sort((a, b) => b.score - a.score);
  const [p1, p2, p3] = ranked;
  const step = (p, cls, n) =>
    p
      ? h(
          "div.step." + cls,
          cls === "p1" ? h("span.crown", "👑") : null,
          h("div.av", p.avatar),
          h("div.nm", p.name),
          h("div.block", String(n)),
          h("div", { style: { fontWeight: 900, marginTop: "6px" } }, p.score + " pt"),
        )
      : h("div.step");
  root.append(
    h("div.center", h("h1", { style: { fontSize: "clamp(34px,8vw,60px)", color: "var(--gold)", textShadow: "0 4px 0 var(--red-dark)" } }, "Il Re della Sagra!")),
    h("div.podium", step(p2, "p2", 2), step(p1, "p1", 1), step(p3, "p3", 3)),
    ranked.length > 3
      ? h("div.card", { style: { maxWidth: "620px", margin: "16px auto 0" } }, scoreboard({ ...st, players: ranked.slice(3) }, null, 3))
      : null,
    st.awards?.length
      ? h(
          "div",
          { style: { marginTop: "24px" } },
          h("h2.center", { style: { color: "var(--gold)" } }, "🏅 I premi della serata"),
          h(
            "div.awards",
            st.awards.map((a, i) =>
              h(
                "div.award",
                { style: { animationDelay: 0.6 + i * 0.25 + "s" } },
                h("div.e", a.emoji),
                h("b", a.title),
                h("div.who", avatarOf(st, a.playerId) + " " + nameOf(st, a.playerId)),
                h("small", a.why),
              ),
            ),
          ),
        )
      : null,
    h(
      "div.row",
      { style: { justifyContent: "center", marginTop: "26px" } },
      app.isHost ? h("button.btn.green", { onclick: () => app.send({ t: "lobby" }) }, "🔁 Un'altra partita!") : h("p.muted.light", "L'host può far ripartire la serata."),
      h("button.btn.ghost", { onclick: () => shareResult(st) }, "📣 Condividi"),
    ),
  );
  setTimeout(() => confetti(200), 400);
}

async function shareResult(st) {
  const ranked = st.players.slice().sort((a, b) => b.score - a.score);
  const medals = ["🥇", "🥈", "🥉"];
  const text =
    "SAGRA! — risultati della serata\n" +
    ranked.map((p, i) => `${medals[i] ?? i + 1 + "."} ${p.avatar} ${p.name}: ${p.score}`).join("\n") +
    "\n\nGioca anche tu: " + location.origin;
  try {
    if (navigator.share) return await navigator.share({ text });
  } catch {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    const { toast } = await import("../ui.js");
    toast("Risultati copiati!");
  } catch {
    /* niente */
  }
}
