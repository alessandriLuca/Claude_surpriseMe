import { sfx } from "../audio.js";
import { clear, h, nameOf, avatarOf } from "../ui.js";
import { gameHead } from "./common.js";

const COLORS = ["#222222", "#d62828", "#f77f00", "#ffc43d", "#2a9d4b", "#4cc9f0", "#1d4ed8", "#7b2cbf", "#ff70a6", "#8b5a2b", "#ffffff"];
const SIZES = [4, 10, 22, 44];

export const PITTORE = {
  key: (g) => "turn:" + g.turn,
  mount(root, app, st) {
    let g = st.game;
    const strokes = new Map(); // id -> {c,w,p}
    let color = COLORS[0];
    let size = SIZES[1];
    let drawing = null; // tratto in corso
    let buffer = [];
    let flushTimer = null;
    let strokeSeq = (Date.now() % 1e8) * 10;

    const head = gameHead(app, "pittore", `Turno ${g.turn} di ${g.turns}`);
    const wordBar = h("div.word-bar");
    const canvas = h("canvas", { width: 800, height: 800 });
    const overlay = h("div.overlay.hidden");
    const wrap = h("div.canvas-wrap", canvas, overlay);
    const tools = h("div.tools.hidden");
    const log = h("div.log");
    const input = h("input", { placeholder: "Scrivi qui la tua risposta…", maxLength: 40, autocomplete: "off", enterkeyhint: "send" });
    const form = h(
      "form",
      {
        onsubmit: (e) => {
          e.preventDefault();
          const t = input.value.trim();
          if (!t) return;
          app.act({ a: "guess", text: t });
          input.value = "";
          sfx("send");
        },
      },
      input,
      h("button", { type: "submit" }, "➤"),
    );
    const chat = h("div.chat", log, form);
    root.append(head, h("div.pittore", h("div", wordBar, wrap, tools), chat));

    const ctx2d = canvas.getContext("2d");

    // ------------------------------------------------------------ disegno
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const px = Math.max(200, Math.round(r.width * dpr));
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
        redrawAll();
      }
    };
    const scale = () => canvas.width / 1000;

    function drawSegment(s, from) {
      const k = scale();
      ctx2d.strokeStyle = s.c;
      ctx2d.lineWidth = s.w * k;
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.beginPath();
      const p = s.p;
      const start = Math.max(0, from - 2);
      ctx2d.moveTo(p[start] * k, p[start + 1] * k);
      if (p.length === 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) {
        ctx2d.lineTo(p[0] * k + 0.01, p[1] * k);
      }
      for (let i = start + 2; i < p.length; i += 2) ctx2d.lineTo(p[i] * k, p[i + 1] * k);
      ctx2d.stroke();
    }

    function redrawAll() {
      ctx2d.fillStyle = "#ffffff";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of strokes.values()) drawSegment(s, 0);
    }

    function addPoints(id, c, w, pts) {
      let s = strokes.get(id);
      if (!s) {
        s = { c, w, p: [] };
        strokes.set(id, s);
      }
      const from = s.p.length;
      s.p.push(...pts);
      drawSegment(s, from);
    }

    const isDrawing = () => app.st?.game?.isDrawer && app.st.game.phase === "draw";

    const toLocal = (e) => {
      const r = canvas.getBoundingClientRect();
      return [
        Math.max(0, Math.min(1000, Math.round(((e.clientX - r.left) / r.width) * 1000))),
        Math.max(0, Math.min(1000, Math.round(((e.clientY - r.top) / r.height) * 1000))),
      ];
    };

    const flush = () => {
      flushTimer = null;
      if (!drawing || !buffer.length) return;
      app.act({ a: "draw", id: drawing.id, c: drawing.c, w: drawing.w, p: buffer });
      buffer = [];
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (!isDrawing()) return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const [x, y] = toLocal(e);
      drawing = { id: ++strokeSeq, c: color, w: size };
      addPoints(drawing.id, color, size, [x, y, x, y]);
      buffer.push(x, y, x, y);
      flushTimer = flushTimer || setTimeout(flush, 40);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      const s = strokes.get(drawing.id);
      for (const ev of events) {
        const [x, y] = toLocal(ev);
        const lx = s.p[s.p.length - 2];
        const ly = s.p[s.p.length - 1];
        if (Math.abs(x - lx) + Math.abs(y - ly) < 3) continue;
        addPoints(drawing.id, drawing.c, drawing.w, [x, y]);
        buffer.push(x, y);
      }
      if (buffer.length > 300) flush();
      flushTimer = flushTimer || setTimeout(flush, 40);
    });
    const end = () => {
      if (!drawing) return;
      flush();
      drawing = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end);

    // ------------------------------------------------------------ strumenti
    const renderTools = () => {
      clear(tools);
      for (const c of COLORS) {
        tools.appendChild(
          h("button.sw" + (c === color ? ".sel" : ""), {
            style: { background: c },
            title: c === "#ffffff" ? "Gomma" : "Colore",
            "aria-label": c === "#ffffff" ? "Gomma" : "Colore " + c,
            onclick: () => {
              color = c;
              if (c === "#ffffff" && size < 22) size = 22;
              renderTools();
            },
          }),
        );
      }
      for (const s of SIZES) {
        tools.appendChild(
          h("button.size" + (s === size ? ".sel" : ""), { title: "Spessore " + s, onclick: () => ((size = s), renderTools()) },
            h("i", { style: { width: Math.min(26, 4 + s / 2) + "px", height: Math.min(26, 4 + s / 2) + "px" } })),
        );
      }
      tools.appendChild(h("button.btn.small.ghost", { onclick: () => app.act({ a: "undo" }) }, "↩️ Annulla"));
      tools.appendChild(h("button.btn.small.ghost", { onclick: () => confirm("Cancellare tutto?") && app.act({ a: "clear" }) }, "🗑️"));
    };
    renderTools();

    // ------------------------------------------------------------ chat
    const renderChat = (st) => {
      const g = st.game;
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      clear(log);
      if (!g.chat.length) log.appendChild(h("div.l.muted", "Le risposte compaiono qui…"));
      for (const l of g.chat) {
        if (l.kind === "correct") log.appendChild(h("div.l.correct", "🎉 " + l.text));
        else log.appendChild(h("div.l", h("b", avatarOf(st, l.from) + " " + nameOf(st, l.from) + ": "), l.text));
      }
      if (atBottom) log.scrollTop = log.scrollHeight;
      const canGuess = !app.spectator && g.participant && !g.isDrawer && !g.hasGuessed && g.phase === "draw";
      input.disabled = !canGuess;
      form.querySelector("button").disabled = !canGuess;
      input.placeholder = g.isDrawer
        ? "Tu disegni, non indovini 😉"
        : g.hasGuessed
          ? "Hai indovinato! 🎉"
          : app.spectator
            ? "Si indovina dal telefono"
            : g.participant
              ? "Scrivi qui la tua risposta…"
              : "Guardi questo turno";
      form.classList.toggle("hidden", app.spectator);
    };

    // ------------------------------------------------------------ stato
    let lastPhase = null;
    const paint = (st) => {
      g = st.game;
      const drawerName = avatarOf(st, g.drawer) + " " + nameOf(st, g.drawer);
      if (g.phase === "choose") {
        wordBar.replaceChildren(h("small", "Tocca a"), drawerName);
        overlay.classList.remove("hidden");
        if (g.isDrawer && g.choices) {
          overlay.replaceChildren(
            h("div", h("h2", "Scegli cosa disegnare"), h("div.choices", g.choices.map((w, i) => h("button.btn", { onclick: () => (app.act({ a: "choose", i }), sfx("click")) }, w)))),
          );
        } else {
          overlay.replaceChildren(h("div.big-wait", h("div.e", "🤔"), h("h2", drawerName + " sta scegliendo…")));
        }
        tools.classList.add("hidden");
      } else if (g.phase === "draw") {
        overlay.classList.add("hidden");
        if (g.isDrawer) {
          wordBar.replaceChildren(h("small", "Disegna:"), g.word.toUpperCase());
          tools.classList.remove("hidden");
        } else if (g.hasGuessed) {
          wordBar.replaceChildren(h("small", "Hai indovinato!"), g.word.toUpperCase());
          tools.classList.add("hidden");
        } else {
          wordBar.replaceChildren(h("small", `Disegna ${drawerName}`), g.mask.toUpperCase().split("").join(" "));
          tools.classList.add("hidden");
        }
      } else {
        // rivelazione
        tools.classList.add("hidden");
        drawing = null;
        wordBar.replaceChildren(h("small", "La parola era"), (g.word ?? "?").toUpperCase());
        const pts = g.turnPoints ?? {};
        const rows = Object.entries(pts).sort((a, b) => b[1] - a[1]);
        overlay.classList.remove("hidden");
        overlay.style.background = "rgba(255,248,231,.72)";
        overlay.replaceChildren(
          h(
            "div",
            h("h2", g.guessed.length ? `${g.guessed.length} ${g.guessed.length === 1 ? "ha" : "hanno"} indovinato!` : "Nessuno ci ha capito niente!"),
            rows.map(([id, p]) => h("div", { style: { fontWeight: 900, fontSize: "18px" } }, `${avatarOf(st, id)} ${nameOf(st, id)}  +${p}`)),
          ),
        );
        if (lastPhase !== "reveal") sfx(g.guessed.length ? "reveal" : "fail");
      }
      lastPhase = g.phase;
      renderChat(st);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();
    redrawAll();
    paint(st);

    const onMsg = (m, replay = false) => {
      if (m.t === "draw") {
        if (m.by === app.you && !replay) return;
        addPoints(m.id, m.c, m.w, m.p);
      } else if (m.t === "redraw") {
        strokes.clear();
        for (const s of m.strokes) strokes.set(s.id, { c: s.c, w: s.w, p: s.p.slice() });
        redrawAll();
      }
    };
    // ricostruisce quanto già disegnato (es. dopo una riconnessione)
    for (const m of app.drawLog.slice()) onMsg(m, true);

    return {
      update: paint,
      onMsg,
      destroy() {
        ro.disconnect();
        clearTimeout(flushTimer);
      },
    };
  },
};
