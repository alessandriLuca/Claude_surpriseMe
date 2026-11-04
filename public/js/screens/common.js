import { h } from "../ui.js";

export function gameHead(app, kind, sub) {
  const g = app.hello?.games?.[kind] ?? { title: kind, emoji: "🎲" };
  return h("div.game-head", h("span.e", g.emoji), h("div", h("div.t", g.title), sub ? h("div.s", sub) : null));
}

/** Avatar dei partecipanti, colorati quando hanno "fatto". */
export function waitingRow(st, ids, doneIds) {
  const done = new Set(doneIds);
  return h(
    "div.waiting-avatars",
    ids.map((id) => {
      const p = st.players.find((x) => x.id === id);
      if (!p) return null;
      return h("span" + (done.has(id) ? ".done" : ""), { title: p.name }, p.avatar);
    }),
  );
}

export function spectatorNote(app) {
  return app.spectator ? null : h("p.muted.light.center", "Stai guardando questo giro: entrerai nel prossimo gioco!");
}
