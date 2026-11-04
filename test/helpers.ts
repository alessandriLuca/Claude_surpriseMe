import { Engine } from "../src/game/engine";
import type { Scheduler } from "../src/game/types";
import { seededRng } from "../src/game/util";

export class FakeClock implements Scheduler {
  t = 1_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();
  now() {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number) {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }
  clearTimeout(h: unknown) {
    this.timers.delete(h as number);
  }
  pending() {
    return this.timers.size;
  }
  /** avanza il tempo eseguendo i timer in ordine */
  advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.timers) if (e[1].at <= end && (!next || e[1].at < next[1].at || (e[1].at === next[1].at && e[0] < next[0]))) next = e;
      if (!next) break;
      this.timers.delete(next[0]);
      this.t = next[1].at;
      next[1].fn();
    }
    this.t = end;
  }
}

export class FakeClient {
  msgs: any[] = [];
  id: string | null = null;
  token: string | null = null;
  constructor(public engine: Engine, public connId: string) {
    engine.connect(connId, (d) => {
      const m = JSON.parse(d);
      if (m.t === "joined") {
        this.id = m.id;
        this.token = m.token;
      }
      this.msgs.push(m);
    });
  }
  send(m: unknown) {
    this.engine.message(this.connId, JSON.stringify(m));
  }
  join(name: string, extra: Record<string, unknown> = {}) {
    this.send({ t: "join", name, ...extra });
    return this;
  }
  get state(): any {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === "state") return this.msgs[i];
    return null;
  }
  get game(): any {
    return this.state?.game;
  }
  last(t: string): any {
    for (let i = this.msgs.length - 1; i >= 0; i--) if (this.msgs[i].t === t) return this.msgs[i];
    return null;
  }
  act(a: Record<string, unknown>) {
    this.send({ t: "act", ...a });
  }
  close() {
    this.engine.disconnect(this.connId);
  }
}

export function setup(seed = 42) {
  const clock = new FakeClock();
  const engine = new Engine({ code: "TEST", scheduler: clock, rng: seededRng(seed) });
  let n = 0;
  const client = (name?: string, extra?: Record<string, unknown>) => {
    const c = new FakeClient(engine, "c" + ++n);
    if (name) c.join(name, extra);
    return c;
  };
  return { clock, engine, client };
}
