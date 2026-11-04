import { sfx } from "../audio.js";
import { h, avatarOf, nameOf } from "../ui.js";
import { gameHead, waitingRow } from "./common.js";

export const BUGIARDO = {
  key: (g) => `${g.phase}:${g.index}`,
  mount(root, app, st) {
    const g = st.game;
    const head = gameHead(app, "bugiardo", `Parola ${g.index + 1} di ${g.total}`);
    const word = h("div.rare-word", g.word);
    root.append(head, word);
    if (g.phase === "write") return mountWrite(root, app, st);
    return mountPick(root, app, st);
  },
};

function mountWrite(root, app, st) {
  const box = h("div");
  const wait = h("div", { style: { marginTop: "14px" } });
  root.append(box, wait);
  const participants = st.players.map((p) => p.id);

  const renderBox = (g) => {
    if (app.spectator || !g.participant) {
      box.replaceChildren(h("div.card.center", h("div.big-wait", h("div.e", "🤥"), h("h2", "Stanno inventando balle…"), h("p.muted", "Cosa vorrà mai dire questa parola?"))));
      return;
    }
    if (g.myLie) {
      box.replaceChildren(h("div.card.center", h("h2", "Balla depositata ✓"), h("p", { style: { fontFamily: "var(--font-hand)", fontSize: "28px", margin: "6px 0" } }, "“" + g.myLie + "”"), h("p.muted", "Ora aspetta che gli altri finiscano di mentire.")));
      return;
    }
    if (box.querySelector("textarea")) return; // già in scrittura
    const ta = h("textarea.field", { maxLength: 80, rows: 2, placeholder: "Es: «Antico attrezzo per pelare le castagne»" });
    const send = () => {
      const t = ta.value.trim();
      if (!t) return ta.focus();
      app.act({ a: "lie", text: t });
      sfx("send");
    };
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });
    box.replaceChildren(
      h(
        "div.card.checkered",
        h("h2", "Cosa significa?"),
        h("p.muted", { style: { marginTop: 0 } }, "Inventa una definizione falsa ma credibile. Più sembra vera, più gente ci casca!"),
        ta,
        h("div.row", { style: { justifyContent: "flex-end", marginTop: "10px" } }, h("button.btn.small", { onclick: send }, "Mento! 🤥")),
      ),
    );
    setTimeout(() => ta.focus(), 60);
  };
  const paint = (st) => {
    renderBox(st.game);
    wait.replaceChildren(h("p.muted.light.center", { style: { margin: 0 } }, "Chi ha già mentito:"), waitingRow(st, participants, st.game.doneIds));
  };
  paint(st);
  return { update: paint };
}

function mountPick(root, app, st) {
  const g = st.game;
  const revealed = g.phase === "reveal";
  const info = h("p.center.muted.light", { style: { fontWeight: 800 } });
  const list = h("div.options");
  const wait = h("div", { style: { marginTop: "14px" } });
  root.append(h("p.center", { style: { fontWeight: 900, fontSize: "19px", marginTop: 0 } }, revealed ? "Ecco la verità!" : "Qual è la definizione VERA?"), list, info, wait);
  const participants = st.players.map((p) => p.id);
  const btns = new Map();

  for (const o of g.options) {
    const b = h(
      "button.opt" + (o.mine ? ".mine" : "") + (revealed ? ".revealed" : "") + (revealed && o.truth ? ".truth" : ""),
      {
        onclick: () => {
          const cur = app.st.game;
          if (revealed || o.mine || cur.myPick != null || !cur.participant || app.spectator) return;
          app.act({ a: "pick", option: o.id });
          sfx("click");
        },
      },
      o.text,
      o.mine && !revealed ? h("span.meta", "(è la tua balla)") : null,
    );
    if (revealed) {
      if (o.truth) b.appendChild(h("span.tagv", "VERA ✅"));
      const authors = (o.authors ?? []).map((id) => avatarOf(st, id) + " " + nameOf(st, id)).join(", ");
      const pickers = (o.pickers ?? []).map((id) => avatarOf(st, id)).join(" ");
      b.appendChild(
        h(
          "span.meta",
          o.truth ? "Definizione del vocabolario" : authors ? "Balla di " + authors : "Balla della Nonna",
          pickers ? " — ci sono cascati: " + pickers : "",
        ),
      );
    }
    btns.set(o.id, b);
    list.appendChild(b);
  }

  const paint = (st) => {
    const g = st.game;
    for (const [id, b] of btns) {
      b.classList.toggle("picked", g.myPick === id);
      b.disabled = revealed || g.myPick != null || app.spectator || !g.participant;
    }
    if (revealed) {
      const my = g.points?.[app.you] ?? 0;
      const pickedTruth = g.options.find((o) => o.id === g.myPick)?.truth;
      info.textContent = app.spectator ? "" : my > 0 ? `Hai fatto +${my} punti${pickedTruth ? " (e conoscevi la verità!)" : ""}` : g.myPick == null ? "Non hai scelto niente…" : "Ci sei cascato! 🙈";
      wait.replaceChildren();
      return;
    }
    info.textContent = app.spectator ? "Si sceglie dal telefono!" : !g.participant ? "Guardi questo giro." : g.myPick != null ? "Scelta fatta ✓" : "Non puoi scegliere la tua balla.";
    wait.replaceChildren(waitingRow(st, participants, g.doneIds));
  };
  paint(st);
  return { update: paint };
}
