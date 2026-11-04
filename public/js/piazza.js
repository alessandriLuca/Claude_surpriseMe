// La Piazza: nella home si vedono le tavolate aperte e si chiacchiera
// con chi sta cercando compagnia per giocare.

import { createChatBox } from "./chat.js";
import { h, toast } from "./ui.js";

const PHASE_LABEL = {
  lobby: ["Aspettano gente!", "wait"],
  intro: ["Partita in corso", "busy"],
  playing: ["Partita in corso", "busy"],
  interlude: ["Partita in corso", "busy"],
  final: ["Gran finale", "busy"],
};

/**
 * opts: { identity(): {name, avatar}, onJoin(code) }
 * Ritorna { el, hello(), destroy() }
 */
export function createPiazza(opts) {
  let ws = null;
  let closed = false;
  let retries = 0;
  let pingTimer = null;

  const stats = h("div.pz-stats", h("span.dot"), "Mi collego alla piazza…");
  const list = h("div.pz-rooms");
  const chat = createChatBox({
    placeholder: "Cerchi gente? Scrivilo qui…",
    max: 140,
    isMine: (m) => m.name === opts.identity().name,
    onSend: (text) => {
      const id = opts.identity();
      if (!id.name) {
        toast("Scrivi prima il tuo nome qui sopra!", "err");
        return;
      }
      send({ t: "hello", ...id });
      send({ t: "chat", text });
    },
    empty: "La piazza è tranquilla. Scrivi qualcosa e vedi chi risponde!",
  });

  const el = h(
    "section.piazza",
    h("div.pz-head", h("h2", "🎪 La Piazza"), stats),
    h("p.pz-sub", "Le tavolate aperte a tutti. Siediti dove c'è posto, oppure apparecchia la tua e falla vedere qui."),
    h("div.pz-grid", h("div.pz-col", h("h3", "Tavolate aperte"), list), h("div.pz-col", h("h3", "Chiacchiere in piazza"), chat.el)),
  );

  renderRooms([]);

  function send(o) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
  }

  function renderRooms(rooms) {
    if (!rooms.length) {
      list.replaceChildren(
        h("div.pz-empty", h("div.e", "🪑"), h("b", "Nessuna tavolata aperta al momento."), h("span", "Apparecchiane una tu: comparirà qui per tutti.")),
      );
      return;
    }
    list.replaceChildren(
      ...rooms.map((r) => {
        const [label, cls] = PHASE_LABEL[r.phase] ?? ["", "busy"];
        const full = r.players >= r.max;
        return h(
          "div.pz-room",
          h("div.pz-host", r.hostAvatar ?? "🍽️"),
          h(
            "div.pz-info",
            h("div.pz-title", "Tavolata di " + (r.host ?? "qualcuno"), h("span.pz-code", r.code)),
            h("div.pz-avatars", r.avatars.join(" ")),
            h("div.pz-meta", h("span.pz-chip." + cls, label), h("span", `${r.players}/${r.max} a tavola`)),
          ),
          h(
            "button.btn.small" + (cls === "wait" ? ".green" : ".ghost"),
            { disabled: full, onclick: () => opts.onJoin(r.code) },
            full ? "Piena" : cls === "wait" ? "Siediti" : "Entra",
          ),
        );
      }),
    );
  }

  function renderStats(m) {
    const parts = [];
    parts.push(m.playing === 1 ? "1 persona sta giocando" : `${m.playing} persone stanno giocando`);
    const others = Math.max(0, m.inPiazza - 1);
    if (others > 0) parts.push(others === 1 ? "1 altra in piazza" : `${others} altre in piazza`);
    stats.replaceChildren(h("span.dot.live"), parts.join(" · "));
  }

  function connect() {
    if (closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/api/piazza`);
    ws.addEventListener("open", () => {
      retries = 0;
      hello();
      clearInterval(pingTimer);
      pingTimer = setInterval(() => send({ t: "ping" }), 25_000);
    });
    ws.addEventListener("message", (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "rooms") {
        renderRooms(m.rooms);
        renderStats(m);
      } else if (m.t === "chatHistory") chat.setAll(m.msgs);
      else if (m.t === "chat") chat.add(m.msg);
      else if (m.t === "toast") toast(m.text, "err");
    });
    ws.addEventListener("close", () => {
      clearInterval(pingTimer);
      if (closed) return;
      stats.replaceChildren(h("span.dot"), "Riconnessione alla piazza…");
      setTimeout(connect, Math.min(10_000, 800 * 2 ** retries++));
    });
  }

  function hello() {
    const id = opts.identity();
    if (id.name) send({ t: "hello", ...id });
  }

  connect();

  return {
    el,
    hello,
    destroy() {
      closed = true;
      clearInterval(pingTimer);
      try {
        ws?.close();
      } catch {
        /* niente */
      }
    },
  };
}
