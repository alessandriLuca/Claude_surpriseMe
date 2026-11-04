import { DurableObject } from "cloudflare:workers";
import { Engine, type RoomSummary } from "./game/engine";
import { PiazzaState, type Visitor } from "./game/piazza";
import { dayKey, insertScore, validateScore, type ScoreEntry } from "./game/classifica";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  PIAZZA: DurableObjectNamespace<Piazza>;
  CLASSIFICA: DurableObjectNamespace<Classifica>;
  ASSETS: Fetcher;
}

// lettere senza ambiguità (niente I/O/0/1)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[A-Z]{4}$/;
const IDLE_CLEANUP_MS = 30 * 60 * 1000;
const REPORT_DEBOUNCE_MS = 700;
const HEARTBEAT_MS = 40_000;

function randomCode(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function classificaStub(env: Env) {
  return env.CLASSIFICA.get(env.CLASSIFICA.idFromName("affettatrice"));
}

function piazzaStub(env: Env) {
  return env.PIAZZA.get(env.PIAZZA.idFromName("piazza"));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/api/rooms" && request.method === "POST") {
      // prova qualche codice finché non ne trova uno libero
      for (let i = 0; i < 8; i++) {
        const code = randomCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const ok = await stub.init(code);
        if (ok) return json({ code });
      }
      return json({ error: "Non riesco a creare la stanza, riprova." }, 503);
    }

    if (path === "/api/piazza") {
      if (request.headers.get("Upgrade") !== "websocket") return json(await piazzaStub(env).snapshot());
      return piazzaStub(env).fetch(request);
    }

    const m = path.match(/^\/api\/rooms\/([A-Za-z]{4})(\/ws)?$/);
    if (m) {
      const code = m[1].toUpperCase();
      if (!CODE_RE.test(code)) return json({ error: "codice non valido" }, 400);
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (m[2]) {
        if (request.headers.get("Upgrade") !== "websocket") return json({ error: "serve un websocket" }, 426);
        return stub.fetch(request);
      }
      const info = await stub.info();
      return info ? json(info) : json({ error: "Stanza inesistente" }, 404);
    }

    if (path === "/api/affettatrice/top" && request.method === "GET") {
      return json(await classificaStub(env).top());
    }
    if (path === "/api/affettatrice/score" && request.method === "POST") {
      let body: unknown;
      try {
        const text = await request.text();
        if (text.length > 2000) return json({ error: "troppo lungo" }, 413);
        body = JSON.parse(text);
      } catch {
        return json({ error: "JSON non valido" }, 400);
      }
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      return json(await classificaStub(env).submit(body, ip));
    }

    if (path === "/api/health") return json({ ok: true });

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

// =====================================================================  Room

export class Room extends DurableObject<Env> {
  private engine: Engine | null = null;
  private code: string | null = null;
  private nextConn = 1;
  private reportTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private latest: RoomSummary | null = null;

  private async getEngine(): Promise<Engine | null> {
    if (this.engine) return this.engine;
    const code = this.code ?? (await this.ctx.storage.get<string>("code")) ?? null;
    if (!code) return null;
    this.code = code;
    this.engine = new Engine({
      code,
      scheduler: {
        now: () => Date.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (h) => clearTimeout(h as number),
      },
      onSummary: (s) => this.queueReport(s),
    });
    return this.engine;
  }

  /** Avvisa la Piazza dei cambiamenti, senza tempestarla. */
  private queueReport(s: RoomSummary): void {
    this.latest = s;
    if (this.reportTimer) return;
    this.reportTimer = setTimeout(() => {
      this.reportTimer = null;
      this.sendReport();
    }, REPORT_DEBOUNCE_MS);
  }

  private sendReport(): void {
    if (!this.latest) return;
    piazzaStub(this.env)
      .report(this.latest)
      .catch(() => {
        /* la Piazza è un extra: se non risponde si gioca lo stesso */
      });
  }

  /** Inizializza la stanza; false se il codice è già in uso. */
  async init(code: string): Promise<boolean> {
    const existing = await this.ctx.storage.get<string>("code");
    if (existing) {
      const eng = await this.getEngine();
      // codice occupato se qualcuno è dentro
      if (eng && eng.connectionCount() > 0) return false;
    }
    await this.ctx.storage.put("code", code);
    this.code = code;
    this.engine = null;
    await this.getEngine();
    await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
    return true;
  }

  async info(): Promise<{ code: string; players: number; phase: string } | null> {
    const eng = await this.getEngine();
    if (!eng) return null;
    return { code: eng.code, players: eng.activePlayers().length, phase: eng.phase };
  }

  async fetch(_request: Request): Promise<Response> {
    const eng = await this.getEngine();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    if (!eng) {
      server.send(JSON.stringify({ t: "err", fatal: true, msg: "Questa stanza non esiste (o è scaduta)." }));
      server.close(4004, "no room");
      return new Response(null, { status: 101, webSocket: client });
    }
    const connId = String(this.nextConn++);
    eng.connect(connId, (data) => server.send(data));
    if (!this.heartbeat) {
      // finché c'è qualcuno, la Piazza sa che la tavolata è viva
      this.heartbeat = setInterval(() => this.sendReport(), HEARTBEAT_MS);
    }
    server.addEventListener("message", (ev) => {
      if (typeof ev.data === "string" && ev.data.length < 20_000) eng.message(connId, ev.data);
    });
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      eng.disconnect(connId);
      if (eng.connectionCount() === 0) {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
        this.queueReport(eng.summary());
        this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
      }
    };
    server.addEventListener("close", close);
    server.addEventListener("error", close);
    return new Response(null, { status: 101, webSocket: client });
  }

  async alarm(): Promise<void> {
    if (this.engine && this.engine.connectionCount() > 0) {
      await this.ctx.storage.setAlarm(Date.now() + IDLE_CLEANUP_MS);
      return;
    }
    // nessuno è rimasto: la stanza viene sgomberata
    if (this.code) await piazzaStub(this.env).remove(this.code).catch(() => {});
    this.engine = null;
    this.code = null;
    await this.ctx.storage.deleteAll();
  }
}

// =====================================================================  Piazza

interface PiazzaClient {
  ws: WebSocket;
  v: Visitor;
}

/** Un'unica Piazza globale: lista delle tavolate pubbliche + chat della home. */
export class Piazza extends DurableObject<Env> {
  private state = new PiazzaState();
  private clients = new Set<PiazzaClient>();
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  private roomsMsg(): string {
    const now = Date.now();
    return JSON.stringify({
      t: "rooms",
      rooms: this.state.list(now),
      playing: this.state.playing(now),
      inPiazza: this.clients.size,
    });
  }

  private broadcast(s: string): void {
    for (const c of this.clients) {
      try {
        c.ws.send(s);
      } catch {
        /* chiusa */
      }
    }
  }

  private schedulePush(): void {
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.broadcast(this.roomsMsg());
    }, 400);
  }

  async report(s: RoomSummary): Promise<void> {
    this.state.update(s, Date.now());
    this.schedulePush();
  }

  async remove(code: string): Promise<void> {
    this.state.remove(code);
    this.schedulePush();
  }

  async snapshot() {
    const now = Date.now();
    return { rooms: this.state.list(now), playing: this.state.playing(now), inPiazza: this.clients.size };
  }

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const c: PiazzaClient = { ws: server, v: { name: "", avatar: "🙂", lastChat: 0 } };
    this.clients.add(c);
    server.send(this.roomsMsg());
    server.send(JSON.stringify({ t: "chatHistory", msgs: this.state.chat }));
    this.schedulePush();
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(() => {
        if (this.state.prune(Date.now())) this.schedulePush();
      }, 30_000);
    }
    let budget = 20;
    let budgetAt = Date.now();
    server.addEventListener("message", (ev) => {
      if (typeof ev.data !== "string" || ev.data.length > 2000) return;
      const now = Date.now();
      budget = Math.min(20, budget + ((now - budgetAt) / 1000) * 5);
      budgetAt = now;
      if (budget < 1) return;
      budget--;
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg?.t === "hello") {
        const id = PiazzaState.identify(msg);
        c.v.name = id.name;
        c.v.avatar = id.avatar;
      } else if (msg?.t === "chat") {
        const m = this.state.say(c.v, msg.text, now);
        if (m) this.broadcast(JSON.stringify({ t: "chat", msg: m }));
        else if (!c.v.name) server.send(JSON.stringify({ t: "toast", text: "Scrivi prima il tuo nome qui sopra!" }));
      } else if (msg?.t === "ping") {
        server.send(JSON.stringify({ t: "pong" }));
      }
    });
    const close = () => {
      if (!this.clients.delete(c)) return;
      this.schedulePush();
      if (this.clients.size === 0 && this.pruneTimer) {
        clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
    };
    server.addEventListener("close", close);
    server.addEventListener("error", close);
    return new Response(null, { status: 101, webSocket: client });
  }
}

// =====================================================================  Classifica

/** Classifica globale dell'Affettatrice: di sempre e di oggi. */
export class Classifica extends DurableObject<Env> {
  private lastByIp = new Map<string, number>();

  private async load(): Promise<{ all: ScoreEntry[]; today: ScoreEntry[]; day: string }> {
    const day = dayKey(Date.now());
    const all = (await this.ctx.storage.get<ScoreEntry[]>("all")) ?? [];
    const savedDay = await this.ctx.storage.get<string>("day");
    const today = savedDay === day ? ((await this.ctx.storage.get<ScoreEntry[]>("today")) ?? []) : [];
    return { all, today, day };
  }

  async top(): Promise<{ all: ScoreEntry[]; today: ScoreEntry[] }> {
    const { all, today } = await this.load();
    return { all, today };
  }

  async submit(raw: unknown, ip: string): Promise<{ ok: boolean; rankAll: number; rankToday: number; all: ScoreEntry[]; today: ScoreEntry[]; error?: string }> {
    const now = Date.now();
    const last = this.lastByIp.get(ip) ?? 0;
    const cur = await this.load();
    if (now - last < 3000) return { ok: false, rankAll: 0, rankToday: 0, all: cur.all, today: cur.today, error: "Piano, piano!" };
    this.lastByIp.set(ip, now);
    if (this.lastByIp.size > 5000) this.lastByIp.clear();
    const e = validateScore(raw, now);
    if (!e) return { ok: false, rankAll: 0, rankToday: 0, all: cur.all, today: cur.today, error: "Punteggio non valido" };
    const a = insertScore(cur.all, e);
    const t = insertScore(cur.today, e);
    await this.ctx.storage.put({ all: a.list, today: t.list, day: cur.day });
    return { ok: true, rankAll: a.rank, rankToday: t.rank, all: a.list, today: t.list };
  }
}
