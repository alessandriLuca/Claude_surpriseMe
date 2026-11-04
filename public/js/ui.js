// Piccole utilità per costruire il DOM senza framework.

/**
 * h("div.card.big", {onclick}, "testo", child, [figli])
 * Il selettore accetta tag, classi (.x) e id (#y).
 */
export function h(sel, props, ...children) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement((m && m[1]) || "div");
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === ".") el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (typeof props !== "object" || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "class") el.className += " " + v;
      else if (k === "html") el.innerHTML = v;
      else if (k in el && k !== "list" && k !== "type") el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function toast(text, kind = "") {
  const box = document.getElementById("toasts");
  const t = h("div.toast" + (kind ? "." + kind : ""), text);
  box.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .4s";
    t.style.opacity = "0";
    setTimeout(() => t.remove(), 450);
  }, 3200);
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

/** Vibrazione breve sui telefoni che la supportano. */
export function buzz(ms = 30) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch {
    /* niente */
  }
}

export const storage = {
  get(k, d = null) {
    try {
      const v = localStorage.getItem("sagra:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("sagra:" + k, JSON.stringify(v));
    } catch {
      /* niente */
    }
  },
  del(k) {
    try {
      localStorage.removeItem("sagra:" + k);
    } catch {
      /* niente */
    }
  },
};

export function playerById(st, id) {
  return st.players.find((p) => p.id === id);
}

export function avatarOf(st, id) {
  return playerById(st, id)?.avatar ?? "❔";
}

export function nameOf(st, id) {
  return playerById(st, id)?.name ?? "???";
}

/** Chip con avatar e nome. */
export function who(st, id) {
  const p = playerById(st, id);
  return h("span", { style: { whiteSpace: "nowrap" } }, (p?.avatar ?? "❔") + " " + (p?.name ?? "???"));
}
