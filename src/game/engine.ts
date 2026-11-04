import { GAMES, GAME_ORDER } from "./catalog";
import { BOT_NAMES } from "./content/bot";
import { NONNA, fill } from "./content/nonna";
import { createGame } from "./games";
import type {
  GameContext,
  GameKind,
  MiniGame,
  NonnaLine,
  Player,
  PublicPlayer,
  RoomPhase,
  Scheduler,
} from "./types";
import { cleanText, pick, randomId, shuffle } from "./util";

export const AVATARS = [
  "🍕", "🍝", "🧀", "🍷", "🍋", "🥖", "🍅", "🌶️", "🫒", "🍨",
  "🐷", "🐔", "🐐", "🐈", "🐕", "🦆", "🐌", "🦉", "🐸", "🐙",
  "👵", "👴", "🧔", "🤌", "🎺", "🪗", "🛵", "⛪", "🎩", "🌋",
];

export const COLORS = [
  "#e63946", "#f4a261", "#e9c46a", "#2a9d8f", "#4cc9f0", "#7b2cbf",
  "#ff70a6", "#06d6a0", "#ffd166", "#ef476f", "#118ab2", "#8ac926",
];

export const MAX_PLAYERS = 12;
export const INTRO_MS = 12_000;
export const INTERLUDE_MS = 12_000;
const LOBBY_DROP_MS = 45_000;
/** quanto aspettare prima di passare il ruolo di host (es. ha solo ricaricato la pagina) */
export const HOST_GRACE_MS = 10_000;

interface Conn {
  id: string;
  playerId: string | null;
  send: (data: string) => void;
  /** secchiello per limitare i messaggi al secondo */
  budget: number;
  budgetAt: number;
  lastReact: number;
  lastChat: number;
}

/** messaggi al secondo concessi a ogni connessione (con un po' di scorta) */
const MSG_RATE = 60;
const MSG_BURST = 120;

/** Riassunto pubblico della stanza, per la Piazza (lista tavolate). */
export interface RoomSummary {
  code: string;
  public: boolean;
  phase: RoomPhase;
  players: number;
  max: number;
  avatars: string[];
  host: string | null;
  hostAvatar: string | null;
  connected: number;
}

export interface ChatMsg {
  id: number;
  from: string;
  name: string;
  avatar: string;
  color: string;
  text: string;
  ts: number;
}

export const CHAT_MAX = 140;
const CHAT_KEEP = 60;
const CHAT_GAP_MS = 600;

export interface EngineOptions {
  code: string;
  scheduler: Scheduler;
  rng?: () => number;
  /** chiamata (al massimo una volta per flush) quando il riassunto pubblico cambia */
  onSummary?: (s: RoomSummary) => void;
}

export class Engine {
  readonly code: string;
  private sched: Scheduler;
  private rng: () => number;

  players: Player[] = [];
  private conns = new Map<string, Conn>();
  hostId: string | null = null;
  /** se la tavolata compare nella Piazza (di default no: privè!) */
  isPublic = false;
  chatLog: ChatMsg[] = [];
  private chatSeq = 0;
  private onSummary?: (s: RoomSummary) => void;
  private lastSummaryKey = "";
  phase: RoomPhase = "lobby";
  private deadline: number | null = null;

  playlist: GameKind[] = [];
  gameIndex = -1;
  length = 2;
  rounds: Partial<Record<GameKind, number>> = {};
  game: MiniGame | null = null;
  private lastGameScores: Record<string, number> = {};
  awards: { title: string; emoji: string; playerId: string; why: string }[] = [];

  private roomTimer: unknown = null;
  private gameTimers = new Set<unknown>();
  private dropTimers = new Map<string, unknown>();
  private dirty = false;
  private gameToken = 0;
  private hostLeftAt: number | null = null;
  private hostTimer: unknown = null;

  constructor(opts: EngineOptions) {
    this.code = opts.code;
    this.sched = opts.scheduler;
    this.rng = opts.rng ?? Math.random;
    this.onSummary = opts.onSummary;
  }

  // ---------------------------------------------------------------- connessioni

  connect(connId: string, send: (data: string) => void): void {
    this.conns.set(connId, { id: connId, playerId: null, send, budget: MSG_BURST, budgetAt: this.sched.now(), lastReact: 0, lastChat: 0 });
    this.raw(connId, { t: "hello", code: this.code, avatars: AVATARS, games: GAMES, order: GAME_ORDER });
  }

  disconnect(connId: string): void {
    this.run(() => {
      const c = this.conns.get(connId);
      this.conns.delete(connId);
      if (!c?.playerId) return;
      const p = this.player(c.playerId);
      if (!p) return;
      // il giocatore potrebbe avere un'altra connessione aperta
      const stillHere = [...this.conns.values()].some((x) => x.playerId === p.id);
      if (stillHere) return;
      p.connected = false;
      this.dirty = true;
      if (this.phase === "lobby" && !p.spectator) {
        const h = this.sched.setTimeout(() => this.run(() => this.dropIfGone(p.id)), LOBBY_DROP_MS);
        this.dropTimers.set(p.id, h);
      }
      if (p.spectator) {
        this.players = this.players.filter((x) => x.id !== p.id);
      }
      this.game?.onPlayerLeft?.(p.id);
      if (p.id === this.hostId) {
        this.hostLeftAt = this.sched.now();
        if (this.hostTimer) this.sched.clearTimeout(this.hostTimer);
        this.hostTimer = this.sched.setTimeout(() => {
          this.hostTimer = null;
          this.run(() => this.ensureHost());
        }, HOST_GRACE_MS + 50);
      }
      this.ensureHost();
    });
  }

  connectionCount(): number {
    return this.conns.size;
  }

  message(connId: string, raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    const c = this.conns.get(connId);
    if (!c) return;
    const now = this.sched.now();
    c.budget = Math.min(MSG_BURST, c.budget + ((now - c.budgetAt) / 1000) * MSG_RATE);
    c.budgetAt = now;
    if (c.budget < 1) return; // troppi messaggi: ignorati
    c.budget -= 1;
    this.run(() => this.handle(connId, msg));
  }

  // ---------------------------------------------------------------- comandi

  private handle(connId: string, msg: any): void {
    const conn = this.conns.get(connId);
    if (!conn) return;
    if (msg.t === "ping") {
      this.raw(connId, { t: "pong", now: this.sched.now() });
      return;
    }
    if (msg.t === "join") return this.join(conn, msg);

    const p = conn.playerId ? this.player(conn.playerId) : undefined;
    if (!p) return;
    const isHost = p.id === this.hostId;

    switch (msg.t) {
      case "react": {
        const now = this.sched.now();
        if (now - conn.lastReact < 300) return;
        conn.lastReact = now;
        const emoji = cleanText(msg.emoji, 8);
        if (emoji) this.broadcast({ t: "react", from: p.id, emoji });
        return;
      }
      case "chat":
        this.chat(conn, p, msg.text);
        return;
      case "setPublic":
        if (isHost) {
          this.isPublic = !!msg.value;
          this.dirty = true;
        }
        return;
      case "start":
        if (isHost && this.phase === "lobby") this.startParty(msg.games, msg.length, msg.rounds);
        return;
      case "addBot":
        if (isHost && this.phase === "lobby") this.addBot();
        return;
      case "kick":
        if (isHost && this.phase === "lobby") this.kick(String(msg.id));
        return;
      case "skip":
        if (isHost && (this.phase === "intro" || this.phase === "interlude")) this.advance();
        return;
      case "endGame":
        // l'host può chiudere la serata in anticipo
        if (isHost && this.phase !== "lobby" && this.phase !== "final") this.toFinal();
        return;
      case "lobby":
        if (isHost && this.phase === "final") this.toLobby();
        return;
      case "profile":
        if (this.phase === "lobby") {
          const name = cleanText(msg.name, 18);
          if (name) p.name = this.uniqueName(name, p.id);
          if (typeof msg.avatar === "string" && AVATARS.includes(msg.avatar)) p.avatar = msg.avatar;
          this.dirty = true;
        }
        return;
      case "act":
        if (this.phase === "playing" && this.game && !p.spectator) {
          this.game.onAction(p.id, msg);
        }
        return;
    }
  }

  private join(conn: Conn, msg: any): void {
    // riconnessione con token
    if (typeof msg.token === "string" && msg.token) {
      const existing = this.players.find((x) => x.token === msg.token);
      // Un token preso dal localStorage condiviso (es. seconda scheda dello stesso
      // browser) non deve "rubare" il posto a un giocatore ancora collegato.
      const busy = !!existing && [...this.conns.values()].some((c) => c.playerId === existing.id);
      if (existing && !(busy && msg.tokenSource === "local")) {
        conn.playerId = existing.id;
        existing.connected = true;
        const h = this.dropTimers.get(existing.id);
        if (h) {
          this.sched.clearTimeout(h);
          this.dropTimers.delete(existing.id);
        }
        this.raw(conn.id, { t: "joined", id: existing.id, token: existing.token });
        this.ensureHost();
        this.dirty = true;
        this.sendCatchUp(existing.id);
        this.raw(conn.id, { t: "chatHistory", msgs: this.chatLog });
        return;
      }
    }

    const spectator = !!msg.spectator;
    const name = cleanText(msg.name, 18);
    if (!spectator && !name) {
      this.raw(conn.id, { t: "err", msg: "Come ti chiami? Scrivi un nome!" });
      return;
    }
    if (!spectator && this.activePlayers().length >= MAX_PLAYERS) {
      this.raw(conn.id, { t: "err", msg: "La tavola è piena! Massimo " + MAX_PLAYERS + " giocatori." });
      return;
    }
    const used = new Set(this.players.map((x) => x.avatar));
    const avatar =
      typeof msg.avatar === "string" && AVATARS.includes(msg.avatar) && !used.has(msg.avatar)
        ? msg.avatar
        : AVATARS.find((a) => !used.has(a)) ?? pick(AVATARS, this.rng);
    const p: Player = {
      id: randomId(this.rng, 8),
      token: randomId(this.rng, 24),
      name: spectator ? "Tavolo TV" : this.uniqueName(name),
      avatar: spectator ? "📺" : avatar,
      color: this.nextColor(),
      score: 0,
      connected: true,
      isBot: false,
      spectator,
      joinedAt: this.sched.now(),
    };
    this.players.push(p);
    conn.playerId = p.id;
    this.raw(conn.id, { t: "joined", id: p.id, token: p.token });
    if (!spectator) {
      const first = this.activePlayers().filter((x) => !x.isBot).length === 1;
      this.nonna(first ? pick(NONNA.welcome, this.rng) : fill(pick(NONNA.join, this.rng), { name: p.name }));
      this.fx("join");
    }
    this.ensureHost();
    this.dirty = true;
    this.sendCatchUp(p.id);
    this.raw(conn.id, { t: "chatHistory", msgs: this.chatLog });
  }

  private chat(conn: Conn, p: Player, raw: unknown): void {
    if (p.spectator) return;
    const now = this.sched.now();
    if (now - conn.lastChat < CHAT_GAP_MS) return;
    const text = cleanText(raw, CHAT_MAX);
    if (!text) return;
    conn.lastChat = now;
    // niente spoiler: durante il Pittore la parola segreta non passa in chat
    if (this.game?.censor?.(text)) {
      this.raw(conn.id, { t: "toast", text: "🤐 Niente spoiler! Le risposte si scrivono nella chat del gioco." });
      return;
    }
    const m: ChatMsg = { id: ++this.chatSeq, from: p.id, name: p.name, avatar: p.avatar, color: p.color, text, ts: now };
    this.chatLog.push(m);
    if (this.chatLog.length > CHAT_KEEP) this.chatLog.splice(0, this.chatLog.length - CHAT_KEEP);
    this.broadcast({ t: "chat", msg: m });
  }

  summary(): RoomSummary {
    const active = this.activePlayers();
    const host = this.hostId ? this.player(this.hostId) : undefined;
    return {
      code: this.code,
      public: this.isPublic,
      phase: this.phase,
      players: active.length,
      max: MAX_PLAYERS,
      avatars: active.slice(0, 8).map((p) => p.avatar),
      host: host?.name ?? null,
      hostAvatar: host?.avatar ?? null,
      connected: active.filter((p) => p.connected && !p.isBot).length,
    };
  }

  private sendCatchUp(playerId: string): void {
    const extra = this.game?.catchUp?.(playerId);
    if (extra) for (const m of extra) this.sendTo(playerId, m);
  }

  private uniqueName(name: string, selfId?: string): string {
    let n = name;
    let i = 2;
    while (this.players.some((x) => x.id !== selfId && x.name.toLowerCase() === n.toLowerCase())) {
      n = `${name} ${i++}`;
    }
    return n;
  }

  private nextColor(): string {
    const used = new Set(this.players.map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) ?? pick(COLORS, this.rng);
  }

  private addBot(): void {
    if (this.activePlayers().length >= MAX_PLAYERS) return;
    const usedNames = new Set(this.players.map((p) => p.name));
    const name = BOT_NAMES.find((n) => !usedNames.has(n)) ?? "Cugino " + (this.players.length + 1);
    const used = new Set(this.players.map((x) => x.avatar));
    const p: Player = {
      id: randomId(this.rng, 8),
      token: randomId(this.rng, 24),
      name,
      avatar: shuffle(AVATARS, this.rng).find((a) => !used.has(a)) ?? "🤖",
      color: this.nextColor(),
      score: 0,
      connected: true,
      isBot: true,
      spectator: false,
      joinedAt: this.sched.now(),
    };
    this.players.push(p);
    this.nonna(fill(pick(NONNA.botJoin, this.rng), { name }));
    this.dirty = true;
  }

  private kick(id: string): void {
    const p = this.player(id);
    if (!p || p.id === this.hostId) return;
    this.players = this.players.filter((x) => x.id !== id);
    for (const c of this.conns.values()) {
      if (c.playerId === id) {
        this.raw(c.id, { t: "kicked" });
        c.playerId = null;
      }
    }
    this.dirty = true;
  }

  private dropIfGone(id: string): void {
    this.dropTimers.delete(id);
    const p = this.player(id);
    if (!p || p.connected || this.phase !== "lobby") return;
    this.players = this.players.filter((x) => x.id !== id);
    this.nonna(fill(pick(NONNA.leave, this.rng), { name: p.name }));
    this.ensureHost();
    this.dirty = true;
  }

  private ensureHost(): void {
    const humans = this.players.filter((p) => !p.isBot && !p.spectator);
    const current = this.hostId ? this.player(this.hostId) : undefined;
    if (current && current.connected && !current.spectator) {
      this.hostLeftAt = null;
      return;
    }
    // l'host è appena uscito: gli diamo qualche secondo per tornare
    if (current && this.hostLeftAt != null && this.sched.now() - this.hostLeftAt < HOST_GRACE_MS) return;
    const next = humans.find((p) => p.connected);
    if (next) {
      if (next.id !== this.hostId) this.dirty = true;
      this.hostId = next.id;
    } else if (!current) {
      this.hostId = humans[0]?.id ?? null;
    }
  }

  // ---------------------------------------------------------------- flusso partita

  private startParty(games: unknown, length: unknown, rounds?: unknown): void {
    const n = this.activePlayers().length;
    let list = Array.isArray(games)
      ? GAME_ORDER.filter((k) => games.includes(k))
      : GAME_ORDER.slice();
    list = list.filter((k) => GAMES[k].minPlayers <= n);
    if (n < 1 || list.length === 0) {
      this.toHost({ t: "err", msg: "Servono più giocatori per i giochi scelti. Aggiungi qualche cugino (bot)!" });
      return;
    }
    this.length = length === 1 || length === 3 ? (length as number) : 2;
    this.rounds = {};
    if (rounds && typeof rounds === "object") {
      const r = Number((rounds as Record<string, unknown>).pittore);
      if (Number.isInteger(r) && r >= 1 && r <= 4) this.rounds.pittore = r;
    }
    this.playlist = list;
    for (const p of this.players) p.score = 0;
    this.awards = [];
    this.gameIndex = -1;
    this.nonna(pick(NONNA.start, this.rng));
    this.fx("start");
    this.nextGame();
  }

  private nextGame(): void {
    this.gameIndex++;
    if (this.gameIndex >= this.playlist.length) return this.toFinal();
    const kind = this.playlist[this.gameIndex];
    if (GAMES[kind].minPlayers > this.activePlayers().length) return this.nextGame();
    this.setPhase("intro", INTRO_MS);
    this.nonna(pick(NONNA.intro[kind] ?? NONNA.start, this.rng));
    this.armRoomTimer(INTRO_MS);
  }

  private advance(): void {
    if (this.phase === "intro") this.beginGame();
    else if (this.phase === "interlude") this.nextGame();
  }

  private beginGame(): void {
    const kind = this.playlist[this.gameIndex];
    this.lastGameScores = Object.fromEntries(this.players.map((p) => [p.id, p.score]));
    this.setPhase("playing", null);
    const token = ++this.gameToken;
    this.game = createGame(kind, this.makeContext(token));
    this.game.start();
  }

  private endGame(): void {
    this.clearGameTimers();
    this.game = null;
    if (this.gameIndex >= this.playlist.length - 1) return this.toFinal();
    this.setPhase("interlude", INTERLUDE_MS);
    this.nonna(pick(NONNA.interlude, this.rng));
    this.fx("interlude");
    this.armRoomTimer(INTERLUDE_MS);
  }

  private toFinal(): void {
    this.clearGameTimers();
    this.game = null;
    this.gameToken++;
    this.setPhase("final", null);
    const ranked = this.ranking();
    if (ranked[0]) this.nonna({ text: fill(pick(NONNA.final, this.rng), { name: ranked[0].name }), mood: "proud" });
    this.computeAwards();
    this.fx("final");
  }

  private toLobby(): void {
    for (const p of this.players) p.score = 0;
    this.players = this.players.filter((p) => p.connected || p.isBot);
    this.playlist = [];
    this.gameIndex = -1;
    this.awards = [];
    this.setPhase("lobby", null);
    this.ensureHost();
  }

  private computeAwards(): void {
    // i premi speciali li calcolano i giochi tramite stats; qui solo i classici
    const ranked = this.ranking();
    if (ranked.length === 0) return;
    this.awards.unshift({ title: "Re della Sagra", emoji: "👑", playerId: ranked[0].id, why: `${ranked[0].score} punti` });
    if (ranked.length >= 3) {
      const last = ranked[ranked.length - 1];
      this.awards.push({ title: "Lava i Piatti", emoji: "🧽", playerId: last.id, why: "Ultimo in classifica. Grembiule e sapone!" });
    }
  }

  /** Premio speciale assegnato da un minigioco. */
  addAward(a: { title: string; emoji: string; playerId: string; why: string }): void {
    this.awards.push(a);
  }

  private setPhase(phase: RoomPhase, durationMs: number | null): void {
    this.phase = phase;
    this.deadline = durationMs == null ? null : this.sched.now() + durationMs;
    this.clearRoomTimer();
    this.dirty = true;
  }

  private armRoomTimer(ms: number): void {
    this.clearRoomTimer();
    this.roomTimer = this.sched.setTimeout(() => {
      this.roomTimer = null;
      this.run(() => this.advance());
    }, ms);
  }

  private clearRoomTimer(): void {
    if (this.roomTimer != null) this.sched.clearTimeout(this.roomTimer);
    this.roomTimer = null;
  }

  private clearGameTimers(): void {
    for (const h of this.gameTimers) this.sched.clearTimeout(h);
    this.gameTimers.clear();
  }

  private makeContext(token: number): GameContext {
    const alive = () => token === this.gameToken && this.game != null;
    const ctx: GameContext = {
      players: () => this.activePlayers(),
      player: (id) => this.player(id),
      addScore: (id, pts) => {
        const p = this.player(id);
        if (p) {
          p.score = Math.max(0, p.score + Math.round(pts));
          this.dirty = true;
        }
      },
      after: (ms, fn) => {
        const h = this.sched.setTimeout(() => {
          this.gameTimers.delete(h);
          if (!alive()) return;
          this.run(fn);
        }, ms);
        this.gameTimers.add(h);
      },
      clearTimers: () => this.clearGameTimers(),
      setDeadline: (ms) => {
        this.deadline = ms == null ? null : this.sched.now() + ms;
        this.dirty = true;
      },
      changed: () => {
        this.dirty = true;
      },
      finish: () => {
        if (!alive()) return;
        this.gameToken++;
        this.endGame();
      },
      broadcast: (m) => this.broadcast(m),
      sendTo: (id, m) => this.sendTo(id, m),
      nonna: (l) => this.nonna(l),
      rng: () => this.rng(),
      now: () => this.sched.now(),
      length: this.length,
      rounds: { ...this.rounds },
      award: (a) => this.addAward(a),
      fx: (name) => this.fx(name),
    };
    return ctx;
  }

  // ---------------------------------------------------------------- utilità

  activePlayers(): Player[] {
    return this.players.filter((p) => !p.spectator);
  }

  player(id: string): Player | undefined {
    return this.players.find((p) => p.id === id);
  }

  ranking(): Player[] {
    return this.activePlayers()
      .slice()
      .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  }

  private pub(p: Player): PublicPlayer {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      color: p.color,
      score: p.score,
      connected: p.connected,
      isBot: p.isBot,
    };
  }

  nonna(l: NonnaLine | string): void {
    const line = typeof l === "string" ? { text: l } : l;
    this.broadcast({ t: "nonna", text: line.text, mood: line.mood ?? "happy" });
  }

  fx(name: string): void {
    this.broadcast({ t: "fx", name });
  }

  private raw(connId: string, m: unknown): void {
    const c = this.conns.get(connId);
    if (!c) return;
    try {
      c.send(JSON.stringify(m));
    } catch {
      /* connessione chiusa */
    }
  }

  broadcast(m: unknown): void {
    const s = JSON.stringify(m);
    for (const c of this.conns.values()) {
      if (!c.playerId) continue;
      try {
        c.send(s);
      } catch {
        /* ignora */
      }
    }
  }

  sendTo(playerId: string, m: unknown): void {
    const s = JSON.stringify(m);
    for (const c of this.conns.values()) {
      if (c.playerId !== playerId) continue;
      try {
        c.send(s);
      } catch {
        /* ignora */
      }
    }
  }

  private toHost(m: unknown): void {
    if (this.hostId) this.sendTo(this.hostId, m);
  }

  /** Esegue una mutazione e poi ritrasmette lo stato se è cambiato. */
  run(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      console.error("engine error", err);
    }
    if (this.dirty) this.flush();
  }

  flush(): void {
    this.dirty = false;
    const players = this.activePlayers().map((p) => this.pub(p));
    const base = {
      code: this.code,
      phase: this.phase,
      hostId: this.hostId,
      players,
      deadline: this.deadline,
      serverNow: this.sched.now(),
      playlist: this.playlist,
      gameIndex: this.gameIndex,
      length: this.length,
      rounds: this.rounds,
      currentKind: this.gameIndex >= 0 ? this.playlist[this.gameIndex] ?? null : null,
      lastGameScores: this.phase === "interlude" || this.phase === "final" ? this.lastGameScores : null,
      awards: this.phase === "final" ? this.awards : null,
      spectators: this.players.filter((p) => p.spectator && p.connected).length,
      isPublic: this.isPublic,
    };
    const views = new Map<string, string>();
    for (const c of this.conns.values()) {
      if (!c.playerId) continue;
      let s = views.get(c.playerId);
      if (!s) {
        const p = this.player(c.playerId);
        const gameView = this.game ? this.game.view(p && !p.spectator ? p.id : null) : null;
        s = JSON.stringify({ t: "state", ...base, you: c.playerId, game: gameView });
        views.set(c.playerId, s);
      }
      try {
        c.send(s);
      } catch {
        /* ignora */
      }
    }
    if (this.onSummary) {
      const sum = this.summary();
      const key = JSON.stringify(sum);
      if (key !== this.lastSummaryKey) {
        this.lastSummaryKey = key;
        this.onSummary(sum);
      }
    }
  }
}
