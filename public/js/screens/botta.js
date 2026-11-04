import { sfx } from "../audio.js";
import { clear, h, nameOf, avatarOf } from "../ui.js";
import { gameHead, waitingRow } from "./common.js";

export const BOTTA = {
  key: (g) => `${g.phase}:${g.round}:${g.index ?? ""}`,
  mount(root, app, st) {
    const g = st.game;
    if (g.phase === "answer") return mountAnswer(root, app, st);
    return mountVote(root, app, st);
  },
};

function mountAnswer(root, app, st) {
  const g = st.game;
  const head = gameHead(app, "botta", `Giro ${g.round} di ${g.rounds}${g.round > 1 ? " — punti x" + g.round + "!" : ""}`);
  const boxes = h("div");
  const waitBox = h("div");
  root.append(head, boxes, waitBox);

  const participants = st.players.map((p) => p.id);

  const renderBoxes = (g) => {
    clear(boxes);
    if (app.spectator || !g.participant) {
      boxes.appendChild(
        h("div.card.center", h("div.big-wait", h("div.e", "✍️"), h("h2", "Stanno scrivendo le loro perle…"), h("p.muted", "Preparatevi a votare."))),
      );
      return;
    }
    const pending = g.mine.filter((m) => !m.answered);
    if (pending.length === 0) {
      boxes.appendChild(h("div.card.center", h("div.big-wait", h("div.e", "😏"), h("h2", "Fatto!"), h("p.muted", "Aspettiamo i lenti…"))));
      return;
    }
    for (const m of g.mine) {
      if (m.answered) {
        boxes.appendChild(h("div.card.answer-box", h("div.prompt", m.prompt), h("p", { style: { margin: 0, color: "var(--green)", fontWeight: 900 } }, "✓ Risposta inviata")));
        continue;
      }
      const ta = h("textarea.field", { maxLength: 90, placeholder: "Scrivi qualcosa di memorabile…", rows: 2 });
      const count = h("div.count", "0/90");
      const send = () => {
        const text = ta.value.trim();
        if (!text) return ta.focus();
        app.act({ a: "answer", match: m.match, text });
        sfx("send");
        btn.disabled = true;
      };
      ta.addEventListener("input", () => (count.textContent = ta.value.length + "/90"));
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          send();
        }
      });
      const btn = h("button.btn.small", { onclick: send }, "Invia ✉️");
      boxes.appendChild(
        h("div.card.checkered.answer-box", { "data-match": m.match }, h("div.prompt", m.prompt), ta, count, h("div.row", { style: { justifyContent: "flex-end" } }, btn)),
      );
    }
    const first = boxes.querySelector("textarea");
    if (first && !app.spectator) setTimeout(() => first.focus(), 60);
  };

  const renderWait = (st) => {
    clear(waitBox).appendChild(h("div", { style: { marginTop: "14px" } }, h("p.muted.light.center", { style: { margin: 0 } }, "Chi ha finito:"), waitingRow(st, participants, st.game.done ?? [])));
  };

  let answeredKey = g.mine?.map((m) => m.answered).join() ?? "";
  renderBoxes(g);
  renderWait(st);
  return {
    update(st) {
      const k = st.game.mine?.map((m) => m.answered).join() ?? "";
      if (k !== answeredKey) {
        // ricostruiamo solo le scatole già inviate, preservando il testo delle altre
        const drafts = {};
        boxes.querySelectorAll("[data-match]").forEach((b) => (drafts[b.dataset.match] = b.querySelector("textarea")?.value ?? ""));
        answeredKey = k;
        renderBoxes(st.game);
        boxes.querySelectorAll("[data-match]").forEach((b) => {
          const ta = b.querySelector("textarea");
          if (ta && drafts[b.dataset.match]) ta.value = drafts[b.dataset.match];
        });
      }
      renderWait(st);
    },
  };
}

function mountVote(root, app, st) {
  const g = st.game;
  const revealed = g.phase === "reveal";
  const head = gameHead(app, "botta", `Sfida ${g.index + 1} di ${g.total} — giro ${g.round}`);
  const promptCard = h("div.card.checkered.prompt-card", g.prompt);
  const info = h("p.center.muted.light", { style: { fontWeight: 800 } });
  const btns = [0, 1].map((side) => {
    const b = h("button.answer-btn", {
      onclick: () => {
        if (!g.canVote || app.st.game.myVote != null || revealed) return;
        app.act({ a: "vote", choice: side });
        sfx("click");
        b.classList.add("picked");
        btns.forEach((x) => (x.disabled = true));
      },
    }, g.answers[side]);
    return b;
  });
  const waitBox = h("p.center.muted.light", { style: { fontWeight: 800 } });
  let revealPainted = false;
  root.append(head, promptCard, h("div", { style: { height: "16px" } }), h("div.versus", btns[0], h("div.vs", "VS"), btns[1]), info, waitBox);

  const paint = (st) => {
    const g = st.game;
    if (!revealed) {
      if (app.spectator) info.textContent = "Votate dal telefono!";
      else if (g.isAuthor) info.textContent = "Una di queste è tua! Incrocia le dita 🤞";
      else if (!g.canVote) info.textContent = "Guardi questo giro.";
      else if (g.myVote != null) info.textContent = "Voto registrato ✓";
      else info.textContent = "Tocca la risposta che ti fa più ridere!";
      const disable = !g.canVote || g.myVote != null;
      btns.forEach((b, i) => {
        b.disabled = disable;
        b.classList.toggle("picked", g.myVote === i);
      });
      // non mostriamo chi ha votato: svelerebbe gli autori
      const n = g.votedIds.length;
      waitBox.textContent = n ? `🗳️ ${n} ${n === 1 ? "voto" : "voti"} nell'urna` : "";
      return;
    }
    // rivelazione (una sola volta)
    if (revealPainted) return;
    revealPainted = true;
    info.textContent = "";
    waitBox.textContent = "";
    btns.forEach((b, i) => {
      b.disabled = true;
      b.classList.toggle("picked", g.myVote === i);
      const pts = g.points?.[i] ?? 0;
      const vs = g.votesBy?.[i] ?? [];
      const other = g.votesBy?.[1 - i] ?? [];
      if (vs.length > other.length) b.classList.add("winner");
      const author = g.authors?.[i];
      b.append(
        h("span.author", author ? `— ${avatarOf(st, author)} ${nameOf(st, author)}` : ""),
        h("span.voters", vs.map((id) => avatarOf(st, id)).join(" ") || "nessun voto"),
      );
      if (pts > 0) b.append(h("span.pts", "+" + pts));
      if (g.sweep === i) b.append(h("div.stamp", "ASFALTATO!"));
    });
  };
  paint(st);
  return { update: paint };
}
