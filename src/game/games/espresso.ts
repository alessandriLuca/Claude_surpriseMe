import { NONNA, fill } from "../content/nonna";
import type { GameContext, MiniGame } from "../types";
import { pick } from "../util";

type Phase = "ready" | "armed" | "result";

interface Tap {
  ms: number | null; // tempo di reazione; null se ha premuto troppo presto
  early: boolean;
}

export const ESPRESSO_POINTS = [300, 200, 150];
export const ESPRESSO_BASE = 100;
export const ESPRESSO_EARLY = -100;
const READY_MS = 2500;
const RESULT_MS = 4500;
const MAX_WAIT_AFTER_GO = 2500;
/** sotto questa soglia la reazione non è umana: anticipo */
const MIN_HUMAN_MS = 90;

export class Espresso implements MiniGame {
  readonly kind = "espresso" as const;
  private phase: Phase = "ready";
  private round = 0;
  private rounds: number;
  private goDelay = 0;
  private armedAt = 0;
  private taps = new Map<string, Tap>();
  private participants: string[] = [];
  private lastResults: { id: string; ms: number | null; early: boolean; points: number }[] = [];
  private best = new Map<string, number>();
  private earlies = new Map<string, number>();

  constructor(private ctx: GameContext) {
    this.rounds = 3 + ctx.length;
  }

  start(): void {
    this.participants = this.ctx.players().map((p) => p.id);
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;
    if (this.round > this.rounds) return this.end();
    this.phase = "ready";
    this.taps.clear();
    this.ctx.setDeadline(READY_MS);
    this.ctx.changed();
    this.ctx.after(READY_MS, () => this.arm());
  }

  private arm(): void {
    this.phase = "armed";
    this.goDelay = Math.round(1500 + this.ctx.rng() * 4000);
    this.armedAt = this.ctx.now();
    this.ctx.setDeadline(null);
    this.ctx.changed();
    this.ctx.fx("brew");
    this.ctx.after(this.goDelay + MAX_WAIT_AFTER_GO, () => this.score());

    // i bot reagiscono (o sbagliano)
    for (const id of this.participants) {
      const p = this.ctx.player(id);
      if (!p?.isBot) continue;
      const early = this.ctx.rng() < 0.08;
      const reaction = Math.round(210 + this.ctx.rng() * 300);
      const at = early ? Math.round(this.goDelay * this.ctx.rng()) : this.goDelay + reaction;
      this.ctx.after(at, () => this.onAction(id, { a: "tap", early, ms: reaction }));
    }
  }

  onAction(playerId: string, action: any): void {
    if (action?.a !== "tap" || this.phase !== "armed") return;
    if (!this.participants.includes(playerId) || this.taps.has(playerId)) return;
    let early = !!action.early;
    let ms = Number(action.ms);
    if (!Number.isFinite(ms) || ms < 0) ms = 9999;
    const p = this.ctx.player(playerId);
    // controllo di plausibilità lato server (tolleranza per lo sfasamento orologi)
    const elapsed = this.ctx.now() - this.armedAt;
    if (!p?.isBot && !early && elapsed < this.goDelay - 400) early = true;
    if (!early && ms < MIN_HUMAN_MS) early = true;
    this.taps.set(playerId, { ms: early ? null : Math.min(ms, 5000), early });
    if (early) {
      this.earlies.set(playerId, (this.earlies.get(playerId) ?? 0) + 1);
      this.ctx.nonna({ text: fill(pick(NONNA.espressoEarly, this.ctx.rng), { name: p?.name ?? "" }), mood: "angry" });
      this.ctx.sendTo(playerId, { t: "fx", name: "burn" });
    }
    this.ctx.changed();
    const waiting = this.participants.filter((id) => {
      const pl = this.ctx.player(id);
      return pl && pl.connected && !this.taps.has(id);
    });
    if (waiting.length === 0) {
      this.ctx.clearTimers();
      this.score();
    }
  }

  onPlayerLeft(): void {
    // nessuna azione: il timeout chiude comunque il round
  }

  private score(): void {
    if (this.phase !== "armed") return;
    this.ctx.clearTimers();
    this.phase = "result";
    const valid = [...this.taps.entries()]
      .filter(([, t]) => !t.early && t.ms != null)
      .sort((a, b) => a[1].ms! - b[1].ms!);
    const results: typeof this.lastResults = [];
    valid.forEach(([id, t], i) => {
      const pts = ESPRESSO_POINTS[i] ?? ESPRESSO_BASE;
      this.ctx.addScore(id, pts);
      results.push({ id, ms: t.ms, early: false, points: pts });
      const prev = this.best.get(id);
      if (prev == null || t.ms! < prev) this.best.set(id, t.ms!);
    });
    for (const [id, t] of this.taps) {
      if (t.early) {
        this.ctx.addScore(id, ESPRESSO_EARLY);
        results.push({ id, ms: null, early: true, points: ESPRESSO_EARLY });
      }
    }
    for (const id of this.participants) {
      if (!this.taps.has(id)) results.push({ id, ms: null, early: false, points: 0 });
    }
    this.lastResults = results;
    if (valid[0]) {
      const w = this.ctx.player(valid[0][0]);
      this.ctx.nonna({ text: fill(pick(NONNA.espressoWin, this.ctx.rng), { name: w?.name ?? "" }), mood: "proud" });
    }
    this.ctx.fx("ding");
    this.ctx.setDeadline(RESULT_MS);
    this.ctx.changed();
    this.ctx.after(RESULT_MS, () => this.nextRound());
  }

  private end(): void {
    let bestId: string | null = null;
    let bestMs = Infinity;
    for (const [id, ms] of this.best) {
      if (ms < bestMs) {
        bestMs = ms;
        bestId = id;
      }
    }
    if (bestId) this.ctx.award({ title: "Riflessi da Gatto", emoji: "🐈", playerId: bestId, why: `Reazione record: ${bestMs} ms` });
    let burner: string | null = null;
    let burns = 1;
    for (const [id, n] of this.earlies) {
      if (n > burns || (n === burns && !burner)) {
        burns = n;
        burner = id;
      }
    }
    if (burner && burns >= 2) this.ctx.award({ title: "Caffè Bruciato", emoji: "🔥", playerId: burner, why: `Ha premuto in anticipo ${burns} volte` });
    this.ctx.finish();
  }

  view(playerId: string | null) {
    const mine = playerId ? this.taps.get(playerId) : undefined;
    return {
      kind: this.kind,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      armedAt: this.phase === "armed" ? this.armedAt : null,
      goDelay: this.phase === "armed" ? this.goDelay : null,
      participant: playerId ? this.participants.includes(playerId) : false,
      tapped: !!mine,
      myEarly: mine?.early ?? false,
      tappedIds: [...this.taps.keys()],
      results: this.phase === "result" ? this.lastResults : null,
    };
  }
}
