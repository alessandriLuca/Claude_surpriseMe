import { sfx, unlockAudio } from "../audio.js";
import { createRoom, roomExists } from "../net.js";
import { clear, h, storage, toast } from "../ui.js";

export const AVATARS = [
  "🍕", "🍝", "🧀", "🍷", "🍋", "🥖", "🍅", "🌶️", "🫒", "🍨",
  "🐷", "🐔", "🐐", "🐈", "🐕", "🦆", "🐌", "🦉", "🐸", "🐙",
  "👵", "👴", "🧔", "🤌", "🎺", "🪗", "🛵", "⛪", "🎩", "🌋",
];

const PREVIEW = [
  ["🎤", "Botta e Risposta", "La battuta migliore vince"],
  ["🎨", "Pittore Maledetto", "Disegna, gli altri indovinano"],
  ["🤥", "Il Bugiardo", "Inventa definizioni false"],
  ["🕵️", "Chi è stato?", "Punta il dito sugli amici"],
  ["🍇", "La Pigiatura", "Pesta l'uva più veloce"],
  ["☕", "Espresso Express", "Riflessi da barista"],
];

const SUBS = [
  "Il party game da sagra di paese",
  "Si gioca col telefono, si ride a tavola",
  "Presenta Nonna Pina. Portate il vino.",
];

export function renderHome(app, presetCode = "") {
  const root = clear(app.root);
  let avatar = storage.get("avatar") || AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const name = h("input.field", {
    placeholder: "Il tuo nome (es. Zio Gino)",
    maxLength: 18,
    value: storage.get("name", ""),
    autocomplete: "nickname",
    "aria-label": "Il tuo nome",
  });
  const picker = h(
    "div.avatar-picker",
    AVATARS.map((a) =>
      h("button", {
        type: "button",
        class: a === avatar ? "sel" : "",
        "aria-label": "Avatar " + a,
        onclick: (e) => {
          avatar = a;
          for (const b of picker.children) b.classList.remove("sel");
          e.currentTarget.classList.add("sel");
          sfx("click");
        },
      }, a),
    ),
  );
  const code = h("input.field.code-input", {
    placeholder: "CODICE",
    maxLength: 4,
    value: presetCode,
    autocapitalize: "characters",
    "aria-label": "Codice della stanza",
    oninput: (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, "")),
  });

  const getName = () => {
    const n = name.value.trim();
    if (!n) {
      toast("Prima dimmi come ti chiami!", "err");
      name.focus();
      return null;
    }
    storage.set("name", n);
    storage.set("avatar", avatar);
    return n;
  };

  const btnCreate = h("button.btn.block", {
    onclick: async () => {
      unlockAudio();
      const n = getName();
      if (!n) return;
      btnCreate.disabled = true;
      try {
        const c = await createRoom();
        app.joinRoom(c, { name: n, avatar });
      } catch (err) {
        toast("Ops: " + err.message, "err");
        btnCreate.disabled = false;
      }
    },
  }, "🍽️ Apparecchia una nuova tavolata");

  const doJoin = async (spectator) => {
    unlockAudio();
    const c = code.value.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) {
      toast("Il codice è di 4 lettere!", "err");
      code.focus();
      return;
    }
    const n = spectator ? "" : getName();
    if (!spectator && !n) return;
    if (!(await roomExists(c))) {
      toast("Non trovo la tavolata " + c + ". Controlla il codice!", "err");
      return;
    }
    app.joinRoom(c, { name: n, avatar, spectator });
  };

  const last = storage.get("lastRoom");

  root.append(
    h(
      "section.hero",
      h("div.bunting", Array.from({ length: 15 }, () => h("span"))),
      h("div.logo", "SAGRA!"),
      h("div.sub", SUBS[Math.floor(Math.random() * SUBS.length)]),
    ),
    h(
      "div.home-grid",
      h(
        "div.card.checkered",
        h(
          "div.stack",
          h("div", h("label.lbl", "Come ti chiami?"), name),
          h("div", h("label.lbl", "Scegli il tuo avatar"), picker),
          btnCreate,
          h("div.or-sep", "oppure entra con un codice"),
          h(
            "form.row",
            { onsubmit: (e) => (e.preventDefault(), doJoin(false)) },
            h("div.grow", code),
            h("button.btn.green", { type: "submit" }, "Entra"),
          ),
          h(
            "div.row",
            { style: { justifyContent: "space-between" } },
            h("button.btn.ghost.small", { type: "button", onclick: () => doJoin(true) }, "📺 Apri come TV (solo schermo)"),
            last && last !== presetCode
              ? h("button.btn.ghost.small", { type: "button", onclick: () => ((code.value = last), doJoin(false)) }, "↩️ Torna a " + last)
              : null,
          ),
        ),
      ),
    ),
    h(
      "div.games-preview",
      PREVIEW.map(([e, t, s]) => h("div.gp", h("div.e", e), h("b", t), h("small", s))),
    ),
    h(
      "p.footer-note",
      "Da 3 a 12 giocatori (o meno, coi cugini-bot). Ognuno usa il proprio telefono; mettete un computer o una TV in modalità “TV” per lo schermo grande.",
      h("br"),
      "Fatto con amore, ragù e Cloudflare Workers.",
    ),
  );
  if (presetCode) setTimeout(() => name.focus(), 50);
}
