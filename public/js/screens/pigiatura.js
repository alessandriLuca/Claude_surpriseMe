import { sfx } from "../audio.js";
import { buzz, h } from "../ui.js";
import { gameHead } from "./common.js";

const FEET = ["🦶", "🦶🏻", "🦶🏽", "🦶🏿"];

function barrel(p, count, max, me) {
  const pct = Math.min(100, (100 * count) / Math.max(max, 60));
  const wine = h("div.wine", { style: { height: pct + "%" } });
  const el = h(
    "div.barrel" + (me ? ".me" : ""),
    h("div.litres", (count / 10).toFixed(1) + " L"),
    h("div.cask", wine, h("div.hoop.h1"), h("div.hoop.h2")),
    h("div.who", p.avatar + " " + p.name),
  );
  return { el, wine, litres: el.querySelector(".litres") };
}

export const PIGIATURA = {
  key: (g) => `${g.phase}:${g.round}`,
  mount(root, app, st) {
    const g = st.game;
    const head = gameHead(app, "pigiatura", `Vendemmia ${g.round} di ${g.rounds}`);
    root.append(head);

    if (g.phase === "result") {
      const rows = g.results ?? [];
      root.append(
        h(
          "div.card",
          h("h2", "🍷 La cantina"),
          h(
            "div.scoreboard",
            rows.map((r, i) => {
              const p = st.players.find((x) => x.id === r.id);
              return h(
                "div.srow",
                { style: { animationDelay: i * 0.08 + "s" } },
                h("span.pos", i === 0 && r.taps > 0 ? "🏆" : String(i + 1)),
                h("span.av", p?.avatar ?? "❔"),
                h("span.nm", (p?.name ?? "?") + " ", h("span.ms", (r.taps / 10).toFixed(1) + " litri")),
                h("span.pts", { style: { color: "var(--green)" } }, r.points ? "+" + r.points : "0"),
              );
            }),
          ),
        ),
      );
      return {};
    }

    const canStomp = !app.spectator && g.participant;
    const ids = Object.keys(g.counts);
    const cellar = h("div.cellar");
    const casks = new Map();
    const maxOf = (counts) => Math.max(0, ...Object.values(counts));
    for (const id of ids) {
      const p = st.players.find((x) => x.id === id);
      if (!p) continue;
      const b = barrel(p, g.counts[id] ?? 0, maxOf(g.counts), id === app.you);
      casks.set(id, b);
      cellar.appendChild(b.el);
    }

    let local = g.mine ?? 0;
    let pending = 0;
    let foot = 0;
    const pad = h(
      "button.stomp-pad" + (g.phase === "stomp" ? ".go" : ""),
      { type: "button", disabled: !canStomp, "aria-label": "Pesta l'uva" },
      h("div.grapes", "🍇🍇🍇"),
      h("div.big", g.phase === "ready" ? "Pronti…" : "PESTA!"),
      h("div.count", canStomp ? (local / 10).toFixed(1) + " L" : app.spectator ? "Si pesta dal telefono!" : "Guardi questo giro"),
    );
    const bigLbl = pad.querySelector(".big");
    const countLbl = pad.querySelector(".count");

    root.append(pad, cellar);

    // conto alla rovescia 3-2-1 in fase di preparazione
    let cdTimer = null;
    if (g.phase === "ready" && st.deadline) {
      const tick = () => {
        const left = Math.ceil((app.toLocal(st.deadline) - Date.now()) / 1000);
        if (left > 0) {
          if (bigLbl.textContent !== String(left)) sfx("tick");
          bigLbl.textContent = String(left);
          cdTimer = setTimeout(tick, 100);
        } else bigLbl.textContent = "VIA!";
      };
      tick();
    }

    let sendTimer = null;
    const flush = () => {
      sendTimer = null;
      if (pending > 0) {
        app.act({ a: "taps", n: pending });
        pending = 0;
      }
    };
    const onTap = (e) => {
      e.preventDefault();
      if (!canStomp || app.st?.game?.phase !== "stomp") return;
      local++;
      pending++;
      countLbl.textContent = (local / 10).toFixed(1) + " L";
      foot = (foot + 1) % 2;
      pad.classList.toggle("left", foot === 0);
      pad.classList.toggle("right", foot === 1);
      spawnSplash(pad, e);
      if (local % 10 === 0) sfx("pop");
      buzz(8);
      sendTimer = sendTimer || setTimeout(flush, 150);
    };
    if (canStomp && g.phase === "stomp") pad.addEventListener("pointerdown", onTap);

    const update = (st) => {
      const g = st.game;
      const max = Math.max(maxOf(g.counts), local);
      for (const [id, b] of casks) {
        const c = id === app.you ? Math.max(local, g.counts[id] ?? 0) : g.counts[id] ?? 0;
        b.wine.style.height = Math.min(100, (100 * c) / Math.max(max, 60)) + "%";
        b.litres.textContent = (c / 10).toFixed(1) + " L";
      }
    };
    update(st);
    return {
      update,
      destroy() {
        clearTimeout(cdTimer);
        flush();
        clearTimeout(sendTimer);
      },
    };
  },
};

function spawnSplash(pad, e) {
  const r = pad.getBoundingClientRect();
  const s = document.createElement("span");
  s.className = "splash";
  s.textContent = Math.random() < 0.5 ? FEET[(Math.random() * FEET.length) | 0] : "💜";
  s.style.left = (e.clientX ? e.clientX - r.left : r.width / 2) + "px";
  s.style.top = (e.clientY ? e.clientY - r.top : r.height / 2) + "px";
  pad.appendChild(s);
  setTimeout(() => s.remove(), 600);
}
