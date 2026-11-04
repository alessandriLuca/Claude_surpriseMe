import { sfx } from "../audio.js";
import { h } from "../ui.js";
import { gameHead, waitingRow } from "./common.js";

export const CHI = {
  key: (g) => `${g.phase}:${g.index}`,
  mount(root, app, st) {
    const g = st.game;
    const revealed = g.phase === "reveal";
    const head = gameHead(app, "chi", `Domanda ${g.index + 1} di ${g.total}`);
    const prompt = h("div.card.checkered.prompt-card", g.prompt);
    const info = h("p.center.muted.light", { style: { fontWeight: 800 } });
    const grid = h("div.suspects");
    const wait = h("div");
    root.append(head, prompt, grid, info, wait);

    const tally = g.reveal?.tally ?? {};
    const guilty = new Set(g.reveal?.guilty ?? []);
    const votes = g.reveal?.votes ?? {};

    const buttons = new Map();
    for (const id of g.candidates) {
      const p = st.players.find((x) => x.id === id);
      if (!p) continue;
      const b = h(
        "button.suspect" + (guilty.has(id) ? ".guilty" : ""),
        {
          onclick: () => {
            if (revealed || !app.st.game.participant || app.spectator || app.st.game.myVote) return;
            app.act({ a: "vote", target: id });
            sfx("click");
          },
        },
        h("div.av", p.avatar),
        h("div.nm", p.name + (id === app.you ? " (tu)" : "")),
        revealed ? h("div.votes", String(tally[id] ?? 0)) : null,
        revealed
          ? h("div.voters", Object.entries(votes).filter(([, t]) => t === id).map(([v]) => st.players.find((x) => x.id === v)?.avatar ?? "").join(""))
          : null,
      );
      if (guilty.has(id)) b.appendChild(h("div.stamp", { style: { fontSize: "22px", borderWidth: "4px" } }, "COLPEVOLE"));
      buttons.set(id, b);
      grid.appendChild(b);
    }

    const paint = (st) => {
      const g = st.game;
      if (revealed) {
        const myTarget = g.reveal?.votes?.[app.you];
        if (app.spectator) info.textContent = "";
        else if (!myTarget) info.textContent = "Non hai votato… niente punti!";
        else if (guilty.has(myTarget)) info.textContent = "Hai votato con la maggioranza: +150! 🎯";
        else info.textContent = "Eri in minoranza. Pensi diverso dagli altri, eh?";
        for (const b of buttons.values()) b.disabled = true;
        return;
      }
      for (const [id, b] of buttons) {
        b.classList.toggle("picked", g.myVote === id);
        b.disabled = !!g.myVote || !g.participant || app.spectator;
      }
      info.textContent = app.spectator
        ? "Si vota dal telefono!"
        : !g.participant
          ? "Guardi questo giro."
          : g.myVote
            ? "Voto segreto registrato 🤫"
            : "Tocca il colpevole. Il voto è segreto!";
      wait.replaceChildren(waitingRow(st, g.candidates, g.votedIds));
    };
    paint(st);
    return { update: paint };
  },
};
