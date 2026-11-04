import type { GameContext, MiniGame } from "../types";

type Phase = "ready" | "stomp" | "result";

export const PIGIA_POINTS = [300, 200, 150];
export const PIGIA_BASE = 80;
const READY_MS = 3500;
export const STOMP_MS = 10_000;
const RESULT_MS = 6000;
/** massimo di pestate al secondo considerate umane (anti autoclicker) */
export const MAX_TAPS_PER_SEC = 20;

export class Pigiatura implements MiniGame {
  readonly kind = "pigiatura" as const;
  private phase: Phase = "ready";
  private round = 0;
  private rounds: number;
  private participants: string[] = [];
  private counts = new Map<string, number>();
  private lastBatch = new Map<string, number>();
  private stompStart = 0;
  private totals = new Map<string, number>();
  private lastResults: { id: string; taps: number; points: number }[] = [];

  constructor(private ctx: GameContext) {
    this.rounds = ctx.length >= 3 ? 3 : ctx.length === 1 ? 1 : 2;
  }

  start(): void {
    this.participants = this.ctx.players().map((p) => p.id);
    this.nextRound();
  }

  private nextRound(): void {
    this.round++;
    if (this.round > this.rounds) return this.end();
    this.phase = "ready";
    this.counts.clear();
    this.lastBatch.clear();
    for (const id of this.participants) this.counts.set(id, 0);
    this.ctx.setDeadline(READY_MS);
    this.ctx.changed();
    this.ctx.after(READY_MS, () => this.stomp());
  }

  private stomp(): void {
    this.phase = "stomp";
    this.stompStart = this.ctx.now();
    this.ctx.setDeadline(STOMP_MS);
    this.ctx.fx("go");
    this.ctx.changed();
    this.ctx.after(STOMP_MS + 400, () => this.score()); // un attimo di tolleranza per gli ultimi pacchetti
    // i bot pestano a ritmo variabile
    for (const id of this.participants) {
      if (!this.ctx.player(id)?.isBot) continue;
      const speed = 5 + this.ctx.rng() * 5; // pestate al secondo
      for (let t = 250; t <= STOMP_MS; t += 250) {
        this.ctx.after(t, () => this.onAction(id, { a: "taps", n: Math.round((speed / 4) * (0.6 + this.ctx.rng() * 0.8)) }));
      }
    }
  }

  onAction(playerId: string, action: any): void {
    if (action?.a !== "taps" || this.phase !== "stomp") return;
    if (!this.participants.includes(playerId)) return;
    const now = this.ctx.now();
    if (now > this.stompStart + STOMP_MS + 400) return;
    let n = Math.floor(Number(action.n));
    if (!Number.isFinite(n) || n <= 0) return;
    // limite di velocità: pestate consentite dall'ultimo pacchetto
    const since = now - (this.lastBatch.get(playerId) ?? this.stompStart);
    const allowed = Math.ceil((Math.max(since, 0) / 1000) * MAX_TAPS_PER_SEC) + 2;
    n = Math.min(n, allowed);
    this.lastBatch.set(playerId, now);
    this.counts.set(playerId, (this.counts.get(playerId) ?? 0) + n);
    this.ctx.changed();
  }

  private score(): void {
    if (this.phase !== "stomp") return;
    this.phase = "result";
    const ranked = [...this.counts.entries()].sort((a, b) => b[1] - a[1]);
    const results: typeof this.lastResults = [];
    ranked.forEach(([id, taps], i) => {
      const pts = taps === 0 ? 0 : PIGIA_POINTS[i] ?? PIGIA_BASE;
      this.ctx.addScore(id, pts);
      this.totals.set(id, (this.totals.get(id) ?? 0) + taps);
      results.push({ id, taps, points: pts });
    });
    this.lastResults = results;
    const w = ranked[0] && ranked[0][1] > 0 ? this.ctx.player(ranked[0][0]) : null;
    if (w) {
      const litres = (ranked[0][1] / 10).toFixed(1);
      this.ctx.nonna({ text: `${w.name} ha fatto ${litres} litri di vino! Altro che trattore!`, mood: "proud" });
    } else {
      this.ctx.nonna({ text: "Nessuno ha pestato niente? E il vino chi lo fa, io?", mood: "angry" });
    }
    this.ctx.fx("ding");
    this.ctx.setDeadline(RESULT_MS);
    this.ctx.changed();
    this.ctx.after(RESULT_MS, () => this.nextRound());
  }

  private end(): void {
    let top: string | null = null;
    let best = 0;
    for (const [id, n] of this.totals) {
      if (n > best) {
        best = n;
        top = id;
      }
    }
    if (top) this.ctx.award({ title: "Piedi d'Oro", emoji: "🍇", playerId: top, why: `${(best / 10).toFixed(1)} litri di vino pigiati` });
    this.ctx.finish();
  }

  view(playerId: string | null) {
    return {
      kind: this.kind,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      participant: playerId ? this.participants.includes(playerId) : false,
      counts: Object.fromEntries(this.counts),
      mine: playerId ? this.counts.get(playerId) ?? 0 : 0,
      results: this.phase === "result" ? this.lastResults : null,
    };
  }
}
