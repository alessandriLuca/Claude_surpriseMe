import { DurableObject } from "cloudflare:workers";
import { Engine } from "./game/engine";

export interface Env {
  ROOMS: DurableObjectNamespace<Room>;
  ASSETS: Fetcher;
}

// lettere senza ambiguità (niente I/O/0/1)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_RE = /^[A-Z]{4}$/;
const IDLE_CLEANUP_MS = 30 * 60 * 1000;

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

    if (path === "/api/health") return json({ ok: true });

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  private engine: Engine | null = null;
  private code: string | null = null;
  private nextConn = 1;

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
    });
    return this.engine;
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
    server.addEventListener("message", (ev) => {
      if (typeof ev.data === "string" && ev.data.length < 20_000) eng.message(connId, ev.data);
    });
    const close = () => {
      eng.disconnect(connId);
      if (eng.connectionCount() === 0) {
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
    this.engine = null;
    this.code = null;
    await this.ctx.storage.deleteAll();
  }
}
