import { BOTTA_PROMPTS } from "../content/botta";
import { BOT_ANSWERS } from "../content/bot";
import { NONNA, fill } from "../content/nonna";
import type { GameContext, MiniGame } from "../types";
import { cleanText, normalize, pick, sample, shuffle } from "../util";

type Phase = "answer" | "vote" | "reveal";

interface Match {
  id: number;
  prompt: string;
  authors: [string, string];
  answers: [string | null, string | null];
  votes: Map<string, 0 | 1>;
}

export const BOTTA_VOTE_POINTS = 100;
export const BOTTA_SWEEP_BONUS = 250;
const ANSWER_MS = 80_000;
const VOTE_MS = 20_000;
const REVEAL_MS = 7_000;
export const NO_ANSWER = "…(silenzio imbarazzante)";

export class Botta implements MiniGame {
  readonly kind = "botta" as const;
  private phase: Phase = "answer";
  private round = 0;
  private rounds: number;
  private participants: string[] = [];
  private matches: Match[] = [];
  private voteIdx = -1;
  private used = new Set<string>();
  private lastReveal: {
    points: [number, number];
    sweep: number | null;
  } | null = null;
  private best: { playerId: string; votes: number; text: string; prompt: string } | null = null;

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
    const order = shuffle(this.participants, this.ctx.rng);
    const n = order.length;
    const fresh = BOTTA_PROMPTS.filter((p) => !this.used.has(p));
    const prompts = sample(fresh.length >= n ? fresh : BOTTA_PROMPTS, n, this.ctx.rng);
    prompts.forEach((p) => this.used.add(p));
    this.matches = prompts.map((prompt, i) => ({
      id: i,
      prompt,
      authors: [order[i], order[(i + 1) % n]] as [string, string],
      answers: [null, null] as [string | null, string | null],
      votes: new Map(),
    }));
    this.phase = "answer";
    this.voteIdx = -1;
    this.ctx.setDeadline(ANSWER_MS);
    this.ctx.changed();
    this.ctx.nonna(pick(NONNA.answering, this.ctx.rng));
    this.ctx.after(ANSWER_MS, () => this.startVoting());

    // i bot rispondono
    for (const m of this.matches) {
      m.authors.forEach((a, side) => {
        if (!this.ctx.player(a)?.isBot) return;
        this.ctx.after(3000 + this.ctx.rng() * 15000, () =>
          this.onAction(a, { a: "answer", match: m.id, side, text: pick(BOT_ANSWERS, this.ctx.rng) }),
        );
      });
    }
  }

  onAction(playerId: string, action: any): void {
    if (!action) return;
    if (action.a === "answer" && this.phase === "answer") {
      const m = this.matches[Number(action.match)];
      if (!m) return;
      const found = m.authors.indexOf(playerId);
      if (found < 0) return;
      const side = found as 0 | 1;
      if (m.answers[side] != null) return;
      const text = cleanText(action.text, 90);
      if (!text) return;
      // se le due risposte sono identiche aggiungiamo un tocco
      const other = m.answers[1 - side];
      m.answers[side] = other && normalize(other) === normalize(text) ? text + " (copione!)" : text;
      this.ctx.changed();
      if (this.allAnswered()) {
        this.ctx.clearTimers();
        this.startVoting();
      }
      return;
    }
    if (action.a === "vote" && this.phase === "vote") {
      const m = this.matches[this.voteIdx];
      if (!m || !this.canVote(playerId, m) || m.votes.has(playerId)) return;
      const choice = Number(action.choice) === 1 ? 1 : 0;
      m.votes.set(playerId, choice);
      this.ctx.changed();
      if (this.allVoted(m)) {
        this.ctx.clearTimers();
        this.reveal();
      }
    }
  }

  onPlayerLeft(): void {
    if (this.phase === "answer" && this.allAnswered()) {
      this.ctx.clearTimers();
      this.startVoting();
    } else if (this.phase === "vote") {
      const m = this.matches[this.voteIdx];
      if (m && this.allVoted(m)) {
        this.ctx.clearTimers();
        this.reveal();
      }
    }
  }

  private connected(id: string): boolean {
    return !!this.ctx.player(id)?.connected;
  }

  private allAnswered(): boolean {
    return this.matches.every((m) => m.authors.every((a, i) => m.answers[i] != null || !this.connected(a)));
  }

  private voters(m: Match): string[] {
    const v = this.participants.filter((id) => !m.authors.includes(id));
    // con soli due giocatori votano tutti (non dovrebbe capitare: minimo 3)
    return v.length ? v : this.participants.slice();
  }

  private canVote(id: string, m: Match): boolean {
    return this.voters(m).includes(id);
  }

  private allVoted(m: Match): boolean {
    return this.voters(m).every((id) => m.votes.has(id) || !this.connected(id));
  }

  private startVoting(): void {
    if (this.phase !== "answer") return;
    for (const m of this.matches) m.answers = m.answers.map((a) => a ?? NO_ANSWER) as [string, string];
    this.phase = "vote";
    this.voteIdx = -1;
    this.ctx.nonna(pick(NONNA.voting, this.ctx.rng));
    this.nextVote();
  }

  private nextVote(): void {
    this.voteIdx++;
    const m = this.matches[this.voteIdx];
    if (!m) return this.nextRound();
    this.phase = "vote";
    this.lastReveal = null;
    // se una delle due risposte manca, si salta dritti al verdetto
    const missing = m.answers.map((a) => a === NO_ANSWER);
    this.ctx.setDeadline(VOTE_MS);
    this.ctx.changed();
    if (missing[0] && missing[1]) {
      this.ctx.after(2500, () => this.reveal());
      return;
    }
    this.ctx.after(VOTE_MS, () => this.reveal());
    for (const v of this.voters(m)) {
      if (!this.ctx.player(v)?.isBot) continue;
      const choice = missing[0] ? 1 : missing[1] ? 0 : this.ctx.rng() < 0.5 ? 0 : 1;
      this.ctx.after(1500 + this.ctx.rng() * 7000, () => this.onAction(v, { a: "vote", choice }));
    }
  }

  private reveal(): void {
    if (this.phase !== "vote") return;
    const m = this.matches[this.voteIdx];
    if (!m) return;
    this.phase = "reveal";
    const counts: [number, number] = [0, 0];
    for (const c of m.votes.values()) counts[c]++;
    const total = counts[0] + counts[1];
    const mult = this.round;
    const points: [number, number] = [counts[0] * BOTTA_VOTE_POINTS * mult, counts[1] * BOTTA_VOTE_POINTS * mult];
    let sweep: number | null = null;
    for (const side of [0, 1] as const) {
      if (total >= 2 && counts[side] === total) {
        sweep = side;
        // bonus solo se l'avversario aveva almeno risposto
        if (m.answers[1 - side] !== NO_ANSWER) points[side] += BOTTA_SWEEP_BONUS * mult;
      }
    }
    m.authors.forEach((a, i) => this.ctx.addScore(a, points[i]));
    for (const side of [0, 1] as const) {
      if (!this.best || counts[side] > this.best.votes) {
        if (counts[side] > 0 && m.answers[side] !== NO_ANSWER) {
          this.best = { playerId: m.authors[side], votes: counts[side], text: m.answers[side]!, prompt: m.prompt };
        }
      }
    }
    this.lastReveal = { points, sweep };
    if (sweep != null) {
      const w = this.ctx.player(m.authors[sweep]);
      this.ctx.nonna({ text: fill(pick(NONNA.sweep, this.ctx.rng), { name: w?.name ?? "" }), mood: "shock" });
      this.ctx.fx("sweep");
    } else if (counts[0] === counts[1] && total > 0) {
      this.ctx.nonna({ text: pick(NONNA.tie, this.ctx.rng), mood: "sly" });
      this.ctx.fx("reveal");
    } else {
      this.ctx.fx("reveal");
    }
    this.ctx.setDeadline(REVEAL_MS);
    this.ctx.changed();
    this.ctx.after(REVEAL_MS, () => this.nextVote());
  }

  private end(): void {
    if (this.best) {
      this.ctx.award({
        title: "Battuta d'Oro",
        emoji: "🎤",
        playerId: this.best.playerId,
        why: `"${this.best.prompt}" → "${this.best.text}"`,
      });
    }
    this.ctx.finish();
  }

  view(playerId: string | null) {
    const base = {
      kind: this.kind,
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      participant: playerId ? this.participants.includes(playerId) : false,
    };
    if (this.phase === "answer") {
      const mine = playerId
        ? this.matches
            .filter((m) => m.authors.includes(playerId))
            .map((m) => {
              const side = m.authors[0] === playerId ? 0 : 1;
              return { match: m.id, side, prompt: m.prompt, answered: m.answers[side] != null };
            })
        : [];
      const done = this.participants.filter((id) =>
        this.matches.every((m) => !m.authors.includes(id) || m.answers[m.authors.indexOf(id)] != null),
      );
      return { ...base, mine, done };
    }
    const m = this.matches[this.voteIdx];
    if (!m) return base;
    const revealed = this.phase === "reveal";
    const votesBy: [string[], string[]] = [[], []];
    if (revealed) for (const [v, c] of m.votes) votesBy[c].push(v);
    return {
      ...base,
      index: this.voteIdx,
      total: this.matches.length,
      prompt: m.prompt,
      answers: m.answers,
      canVote: playerId ? this.canVote(playerId, m) : false,
      isAuthor: playerId ? m.authors.includes(playerId) : false,
      myVote: playerId ? m.votes.get(playerId) ?? null : null,
      votedIds: [...m.votes.keys()],
      authors: revealed ? m.authors : null,
      votesBy: revealed ? votesBy : null,
      points: revealed ? this.lastReveal?.points ?? null : null,
      sweep: revealed ? this.lastReveal?.sweep ?? null : null,
    };
  }
}
