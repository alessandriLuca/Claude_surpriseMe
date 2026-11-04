// Widget di chat riutilizzabile (tavolata e Piazza).

import { sfx } from "./audio.js";
import { h } from "./ui.js";

function fmtTime(ts) {
  const d = new Date(ts);
  return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
}

/**
 * Crea una chat. opts:
 *  - placeholder, max
 *  - isMine(msg) → bool
 *  - onSend(text)
 *  - empty: testo quando non ci sono messaggi
 */
export function createChatBox(opts) {
  const log = h("div.cb-log", { role: "log", "aria-live": "polite" });
  const input = h("input.cb-input", {
    placeholder: opts.placeholder ?? "Scrivi un messaggio…",
    maxLength: opts.max ?? 140,
    autocomplete: "off",
    enterkeyhint: "send",
    "aria-label": "Messaggio",
  });
  const form = h(
    "form.cb-form",
    {
      onsubmit: (e) => {
        e.preventDefault();
        const t = input.value.trim();
        if (!t) return;
        opts.onSend(t);
        input.value = "";
        sfx("send");
      },
    },
    input,
    h("button.cb-send", { type: "submit", "aria-label": "Invia" }, "➤"),
  );
  const el = h("div.chatbox", log, form);
  let empty = true;
  const renderEmpty = () => {
    log.replaceChildren(h("div.cb-empty", opts.empty ?? "Ancora nessun messaggio. Rompi il ghiaccio!"));
    empty = true;
  };
  renderEmpty();

  const line = (m) =>
    h(
      "div.cb-msg" + (opts.isMine?.(m) ? ".mine" : ""),
      h("span.cb-av", m.avatar),
      h(
        "div.cb-body",
        h("div.cb-head", h("b", { style: m.color ? { color: m.color } : null }, m.name), h("time", fmtTime(m.ts))),
        h("div.cb-text", m.text),
      ),
    );

  return {
    el,
    input,
    add(m) {
      if (empty) {
        log.replaceChildren();
        empty = false;
      }
      const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      log.appendChild(line(m));
      while (log.children.length > 80) log.removeChild(log.firstChild);
      if (atBottom || opts.isMine?.(m)) log.scrollTop = log.scrollHeight;
    },
    setAll(msgs) {
      if (!msgs.length) return renderEmpty();
      log.replaceChildren(...msgs.map(line));
      empty = false;
      requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
    },
    scrollDown() {
      log.scrollTop = log.scrollHeight;
    },
  };
}
