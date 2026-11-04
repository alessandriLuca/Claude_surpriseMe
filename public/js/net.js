// Connessione WebSocket alla stanza, con riconnessione automatica
// e stima dello sfasamento tra orologio del server e del client.

export class Net extends EventTarget {
  constructor(code) {
    super();
    this.code = code;
    this.ws = null;
    this.offset = 0; // serverNow - clientNow
    this.bestRtt = Infinity;
    this.closed = false;
    this.retries = 0;
    this.queue = [];
    this.pingTimer = null;
  }

  url() {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/rooms/${this.code}/ws`;
  }

  connect() {
    if (this.closed) return;
    const ws = new WebSocket(this.url());
    this.ws = ws;
    ws.addEventListener("open", () => {
      this.retries = 0;
      this.emit("open");
      for (const m of this.queue.splice(0)) ws.send(m);
      this.ping();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.ping(), 15000);
    });
    ws.addEventListener("message", (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.t === "pong") return this.onPong(m);
      if (m.t === "state" && typeof m.serverNow === "number" && this.bestRtt === Infinity) {
        // prima stima grezza finché non arriva un pong
        this.offset = m.serverNow - Date.now();
      }
      this.emit("msg", m);
    });
    ws.addEventListener("close", (ev) => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      if (ev.code === 4004) {
        this.closed = true;
        this.emit("fatal", "Questa stanza non esiste (o è scaduta).");
        return;
      }
      this.emit("down");
      const delay = Math.min(8000, 400 * 2 ** this.retries++);
      setTimeout(() => this.connect(), delay);
    });
  }

  ping() {
    this._pingSent = Date.now();
    this.send({ t: "ping" });
  }

  onPong(m) {
    const now = Date.now();
    const rtt = now - this._pingSent;
    if (rtt <= this.bestRtt * 1.5 || rtt < 120) {
      this.bestRtt = Math.min(this.bestRtt, rtt);
      this.offset = m.now + rtt / 2 - now;
    }
  }

  /** converte un istante del server in un istante locale (ms epoch) */
  toLocal(serverTs) {
    return serverTs - this.offset;
  }

  serverNow() {
    return Date.now() + this.offset;
  }

  send(obj) {
    const s = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (obj.t !== "ping") this.queue.push(s);
  }

  close() {
    this.closed = true;
    clearInterval(this.pingTimer);
    try {
      this.ws?.close();
    } catch {
      /* niente */
    }
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

export async function createRoom() {
  const r = await fetch("/api/rooms", { method: "POST" });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || "Errore");
  return j.code;
}

export async function roomExists(code) {
  const r = await fetch(`/api/rooms/${code}`);
  return r.ok;
}
