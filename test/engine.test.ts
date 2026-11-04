import { describe, expect, it } from "vitest";
import { Engine, HOST_GRACE_MS, INTERLUDE_MS, INTRO_MS, MAX_PLAYERS } from "../src/game/engine";
import { PAROLE_RARE } from "../src/game/content/bugiardo";
import { NO_ANSWER } from "../src/game/games/botta";
import { FakeClient, setup } from "./helpers";

describe("lobby", () => {
  it("il primo giocatore diventa host e i nomi duplicati vengono distinti", () => {
    const { client } = setup();
    const a = client("Gino");
    const b = client("gino");
    expect(a.state.hostId).toBe(a.id);
    const names = b.state.players.map((p: any) => p.name);
    expect(names).toEqual(["Gino", "gino 2"]);
  });

  it("rifiuta nomi vuoti e stanze piene", () => {
    const { client } = setup();
    const x = client("   ");
    expect(x.last("err").msg).toMatch(/nome/);
    for (let i = 0; i < MAX_PLAYERS; i++) client("P" + i);
    const late = client("Ritardatario");
    expect(late.last("err").msg).toMatch(/piena/);
  });

  it("riconnessione con token mantiene identità e punteggio", () => {
    const { client, engine } = setup();
    const a = client("Gino");
    const id = a.id;
    const token = a.token;
    a.close();
    expect(engine.player(id!)!.connected).toBe(false);
    const again = client();
    again.send({ t: "join", token });
    expect(again.id).toBe(id);
    expect(engine.player(id!)!.connected).toBe(true);
  });

  it("chi si disconnette in lobby viene rimosso dopo un po'", () => {
    const { client, clock, engine } = setup();
    const a = client("Gino");
    const b = client("Pina");
    b.close();
    clock.advance(60_000);
    expect(engine.players.map((p) => p.name)).toEqual(["Gino"]);
    expect(a.state.players.length).toBe(1);
  });

  it("l'host passa a un altro se non torna entro qualche secondo", () => {
    const { client, clock } = setup();
    const a = client("Gino");
    const b = client("Pina");
    a.close();
    expect(b.state.hostId).toBe(a.id);
    clock.advance(HOST_GRACE_MS + 100);
    expect(b.state.hostId).toBe(b.id);
  });

  it("l'host che ricarica la pagina resta host", () => {
    const { client, clock } = setup();
    const a = client("Gino");
    const b = client("Pina");
    const token = a.token;
    a.close();
    clock.advance(2000);
    const again = client();
    again.send({ t: "join", token, tokenSource: "session" });
    clock.advance(HOST_GRACE_MS + 100);
    expect(b.state.hostId).toBe(again.id);
  });

  it("solo l'host può aggiungere bot e avviare", () => {
    const { client } = setup();
    const a = client("Gino");
    const b = client("Pina");
    b.send({ t: "addBot" });
    expect(a.state.players.length).toBe(2);
    a.send({ t: "addBot" });
    expect(a.state.players.length).toBe(3);
    expect(a.state.players[2].isBot).toBe(true);
    b.send({ t: "start" });
    expect(a.state.phase).toBe("lobby");
    a.send({ t: "start" });
    expect(a.state.phase).toBe("intro");
  });

  it("gli spettatori non contano come giocatori", () => {
    const { client } = setup();
    const a = client("Gino");
    const tv = client(undefined);
    tv.send({ t: "join", spectator: true });
    expect(a.state.players.length).toBe(1);
    expect(a.state.spectators).toBe(1);
    expect(tv.state.hostId).toBe(a.id);
  });

  it("le reazioni emoji arrivano a tutti", () => {
    const { client } = setup();
    const a = client("Gino");
    const b = client("Pina");
    a.send({ t: "react", emoji: "🤌" });
    expect(b.last("react")).toMatchObject({ from: a.id, emoji: "🤌" });
  });
});

describe("serata completa con i bot", () => {
  it("arriva fino al finale con premi e classifica", () => {
    const { client, clock } = setup(7);
    const a = client("Gino");
    for (let i = 0; i < 4; i++) a.send({ t: "addBot" });
    a.send({ t: "start", length: 1 });
    expect(a.state.playlist).toEqual(["espresso", "botta", "pigiatura", "pittore", "bugiardo", "chi"]);

    // l'umano gioca in modo semplice: risponde a tutto quello che può
    let guard = 0;
    while (a.state.phase !== "final" && guard++ < 5000) {
      const g = a.game;
      if (a.state.phase === "playing" && g) {
        if (g.kind === "espresso" && g.phase === "armed" && !g.tapped) {
          clock.advance(g.goDelay + 5);
          a.act({ a: "tap", ms: 250 });
        } else if (g.kind === "botta" && g.phase === "answer") {
          for (const m of g.mine) if (!m.answered) a.act({ a: "answer", match: m.match, text: "Risposta di Gino" });
        } else if (g.kind === "botta" && g.phase === "vote" && g.canVote && g.myVote == null) {
          a.act({ a: "vote", choice: 0 });
        } else if (g.kind === "pittore" && g.isDrawer && g.phase === "choose") {
          a.act({ a: "choose", i: 1 });
        } else if (g.kind === "pittore" && g.isDrawer && g.phase === "draw" && !g._drew) {
          a.act({ a: "draw", id: 1, c: "#ff0000", w: 8, p: [10, 10, 500, 500, 900, 100] });
        } else if (g.kind === "bugiardo" && g.phase === "write" && !g.myLie) {
          a.act({ a: "lie", text: "Un tipo di formaggio molto puzzolente" });
        } else if (g.kind === "bugiardo" && g.phase === "pick" && g.myPick == null) {
          const o = g.options.find((x: any) => !x.mine);
          if (o) a.act({ a: "pick", option: o.id });
        } else if (g.kind === "chi" && g.phase === "vote" && !g.myVote) {
          a.act({ a: "vote", target: g.candidates[0] });
        }
      }
      clock.advance(500);
    }
    expect(a.state.phase).toBe("final");
    const scores = a.state.players.map((p: any) => p.score);
    expect(scores.some((s: number) => s > 0)).toBe(true);
    expect(a.state.awards[0].title).toBe("Re della Sagra");
    expect(a.state.awards.length).toBeGreaterThan(2);
    // nessun timer di gioco deve restare appeso
    expect(clock.pending()).toBe(0);

    // e si può tornare in lobby e rigiocare
    a.send({ t: "lobby" });
    expect(a.state.phase).toBe("lobby");
    expect(a.state.players.every((p: any) => p.score === 0)).toBe(true);
  });

  it("l'host può saltare intro e intervalli", () => {
    const { client } = setup();
    const a = client("Gino");
    a.send({ t: "start", games: ["espresso"] });
    expect(a.state.phase).toBe("intro");
    a.send({ t: "skip" });
    expect(a.state.phase).toBe("playing");
    expect(a.game.kind).toBe("espresso");
  });

  it("filtra i giochi che richiedono più giocatori", () => {
    const { client } = setup();
    const a = client("Gino");
    a.send({ t: "start", games: ["botta", "chi"] });
    expect(a.state.phase).toBe("lobby");
    expect(a.last("err").msg).toMatch(/giocatori/);
  });

  it("l'host può chiudere la serata in anticipo", () => {
    const { client } = setup();
    const a = client("Gino");
    a.send({ t: "start", games: ["espresso"] });
    a.send({ t: "endGame" });
    expect(a.state.phase).toBe("final");
  });
});

describe("Espresso Express", () => {
  function startEspresso() {
    const s = setup(3);
    const a = s.client("Gino");
    const b = s.client("Pina");
    a.send({ t: "start", games: ["espresso"], length: 1 });
    s.clock.advance(INTRO_MS);
    s.clock.advance(2500); // ready → armed
    return { ...s, a, b };
  }

  it("il più veloce prende più punti, chi anticipa perde punti", () => {
    const { a, b, clock } = startEspresso();
    expect(a.game.phase).toBe("armed");
    // b preme subito: troppo presto
    b.act({ a: "tap", early: true });
    expect(b.game.myEarly).toBe(true);
    clock.advance(a.game.goDelay + 10);
    a.act({ a: "tap", ms: 230 });
    expect(a.game.phase).toBe("result");
    const res = a.game.results;
    expect(res.find((r: any) => r.id === a.id).points).toBe(300);
    expect(res.find((r: any) => r.id === b.id).early).toBe(true);
    expect(a.state.players.find((p: any) => p.id === a.id).score).toBe(300);
    expect(a.state.players.find((p: any) => p.id === b.id).score).toBe(0); // mai sotto zero
  });

  it("il server smaschera chi dichiara un tap valido prima del via", () => {
    const { a, clock } = startEspresso();
    clock.advance(100);
    a.act({ a: "tap", ms: 200 });
    expect(a.game.myEarly).toBe(true);
  });

  it("reazioni sovrumane contano come anticipo", () => {
    const { a, clock } = startEspresso();
    clock.advance(a.game.goDelay + 10);
    a.act({ a: "tap", ms: 20 });
    expect(a.game.myEarly).toBe(true);
  });

  it("finisce dopo il numero di round previsto", () => {
    const { a, clock } = startEspresso();
    clock.advance(200_000);
    expect(a.state.phase).toBe("final");
  });
});

describe("Botta e Risposta", () => {
  function startBotta(n = 3) {
    const s = setup(11);
    const cs = ["A", "B", "C", "D"].slice(0, n).map((name) => s.client(name));
    cs[0].send({ t: "start", games: ["botta"], length: 1 });
    s.clock.advance(INTRO_MS);
    return { ...s, cs };
  }

  it("ogni giocatore riceve due spunti e ogni spunto ha due autori", () => {
    const { cs } = startBotta(4);
    for (const c of cs) expect(c.game.mine.length).toBe(2);
  });

  it("i voti assegnano punti e il cappotto dà bonus", () => {
    const { cs } = startBotta(4);
    for (const c of cs) for (const m of c.game.mine) c.act({ a: "answer", match: m.match, text: `${c.id}-${m.match}` });
    expect(cs[0].game.phase).toBe("vote");
    const voters = cs.filter((c) => c.game.canVote);
    expect(voters.length).toBe(2);
    for (const v of voters) v.act({ a: "vote", choice: 0 });
    const g = cs[0].game;
    expect(g.phase).toBe("reveal");
    expect(g.sweep).toBe(0);
    expect(g.points[0]).toBe(2 * 100 + 250);
    const author = cs[0].state.players.find((p: any) => p.id === g.authors[0]);
    expect(author.score).toBe(450);
  });

  it("chi non risponde ottiene il silenzio imbarazzante", () => {
    const { cs, clock } = startBotta(3);
    clock.advance(81_000);
    expect(cs[0].game.phase).toBe("vote");
    expect(cs[0].game.answers).toEqual([NO_ANSWER, NO_ANSWER]);
  });

  it("gli autori non possono votare il proprio spunto", () => {
    const { cs } = startBotta(3);
    for (const c of cs) for (const m of c.game.mine) c.act({ a: "answer", match: m.match, text: "x" + c.id });
    const author = cs.find((c) => c.game.isAuthor)!;
    author.act({ a: "vote", choice: 0 });
    expect(author.game.myVote).toBe(null);
  });
});

describe("Pittore Maledetto", () => {
  function startPittore() {
    const s = setup(5);
    const a = s.client("A");
    const b = s.client("B");
    const c = s.client("C");
    a.send({ t: "start", games: ["pittore"], length: 1 });
    s.clock.advance(INTRO_MS);
    const all = [a, b, c];
    const drawer = all.find((x) => x.game.isDrawer)!;
    const others = all.filter((x) => x !== drawer);
    return { ...s, all, drawer, others };
  }

  it("solo chi disegna vede le parole, gli altri vedono la maschera", () => {
    const { drawer, others } = startPittore();
    expect(drawer.game.choices.length).toBe(3);
    expect(others[0].game.choices).toBe(null);
    drawer.act({ a: "choose", i: 0 });
    expect(drawer.game.word).toBeTruthy();
    expect(others[0].game.word).toBe(null);
    expect(others[0].game.mask.replace(/[^_]/g, "").length).toBeGreaterThan(0);
  });

  it("i tratti arrivano agli altri e indovinare dà punti a entrambi", () => {
    const { drawer, others } = startPittore();
    drawer.act({ a: "choose", i: 0 });
    drawer.act({ a: "draw", id: 1, c: "#ff0000", w: 5, p: [1, 2, 3, 4] });
    expect(others[0].last("draw")).toMatchObject({ id: 1, p: [1, 2, 3, 4] });
    const word = drawer.game.word;
    others[0].act({ a: "guess", text: "sbagliato" });
    expect(others[1].game.chat.at(-1).text).toBe("sbagliato");
    others[0].act({ a: "guess", text: word.toUpperCase() });
    expect(others[0].game.hasGuessed).toBe(true);
    expect(others[0].game.word).toBe(word);
    const sc = (c: any) => c.state.players.find((p: any) => p.id === c.id).score;
    expect(sc(others[0])).toBeGreaterThanOrEqual(300);
    expect(sc(drawer)).toBe(60);
    // la parola giusta non finisce nella chat pubblica
    expect(others[1].game.chat.some((l: any) => l.text.includes(word))).toBe(false);
  });

  it("quando tutti indovinano si passa alla rivelazione", () => {
    const { drawer, others } = startPittore();
    drawer.act({ a: "choose", i: 0 });
    const word = drawer.game.word;
    for (const o of others) o.act({ a: "guess", text: word });
    expect(drawer.game.phase).toBe("reveal");
  });

  it("chi disegna non può indovinare e gli altri non possono disegnare", () => {
    const { drawer, others } = startPittore();
    drawer.act({ a: "choose", i: 0 });
    others[0].act({ a: "draw", id: 9, p: [1, 1, 2, 2] });
    expect(drawer.last("draw")).toBe(null);
    drawer.act({ a: "guess", text: drawer.game.word });
    expect(drawer.game.guessed.length).toBe(0);
  });

  it("riconnettendosi si ricevono i tratti già fatti", () => {
    const { drawer, others, client } = startPittore();
    drawer.act({ a: "choose", i: 0 });
    drawer.act({ a: "draw", id: 1, c: "#00ff00", w: 5, p: [1, 2, 3, 4] });
    const token = others[0].token;
    others[0].close();
    const again = client();
    again.send({ t: "join", token });
    expect(again.last("redraw").strokes.length).toBe(1);
  });
});

describe("Chi è stato?", () => {
  it("chi vota con la maggioranza prende punti", () => {
    const s = setup(9);
    const [a, b, c] = [s.client("A"), s.client("B"), s.client("C")];
    a.send({ t: "start", games: ["chi"], length: 1 });
    s.clock.advance(INTRO_MS);
    a.act({ a: "vote", target: c.id });
    b.act({ a: "vote", target: c.id });
    c.act({ a: "vote", target: a.id });
    const g = a.game;
    expect(g.phase).toBe("reveal");
    expect(g.reveal.guilty).toEqual([c.id]);
    const sc = (x: any) => a.state.players.find((p: any) => p.id === x.id).score;
    expect(sc(a)).toBe(150);
    expect(sc(b)).toBe(150);
    expect(sc(c)).toBe(50);
  });
});

describe("Il Bugiardo", () => {
  it("punti a chi trova la verità e a chi inganna", () => {
    const s = setup(13);
    const [a, b, c] = [s.client("A"), s.client("B"), s.client("C")];
    a.send({ t: "start", games: ["bugiardo"], length: 1 });
    s.clock.advance(INTRO_MS);
    a.act({ a: "lie", text: "Balla di A" });
    b.act({ a: "lie", text: "Balla di B" });
    c.act({ a: "lie", text: "Balla di C" });
    const g = a.game;
    expect(g.phase).toBe("pick");
    expect(g.options.length).toBe(4);
    const truthId = (() => {
      // la vera è quella che nessuno possiede: la troviamo per esclusione
      const mine = [a, b, c].map((x) => x.game.options.find((o: any) => o.mine).id);
      return g.options.find((o: any) => !mine.includes(o.id)).id;
    })();
    const bLie = b.game.options.find((o: any) => o.mine).id;
    // non posso votare la mia balla
    a.act({ a: "pick", option: a.game.options.find((o: any) => o.mine).id });
    expect(a.game.myPick).toBe(null);
    a.act({ a: "pick", option: truthId });
    c.act({ a: "pick", option: bLie });
    b.act({ a: "pick", option: truthId });
    expect(a.game.phase).toBe("reveal");
    const sc = (x: any) => a.state.players.find((p: any) => p.id === x.id).score;
    expect(sc(a)).toBe(200);
    expect(sc(b)).toBe(300);
    expect(sc(c)).toBe(0);
  });

  it("rifiuta una 'balla' identica alla definizione vera", () => {
    const s = setup(13);
    const [a] = [s.client("A"), s.client("B")];
    a.send({ t: "start", games: ["bugiardo"], length: 1 });
    s.clock.advance(INTRO_MS);
    const def = PAROLE_RARE.find((w) => w.word === a.game.word)!.def;
    a.act({ a: "lie", text: def.toUpperCase() + "!" });
    expect(a.last("toast").text).toMatch(/vera/);
    expect(a.game.myLie).toBe(null);
  });
});

describe("intervalli", () => {
  it("tra un gioco e l'altro c'è la classifica con i punti del gioco precedente", () => {
    const s = setup(1);
    const a = s.client("A");
    s.client("B");
    a.send({ t: "start", games: ["espresso", "bugiardo"], length: 1 });
    s.clock.advance(INTRO_MS);
    let guard = 0;
    while (a.state.phase === "playing" && guard++ < 1000) s.clock.advance(500);
    expect(a.state.phase).toBe("interlude");
    expect(a.state.lastGameScores).toBeTruthy();
    s.clock.advance(INTERLUDE_MS);
    expect(a.state.phase).toBe("intro");
    expect(a.state.currentKind).toBe("bugiardo");
  });
});

describe("La Pigiatura", () => {
  function startPigia() {
    const s = setup(21);
    const a = s.client("A");
    const b = s.client("B");
    a.send({ t: "start", games: ["pigiatura"], length: 1 });
    s.clock.advance(INTRO_MS);
    s.clock.advance(3500); // ready → stomp
    return { ...s, a, b };
  }

  it("chi pesta di più vince", () => {
    const { a, b, clock } = startPigia();
    expect(a.game.phase).toBe("stomp");
    for (let i = 0; i < 20; i++) {
      clock.advance(500);
      a.act({ a: "taps", n: 6 });
      b.act({ a: "taps", n: 3 });
    }
    clock.advance(1000);
    expect(a.game.phase).toBe("result");
    const r = a.game.results;
    expect(r[0].id).toBe(a.id);
    expect(r[0].points).toBe(300);
    expect(r[1].points).toBe(200);
  });

  it("un autoclicker viene limitato", () => {
    const { a, clock } = startPigia();
    clock.advance(1000);
    a.act({ a: "taps", n: 5000 });
    expect(a.game.mine).toBeLessThanOrEqual(1 * 20 + 2);
  });

  it("le pestate fuori tempo non contano", () => {
    const { a, clock } = startPigia();
    clock.advance(10_500);
    a.act({ a: "taps", n: 5 });
    expect(a.game.mine).toBe(0);
  });
});

describe("connessioni", () => {
  it("una seconda scheda con token condiviso non ruba il posto", () => {
    const { client } = setup();
    const a = client("Gino");
    const tab2 = client();
    tab2.send({ t: "join", token: a.token, tokenSource: "local", name: "Pina" });
    expect(tab2.id).not.toBe(a.id);
    expect(tab2.state.players.length).toBe(2);
  });

  it("lo stesso token da sessione rientra nello stesso posto", () => {
    const { client } = setup();
    const a = client("Gino");
    const again = client();
    again.send({ t: "join", token: a.token, tokenSource: "session" });
    expect(again.id).toBe(a.id);
  });

  it("i messaggi a raffica vengono limitati", () => {
    const { client } = setup();
    const a = client("Gino");
    const b = client("Pina");
    for (let i = 0; i < 50; i++) a.send({ t: "react", emoji: "🔥" });
    expect(b.msgs.filter((m) => m.t === "react").length).toBe(1);
    for (let i = 0; i < 500; i++) a.send({ t: "ping" });
    const pongs = a.msgs.filter((m) => m.t === "pong").length;
    expect(pongs).toBeLessThan(150);
  });
});

describe("chat della tavolata", () => {
  it("i messaggi arrivano a tutti e chi entra riceve la cronologia", () => {
    const { client } = setup();
    const a = client("Gino");
    const b = client("Pina");
    a.send({ t: "chat", text: "  ciao a tutti!  " });
    expect(b.last("chat").msg).toMatchObject({ from: a.id, name: "Gino", text: "ciao a tutti!" });
    const c = client("Ugo");
    expect(c.last("chatHistory").msgs.map((m: any) => m.text)).toEqual(["ciao a tutti!"]);
  });

  it("si può chattare anche durante i giochi, ma non troppo in fretta", () => {
    const { client, clock } = setup();
    const a = client("Gino");
    const b = client("Pina");
    a.send({ t: "start", games: ["espresso"] });
    a.send({ t: "chat", text: "uno" });
    a.send({ t: "chat", text: "due" });
    expect(b.msgs.filter((m) => m.t === "chat").length).toBe(1);
    clock.advance(700);
    a.send({ t: "chat", text: "tre" });
    expect(b.msgs.filter((m) => m.t === "chat").length).toBe(2);
  });

  it("niente spoiler della parola durante il Pittore", () => {
    const s = setup(5);
    const all = [s.client("A"), s.client("B"), s.client("C")];
    all[0].send({ t: "start", games: ["pittore"], length: 1 });
    s.clock.advance(INTRO_MS);
    const drawer = all.find((x) => x.game.isDrawer)!;
    const other = all.find((x) => x !== drawer)!;
    drawer.act({ a: "choose", i: 0 });
    const word = drawer.game.word;
    drawer.send({ t: "chat", text: `è facile, è un ${word.toUpperCase()}!` });
    expect(other.last("chat")).toBe(null);
    expect(drawer.last("toast").text).toMatch(/spoiler/);
    s.clock.advance(1000);
    drawer.send({ t: "chat", text: "dai che ce la fate" });
    expect(other.last("chat").msg.text).toBe("dai che ce la fate");
  });

  it("l'host decide se la tavolata è pubblica", () => {
    const { client, engine } = setup();
    const a = client("Gino");
    const b = client("Pina");
    expect(engine.summary().public).toBe(false); // di default è privata
    b.send({ t: "setPublic", value: true });
    expect(engine.summary().public).toBe(false);
    a.send({ t: "setPublic", value: true });
    expect(engine.summary().public).toBe(true);
    expect(b.state.isPublic).toBe(true);
  });
});

describe("riassunto per la Piazza", () => {
  it("viene notificato a ogni cambiamento rilevante, con l'host giusto", () => {
    const { clock } = setup();
    const out: any[] = [];
    const e = new Engine({ code: "TEST", scheduler: clock, onSummary: (s) => out.push(s) });
    const a = new FakeClient(e, "c1");
    a.join("Luca");
    expect(out.at(-1)).toMatchObject({ host: "Luca", public: false, players: 1, connected: 1 });
    a.send({ t: "setPublic", value: true });
    expect(out.at(-1).public).toBe(true);
    const n = out.length;
    a.send({ t: "react", emoji: "🔥" });
    expect(out.length).toBe(n); // niente di nuovo, niente notifica
  });
});

describe("turni personalizzati", () => {
  it("l'host sceglie quante volte disegna ognuno nel Pittore", () => {
    const s = setup(5);
    const [a] = [s.client("A"), s.client("B"), s.client("C")];
    a.send({ t: "start", games: ["pittore"], length: 1, rounds: { pittore: 3 } });
    s.clock.advance(INTRO_MS);
    expect(a.game.turns).toBe(9);
  });

  it("valori assurdi vengono ignorati", () => {
    const s = setup(5);
    const [a] = [s.client("A"), s.client("B")];
    a.send({ t: "start", games: ["pittore"], length: 1, rounds: { pittore: 99 } });
    s.clock.advance(INTRO_MS);
    expect(a.game.turns).toBe(2);
  });
});
