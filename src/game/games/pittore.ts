import { BOT_GUESSES } from "../content/bot";
import { NONNA, fill } from "../content/nonna";
import { PAROLE, type Parola } from "../content/parole";
import type { GameContext, MiniGame } from "../types";
import { cleanText, levenshtein, normalize, pick, sample, shuffle } from "../util";

type Phase = "choose" | "draw" | "reveal";

interface Stroke {
  id: number;
  c: string;
  w: number;
  p: number[];
}

interface ChatLine {
  from: string;
  text: string;
  kind: "guess" | "correct" | "system";
}

const CHOOSE_MS = 12_000;
const DRAW_MS = 80_000;
const REVEAL_MS = 6_000;
const MAX_POINTS = 24_000;
export const GUESS_MAX = 300;
export const GUESS_MIN = 100;
export const DRAWER_PER_GUESS = 60;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

export class Pittore implements MiniGame {
  readonly kind = "pittore" as const;
  private phase: Phase = "choose";
  private participants: string[] = [];
  private queue: string[] = [];
  private turn = 0;
  private turns = 0;
  private drawer: string | null = null;
  private choices: Parola[] = [];
  private word: Parola | null = null;
  private used = new Set<string>();
  private strokes: Stroke[] = [];
  private totalPoints = 0;
  private guessed: string[] = [];
  private drawStart = 0;
  private revealed = new Set<number>();
  private chat: ChatLine[] = [];
  private turnPoints = new Map<string, number>();
  private drawerFame = new Map<string, number>();

  constructor(private ctx: GameContext) {}

  start(): void {
    const players = this.ctx.players();
    this.participants = players.map((p) => p.id);
    const humans = players.filter((p) => !p.isBot).map((p) => p.id);
    const reps = this.ctx.length >= 3 ? 2 : 1;
    let q: string[] = [];
    for (let r = 0; r < reps; r++) q = q.concat(shuffle(humans, this.ctx.rng));
    // con un solo umano disegna più volte
    while (q.length < 2 + this.ctx.length - 1 && humans.length > 0 && humans.length < 2) q.push(humans[0]);
    this.queue = q;
    this.turns = q.length;
    this.nextTurn();
  }

  private nextTurn(): void {
    // salta chi si è disconnesso
    while (this.turn < this.queue.length && !this.ctx.player(this.queue[this.turn])?.connected) this.turn++;
    if (this.turn >= this.queue.length) return this.end();
    this.drawer = this.queue[this.turn++];
    const pool = PAROLE.filter((p) => !this.used.has(p.w));
    this.choices = sample(pool.length >= 3 ? pool : PAROLE, 3, this.ctx.rng);
    this.word = null;
    this.strokes = [];
    this.totalPoints = 0;
    this.guessed = [];
    this.revealed.clear();
    this.chat = [];
    this.turnPoints.clear();
    this.phase = "choose";
    this.ctx.broadcast({ t: "redraw", strokes: [] });
    const d = this.ctx.player(this.drawer);
    this.ctx.nonna(fill(pick(NONNA.drawer, this.ctx.rng), { name: d?.name ?? "" }));
    this.ctx.setDeadline(CHOOSE_MS);
    this.ctx.changed();
    this.ctx.after(CHOOSE_MS, () => this.choose(0));
  }

  private choose(i: number): void {
    if (this.phase !== "choose") return;
    this.ctx.clearTimers();
    this.word = this.choices[Math.max(0, Math.min(2, i))] ?? this.choices[0];
    this.used.add(this.word.w);
    this.phase = "draw";
    this.drawStart = this.ctx.now();
    this.ctx.setDeadline(DRAW_MS);
    this.ctx.changed();
    this.ctx.after(DRAW_MS, () => this.reveal());
    // indizi: lettere rivelate nel tempo
    const letters = [...this.word.w].map((ch, idx) => (/[a-zàèéìòù]/i.test(ch) ? idx : -1)).filter((x) => x >= 0);
    const hints = letters.length >= 6 ? 2 : letters.length >= 4 ? 1 : 0;
    const order = shuffle(letters, this.ctx.rng);
    for (let h = 0; h < hints; h++) {
      this.ctx.after(DRAW_MS * (0.45 + h * 0.25), () => {
        this.revealed.add(order[h]);
        this.ctx.fx("hint");
        this.ctx.changed();
      });
    }
    // i bot provano a indovinare
    for (const id of this.participants) {
      const p = this.ctx.player(id);
      if (!p?.isBot || id === this.drawer) continue;
      const wrong = 1 + Math.floor(this.ctx.rng() * 2);
      for (let k = 0; k < wrong; k++) {
        this.ctx.after(DRAW_MS * (0.1 + this.ctx.rng() * 0.5), () =>
          this.onAction(id, { a: "guess", text: pick(BOT_GUESSES, this.ctx.rng) }),
        );
      }
      if (this.ctx.rng() < 0.65) {
        this.ctx.after(DRAW_MS * (0.35 + this.ctx.rng() * 0.55), () =>
          this.onAction(id, { a: "guess", text: this.word?.w ?? "" }),
        );
      }
    }
  }

  onAction(playerId: string, action: any): void {
    if (!action) return;
    const isDrawer = playerId === this.drawer;
    switch (action.a) {
      case "choose":
        if (isDrawer) this.choose(Number(action.i) || 0);
        return;
      case "draw":
        if (isDrawer && this.phase === "draw") this.draw(playerId, action);
        return;
      case "undo":
        if (isDrawer && this.phase === "draw" && this.strokes.length) {
          this.strokes.pop();
          this.ctx.broadcast({ t: "redraw", strokes: this.strokes });
        }
        return;
      case "clear":
        if (isDrawer && this.phase === "draw") {
          this.strokes = [];
          this.totalPoints = 0;
          this.ctx.broadcast({ t: "redraw", strokes: [] });
        }
        return;
      case "guess":
        if (!isDrawer && this.phase === "draw") this.guess(playerId, action.text);
        return;
    }
  }

  private draw(playerId: string, action: any): void {
    const id = Number(action.id);
    if (!Number.isInteger(id) || id < 0) return;
    const raw = Array.isArray(action.p) ? action.p : [];
    const pts: number[] = [];
    for (let i = 0; i + 1 < raw.length && i < 400; i += 2) {
      const x = Math.round(Number(raw[i]));
      const y = Math.round(Number(raw[i + 1]));
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      pts.push(Math.max(0, Math.min(1000, x)), Math.max(0, Math.min(1000, y)));
    }
    if (!pts.length || this.totalPoints + pts.length / 2 > MAX_POINTS) return;
    this.totalPoints += pts.length / 2;
    let s = this.strokes.find((x) => x.id === id);
    if (!s) {
      const c = typeof action.c === "string" && COLOR_RE.test(action.c) ? action.c : "#222222";
      const w = Math.max(1, Math.min(60, Number(action.w) || 6));
      s = { id, c, w, p: [] };
      this.strokes.push(s);
    }
    s.p.push(...pts);
    // tutti ricevono il tratto; il client di chi disegna lo ignora (l'ha già disegnato)
    this.ctx.broadcast({ t: "draw", by: playerId, id: s.id, c: s.c, w: s.w, p: pts });
  }

  private matches(text: string): "yes" | "close" | "no" {
    if (!this.word) return "no";
    const g = normalize(text);
    if (!g) return "no";
    const all = [this.word.w, ...(this.word.alt ?? [])].map(normalize);
    if (all.includes(g)) return "yes";
    // tolleriamo plurali/singolari semplici
    for (const w of all) {
      if (w.length >= 5 && g.length >= 5 && w.slice(0, -1) === g.slice(0, -1)) return "yes";
    }
    for (const w of all) {
      const d = levenshtein(w, g);
      if ((w.length >= 4 && d <= 1) || (w.length >= 8 && d <= 2)) return "close";
    }
    return "no";
  }

  private guess(playerId: string, rawText: unknown): void {
    if (this.guessed.includes(playerId)) return;
    if (!this.participants.includes(playerId)) return;
    const text = cleanText(rawText, 40);
    if (!text) return;
    const r = this.matches(text);
    const p = this.ctx.player(playerId);
    if (r === "yes") {
      this.guessed.push(playerId);
      const frac = Math.max(0, 1 - (this.ctx.now() - this.drawStart) / DRAW_MS);
      const orderBonus = Math.max(0, 50 - (this.guessed.length - 1) * 15);
      const pts = Math.round(GUESS_MIN + (GUESS_MAX - GUESS_MIN) * frac + orderBonus);
      this.ctx.addScore(playerId, pts);
      this.turnPoints.set(playerId, pts);
      if (this.drawer) {
        this.ctx.addScore(this.drawer, DRAWER_PER_GUESS);
        this.turnPoints.set(this.drawer, (this.turnPoints.get(this.drawer) ?? 0) + DRAWER_PER_GUESS);
      }
      this.pushChat({ from: playerId, text: `${p?.name ?? "?"} ha indovinato!`, kind: "correct" });
      this.ctx.fx("correct");
      if (this.guessed.length === 1) {
        this.ctx.nonna(fill(pick(NONNA.correctGuess, this.ctx.rng), { name: p?.name ?? "" }));
      }
      const waiting = this.participants.filter(
        (id) => id !== this.drawer && !this.guessed.includes(id) && this.ctx.player(id)?.connected,
      );
      if (waiting.length === 0) {
        this.ctx.clearTimers();
        this.reveal();
        return;
      }
      // dopo il primo che indovina, il tempo si accorcia
      const left = DRAW_MS - (this.ctx.now() - this.drawStart);
      if (this.guessed.length === 1 && left > 25_000) {
        // non cancelliamo gli altri timer (indizi, bot) ma anticipiamo la fine
        this.ctx.after(25_000, () => this.reveal());
        this.ctx.setDeadline(25_000);
      }
    } else {
      if (r === "close") this.ctx.sendTo(playerId, { t: "toast", text: `"${text}" ... ci sei quasi!` });
      this.pushChat({ from: playerId, text, kind: "guess" });
    }
    this.ctx.changed();
  }

  private pushChat(l: ChatLine): void {
    this.chat.push(l);
    if (this.chat.length > 40) this.chat.shift();
  }

  onPlayerLeft(playerId: string): void {
    if (playerId === this.drawer && (this.phase === "draw" || this.phase === "choose")) {
      this.ctx.clearTimers();
      this.phase = "draw";
      this.reveal();
    }
  }

  private reveal(): void {
    if (this.phase !== "draw") return;
    this.ctx.clearTimers();
    this.phase = "reveal";
    if (this.guessed.length === 0) {
      this.ctx.nonna({ text: pick(NONNA.nobodyGuessed, this.ctx.rng), mood: "angry" });
      this.ctx.fx("fail");
    } else {
      this.ctx.fx("reveal");
    }
    if (this.drawer) {
      this.drawerFame.set(this.drawer, (this.drawerFame.get(this.drawer) ?? 0) + this.guessed.length);
    }
    this.ctx.setDeadline(REVEAL_MS);
    this.ctx.changed();
    this.ctx.after(REVEAL_MS, () => this.nextTurn());
  }

  private end(): void {
    let top: string | null = null;
    let n = 0;
    for (const [id, c] of this.drawerFame) {
      if (c > n) {
        n = c;
        top = id;
      }
    }
    if (top) this.ctx.award({ title: "Michelangelo di Paese", emoji: "🎨", playerId: top, why: `I suoi disegni sono stati indovinati ${n} volte` });
    this.ctx.finish();
  }

  private mask(): string {
    if (!this.word) return "";
    return [...this.word.w].map((ch, i) => (/[a-zàèéìòù]/i.test(ch) ? (this.revealed.has(i) ? ch : "_") : ch)).join("");
  }

  catchUp(): unknown[] {
    return [{ t: "redraw", strokes: this.strokes }];
  }

  view(playerId: string | null) {
    const isDrawer = !!playerId && playerId === this.drawer;
    const hasGuessed = !!playerId && this.guessed.includes(playerId);
    const showWord = this.phase === "reveal" || isDrawer || hasGuessed;
    return {
      kind: this.kind,
      phase: this.phase,
      turn: this.turn,
      turns: this.turns,
      drawer: this.drawer,
      isDrawer,
      choices: isDrawer && this.phase === "choose" ? this.choices.map((c) => c.w) : null,
      word: showWord && this.word ? this.word.w : null,
      mask: this.mask(),
      guessed: this.guessed,
      hasGuessed,
      participant: playerId ? this.participants.includes(playerId) : false,
      chat: this.chat,
      turnPoints: this.phase === "reveal" ? Object.fromEntries(this.turnPoints) : null,
    };
  }
}
