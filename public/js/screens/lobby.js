import { sfx } from "../audio.js";
import { createChatBox } from "../chat.js";
import { clear, h, storage, toast } from "../ui.js";
import { AVATARS } from "./home.js";

const LENGTHS = [
  [1, "Corta"],
  [2, "Normale"],
  [3, "Lunga"],
];

function qrSvg(text) {
  if (typeof window.qrcode !== "function") return null;
  const q = window.qrcode(0, "M");
  q.addData(text);
  q.make();
  const div = document.createElement("div");
  div.innerHTML = q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
  return div.firstElementChild;
}

export const LOBBY = {
  key: () => "lobby",
  mount(root, app, st) {
    const url = `${location.origin}/${st.code}`;
    let selected = new Set(storage.get("games", null) ?? app.hello?.order ?? ["espresso", "botta", "pittore", "bugiardo", "chi"]);
    let length = storage.get("length", 2);
    let pittoreRounds = storage.get("pittoreRounds", 2);
    let editing = false;

    const playersBox = h("div.players-grid");
    const hostBox = h("div");
    const countLbl = h("span");

    const share = async () => {
      sfx("click");
      try {
        if (navigator.share) {
          await navigator.share({ title: "SAGRA!", text: "Vieni a giocare alla Sagra! Codice " + st.code, url });
          return;
        }
      } catch {
        /* annullato */
      }
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copiato! Mandalo nel gruppo di famiglia.");
      } catch {
        toast(url);
      }
    };

    const left = h(
      "div.card.checkered.center",
      h("h2", "La tavolata"),
      h("p.muted", { style: { margin: 0 } }, "Codice per entrare:"),
      h("div.room-code-big", st.code),
      h("div.qr", qrSvg(url)),
      h("p.muted", { style: { margin: "4px 0 10px", wordBreak: "break-all" } }, url.replace(/^https?:\/\//, "")),
      h(
        "div.row",
        { style: { justifyContent: "center" } },
        h("button.btn.small.gold", { onclick: share }, "📲 Invita"),
        h("button.btn.small.ghost", { onclick: () => window.open(url + "?tv=1", "_blank") }, "📺 Apri TV"),
      ),
    );

    // chat della tavolata, sempre visibile in lobby
    const chat = createChatBox({
      placeholder: app.spectator ? "La TV non può scrivere 📺" : "Saluta la tavolata…",
      isMine: (m) => m.from === app.you,
      onSend: (text) => app.send({ t: "chat", text }),
      empty: "Nessuno ha ancora detto niente. Saluta tu!",
    });
    chat.setAll(app.roomChat);
    app.chatViews.add(chat);
    const visBox = h("div.vis-row");

    const right = h(
      "div.stack",
      h("div.card", h("h2", "Chi c'è a tavola ", countLbl), playersBox, visBox),
      hostBox,
      h("div.card.lobby-chat", h("h2", "💬 Due chiacchiere"), chat.el),
    );

    root.append(h("div.lobby", left, right));

    const renderPlayers = (st) => {
      countLbl.textContent = `(${st.players.length})`;
      clear(playersBox);
      for (const p of st.players) {
        const me = p.id === app.you;
        const chip = h(
          "div.pchip" + (me ? ".me" : "") + (p.connected ? "" : ".off"),
          { style: { "--pc": p.color }, title: me ? "Tocca per cambiare avatar" : p.name },
          p.id === st.hostId ? h("span.tag", "👑 host") : p.isBot ? h("span.tag", "🤖 bot") : me ? h("span.tag", "tu") : null,
          app.isHost && !me ? h("button.kick", { title: "Caccia " + p.name, onclick: () => app.send({ t: "kick", id: p.id }) }, "✕") : null,
          h("div.av", p.avatar),
          h("div.nm", p.name),
        );
        if (me) chip.style.cursor = "pointer";
        if (me) chip.onclick = () => openEditor();
        playersBox.appendChild(chip);
      }
      if (st.spectators) playersBox.appendChild(h("div.pchip", { style: { "--pc": "#888" } }, h("div.av", "📺"), h("div.nm", st.spectators + " TV")));
    };

    const openEditor = () => {
      if (editing || app.spectator) return;
      editing = true;
      const me = app.me;
      const nameIn = h("input.field", { value: me.name, maxLength: 18 });
      let av = me.avatar;
      const used = new Set(app.st.players.filter((p) => p.id !== app.you).map((p) => p.avatar));
      const pick = h(
        "div.avatar-picker",
        AVATARS.map((a) =>
          h("button", {
            type: "button",
            class: a === av ? "sel" : "",
            disabled: used.has(a),
            style: used.has(a) ? { opacity: 0.3 } : null,
            onclick: (e) => {
              av = a;
              for (const b of pick.children) b.classList.remove("sel");
              e.currentTarget.classList.add("sel");
            },
          }, a),
        ),
      );
      const card = h(
        "div.card",
        h("h2", "Il tuo profilo"),
        h("div.stack", nameIn, pick, h("div.row",
          h("button.btn.small.green", {
            onclick: () => {
              app.send({ t: "profile", name: nameIn.value, avatar: av });
              storage.set("name", nameIn.value.trim());
              storage.set("avatar", av);
              editing = false;
              card.remove();
            },
          }, "Salva"),
          h("button.btn.small.ghost", { onclick: () => ((editing = false), card.remove()) }, "Annulla"),
        )),
      );
      right.insertBefore(card, right.firstChild);
      nameIn.focus();
    };

    const renderHost = (st) => {
      clear(hostBox);
      if (app.spectator) {
        hostBox.appendChild(h("div.card.center", h("h2", "📺 Modalità TV"), h("p.muted", "Questo schermo mostra la partita a tutti. I giocatori entrano col telefono inquadrando il QR.")));
        return;
      }
      if (!app.isHost) {
        const host = st.players.find((p) => p.id === st.hostId);
        hostBox.appendChild(
          h("div.card.center", h("div.big-wait", h("div.e", "🍷"), h("h2", "Si aspetta l'host"), h("p.muted", `${host ? host.avatar + " " + host.name : "L'host"} sta scegliendo i giochi. Intanto versati da bere.`))),
        );
        return;
      }
      const games = app.hello?.games ?? {};
      const order = app.hello?.order ?? Object.keys(games);
      const n = st.players.length;
      const toggles = h(
        "div.game-toggles",
        order.map((k) => {
          const g = games[k];
          const na = g.minPlayers > n;
          const b = h(
            "button.gtoggle" + (selected.has(k) ? ".on" : "") + (na ? ".na" : ""),
            {
              type: "button",
              onclick: () => {
                if (selected.has(k)) selected.delete(k);
                else selected.add(k);
                storage.set("games", [...selected]);
                sfx("click");
                renderHost(app.st);
              },
            },
            h("div.e", g.emoji),
            h("b", g.title),
            h("small", na ? `Servono almeno ${g.minPlayers} giocatori` : g.tagline),
          );
          return b;
        }),
      );
      const seg = h(
        "div.seg",
        LENGTHS.map(([v, label]) =>
          h("button" + (length === v ? ".sel" : ""), {
            type: "button",
            onclick: () => {
              length = v;
              storage.set("length", v);
              sfx("click");
              renderHost(app.st);
            },
          }, label),
        ),
      );
      const playable = order.filter((k) => selected.has(k) && games[k].minPlayers <= n);
      const pittoreSeg = h(
        "div.seg",
        [1, 2, 3, 4].map((v) =>
          h("button" + (pittoreRounds === v ? ".sel" : ""), {
            type: "button",
            "aria-label": v + " turni a testa",
            onclick: () => {
              pittoreRounds = v;
              storage.set("pittoreRounds", v);
              sfx("click");
              renderHost(app.st);
            },
          }, String(v)),
        ),
      );
      const start = h(
        "button.btn.block.green",
        {
          disabled: playable.length === 0,
          onclick: () => {
            app.send({ t: "start", games: playable, length, rounds: { pittore: pittoreRounds } });
          },
        },
        playable.length ? `🎉 Si comincia! (${playable.length} ${playable.length === 1 ? "gioco" : "giochi"})` : "Scegli almeno un gioco",
      );
      hostBox.appendChild(
        h(
          "div.card",
          h("h2", "Il menù della serata"),
          h("p.muted", { style: { marginTop: 0 } }, "Sei l'host: scegli i giochi e la durata."),
          toggles,
          h("div.row", { style: { marginTop: "14px", justifyContent: "space-between" } }, h("label.lbl", { style: { margin: 0 } }, "Durata"), seg),
          playable.includes("pittore")
            ? h("div.row", { style: { marginTop: "10px", justifyContent: "space-between" } }, h("label.lbl", { style: { margin: 0 } }, "🎨 Disegni a testa nel Pittore"), pittoreSeg)
            : null,
          h(
            "div.row",
            { style: { marginTop: "14px" } },
            h("button.btn.small.ghost", { onclick: () => app.send({ t: "addBot" }), disabled: n >= 12 }, "🤖 Aggiungi un cugino (bot)"),
            h("span.muted", { style: { fontSize: "14px" } }, n < 3 ? "Pochi a tavola? I bot fanno numero." : ""),
          ),
          h("div", { style: { marginTop: "16px" } }, start),
        ),
      );
    };

    const renderVis = (st) => {
      if (app.isHost && !app.spectator) {
        const cb = h("input", {
          type: "checkbox",
          checked: st.isPublic,
          onchange: (e) => {
            app.send({ t: "setPublic", value: e.target.checked });
            sfx("click");
          },
        });
        visBox.replaceChildren(
          h("label.switch", cb, h("span.slider"), h("span.lbl-text", st.isPublic ? "🌍 Visibile nella Piazza: chiunque può sedersi" : "🔒 Tavolata privata: si entra solo col codice")),
        );
      } else {
        visBox.replaceChildren(h("p.muted", { style: { margin: "10px 0 0", fontSize: "14px" } }, st.isPublic ? "🌍 Tavolata pubblica: compare nella Piazza" : "🔒 Tavolata privata"));
      }
    };

    renderPlayers(st);
    renderHost(st);
    renderVis(st);
    return {
      destroy() {
        app.chatViews.delete(chat);
      },
      update(st, prev) {
        renderPlayers(st);
        if (prev?.isPublic !== st.isPublic || prev?.hostId !== st.hostId) renderVis(st);
        const hostChanged = prev?.hostId !== st.hostId;
        const countChanged = prev?.players.length !== st.players.length;
        if (hostChanged || countChanged) renderHost(st);
      },
    };
  },
};
