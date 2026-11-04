import { CHI_PROMPTS } from "../content/chi";
import { NONNA, fill } from "../content/nonna";
import type { GameContext, MiniGame } from "../types";
import { pick, sample } from "../util";

type Phase = "vote" | "reveal";

export const CHI_MAJORITY_POINTS = 150;
export const CHI_FAME_POINTS = 50;
const VOTE_MS = 25_000;
const REVEAL_MS = 7_000;

export class Chi implements MiniGame {
  readonly kind = "chi" as const;
  private phase: Phase = "vote";
  private prompts: string[] = [];
  private idx = -1;
  private votes = new Map<string, string>();
  private participants: string[] = [];
  private lastReveal: { tally: Record<string, number>; guilty: string[]; votes: Record<string, string> } | null = null;
  private accused = new Map<string, { n: number; best: number; prompt: string }>();

  constructor(private ctx: GameContext) {}

  start(): void {
    this.participants = this.ctx.players().map((p) => p.id);
    this.prompts = sample(CHI_PROMPTS, 3 + this.ctx.length, this.ctx.rng);
    this.next();
  }

  private next(): void {
    this.idx++;
    if (this.idx >= this.prompts.length) return this.end();
    this.phase = "vote";
    this.votes.clear();
    this.lastReveal = null;
    this.ctx.setDeadline(VOTE_MS);
    this.ctx.changed();
    this.ctx.after(VOTE_MS, () => this.reveal());
    for (const id of this.participants) {
      const p = this.ctx.player(id);
      if (!p?.isBot) continue;
      this.ctx.after(1500 + this.ctx.rng() * 8000, () =>
        this.onAction(id, { a: "vote", target: pick(this.participants, this.ctx.rng) }),
      );
    }
  }

  onAction(playerId: string, action: any): void {
    if (action?.a !== "vote" || this.phase !== "vote") return;
    if (!this.participants.includes(playerId)) return;
    const target = String(action.target);
    if (!this.participants.includes(target)) return;
    this.votes.set(playerId, target);
    this.ctx.changed();
    if (this.allVoted()) {
      this.ctx.clearTimers();
      this.reveal();
    }
  }

  onPlayerLeft(): void {
    if (this.phase === "vote" && this.votes.size > 0 && this.allVoted()) {
      this.ctx.clearTimers();
      this.reveal();
    }
  }

  private allVoted(): boolean {
    return this.participants.every((id) => {
      const p = this.ctx.player(id);
      return !p || !p.connected || this.votes.has(id);
    });
  }

  private reveal(): void {
    if (this.phase !== "vote") return;
    this.phase = "reveal";
    const tally: Record<string, number> = {};
    for (const t of this.votes.values()) tally[t] = (tally[t] ?? 0) + 1;
    const max = Math.max(0, ...Object.values(tally));
    const guilty = max > 0 ? Object.keys(tally).filter((k) => tally[k] === max) : [];
    for (const [voter, target] of this.votes) {
      if (guilty.includes(target)) this.ctx.addScore(voter, CHI_MAJORITY_POINTS);
    }
    for (const g of guilty) {
      this.ctx.addScore(g, CHI_FAME_POINTS);
      const cur = this.accused.get(g) ?? { n: 0, best: 0, prompt: "" };
      cur.n += max;
      if (max > cur.best) {
        cur.best = max;
        cur.prompt = this.prompts[this.idx];
      }
      this.accused.set(g, cur);
    }
    this.lastReveal = { tally, guilty, votes: Object.fromEntries(this.votes) };
    if (guilty.length === 1) {
      const p = this.ctx.player(guilty[0]);
      this.ctx.nonna({ text: fill(pick(NONNA.chiReveal, this.ctx.rng), { name: p?.name ?? "" }), mood: "sly" });
    } else if (guilty.length > 1) {
      this.ctx.nonna({ text: pick(NONNA.tie, this.ctx.rng), mood: "shock" });
    }
    this.ctx.fx("reveal");
    this.ctx.setDeadline(REVEAL_MS);
    this.ctx.changed();
    this.ctx.after(REVEAL_MS, () => this.next());
  }

  private end(): void {
    let top: [string, { n: number; best: number; prompt: string }] | null = null;
    for (const e of this.accused) if (!top || e[1].n > top[1].n) top = e;
    if (top) {
      this.ctx.award({
        title: "Il Solito Sospettato",
        emoji: "🕵️",
        playerId: top[0],
        why: `Accusato ${top[1].n} volte. Per esempio: "${top[1].prompt}"`,
      });
    }
    this.ctx.finish();
  }

  view(playerId: string | null) {
    return {
      kind: this.kind,
      phase: this.phase,
      prompt: this.prompts[this.idx] ?? "",
      index: this.idx,
      total: this.prompts.length,
      candidates: this.participants,
      participant: playerId ? this.participants.includes(playerId) : false,
      myVote: playerId ? this.votes.get(playerId) ?? null : null,
      votedIds: [...this.votes.keys()],
      reveal: this.phase === "reveal" ? this.lastReveal : null,
    };
  }
}
