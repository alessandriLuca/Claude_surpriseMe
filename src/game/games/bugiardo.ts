import { BALLE_BOT, PAROLE_RARE, type ParolaRara } from "../content/bugiardo";
import { NONNA, fill } from "../content/nonna";
import type { GameContext, MiniGame } from "../types";
import { cleanText, levenshtein, normalize, pick, sample, shuffle } from "../util";

type Phase = "write" | "pick" | "reveal";

interface Option {
  id: number;
  text: string;
  /** autori della balla (vuoto = definizione vera) */
  authors: string[];
  truth: boolean;
}

export const BUG_TRUTH_POINTS = 200;
export const BUG_FOOL_POINTS = 100;
const WRITE_MS = 55_000;
const PICK_MS = 25_000;
const REVEAL_MS = 8_000;

export class Bugiardo implements MiniGame {
  readonly kind = "bugiardo" as const;
  private phase: Phase = "write";
  private participants: string[] = [];
  private words: ParolaRara[] = [];
  private idx = -1;
  private lies = new Map<string, string>();
  private options: Option[] = [];
  private picks = new Map<string, number>();
  private fooled = new Map<string, number>();
  private lastPoints: Record<string, number> = {};

  constructor(private ctx: GameContext) {}

  start(): void {
    this.participants = this.ctx.players().map((p) => p.id);
    this.words = sample(PAROLE_RARE, 2 + this.ctx.length, this.ctx.rng);
    this.next();
  }

  private get word(): ParolaRara | undefined {
    return this.words[this.idx];
  }

  private next(): void {
    this.idx++;
    if (this.idx >= this.words.length) return this.end();
    this.phase = "write";
    this.lies.clear();
    this.picks.clear();
    this.options = [];
    this.lastPoints = {};
    this.ctx.setDeadline(WRITE_MS);
    this.ctx.changed();
    this.ctx.after(WRITE_MS, () => this.toPick());
    const botLies = shuffle(BALLE_BOT, this.ctx.rng);
    let k = 0;
    for (const id of this.participants) {
      if (!this.ctx.player(id)?.isBot) continue;
      const text = botLies[k++ % botLies.length];
      this.ctx.after(4000 + this.ctx.rng() * 15000, () => this.onAction(id, { a: "lie", text }));
    }
  }

  private tooTrue(text: string): boolean {
    const w = this.word;
    if (!w) return false;
    const a = normalize(text);
    const b = normalize(w.def);
    return a === b || (b.length > 10 && levenshtein(a, b) <= 3);
  }

  onAction(playerId: string, action: any): void {
    if (!action || !this.participants.includes(playerId)) return;
    if (action.a === "lie" && this.phase === "write") {
      if (this.lies.has(playerId)) return;
      const text = cleanText(action.text, 80);
      if (!text) return;
      if (this.tooTrue(text)) {
        this.ctx.sendTo(playerId, { t: "toast", text: "Ehi, questa è la definizione vera! Inventa una balla." });
        return;
      }
      this.lies.set(playerId, text);
      this.ctx.changed();
      if (this.allConnected((id) => this.lies.has(id))) {
        this.ctx.clearTimers();
        this.toPick();
      }
      return;
    }
    if (action.a === "pick" && this.phase === "pick") {
      if (this.picks.has(playerId)) return;
      const opt = this.options.find((o) => o.id === Number(action.option));
      if (!opt || opt.authors.includes(playerId)) return;
      this.picks.set(playerId, opt.id);
      this.ctx.changed();
      if (this.allConnected((id) => this.picks.has(id) || !this.canPickAnything(id))) {
        this.ctx.clearTimers();
        this.reveal();
      }
    }
  }

  private canPickAnything(id: string): boolean {
    return this.options.some((o) => !o.authors.includes(id));
  }

  private allConnected(pred: (id: string) => boolean): boolean {
    return this.participants.every((id) => !this.ctx.player(id)?.connected || pred(id));
  }

  onPlayerLeft(): void {
    if (this.phase === "write" && this.lies.size && this.allConnected((id) => this.lies.has(id))) {
      this.ctx.clearTimers();
      this.toPick();
    } else if (this.phase === "pick" && this.allConnected((id) => this.picks.has(id))) {
      this.ctx.clearTimers();
      this.reveal();
    }
  }

  private toPick(): void {
    if (this.phase !== "write" || !this.word) return;
    // balle uguali vengono unite: gli autori condividono i punti
    const merged = new Map<string, Option>();
    let nextId = 1;
    for (const [author, text] of this.lies) {
      const key = normalize(text);
      const ex = merged.get(key);
      if (ex) ex.authors.push(author);
      else merged.set(key, { id: nextId++, text, authors: [author], truth: false });
    }
    const opts = [...merged.values()];
    // se nessuno ha scritto, la nonna ci mette una balla sua
    if (opts.length === 0) opts.push({ id: nextId++, text: pick(BALLE_BOT, this.ctx.rng), authors: [], truth: false });
    opts.push({ id: 0, text: this.word.def, authors: [], truth: true });
    this.options = shuffle(opts, this.ctx.rng).map((o, i) => ({ ...o, id: i }));
    this.phase = "pick";
    this.ctx.setDeadline(PICK_MS);
    this.ctx.changed();
    this.ctx.after(PICK_MS, () => this.reveal());
    for (const id of this.participants) {
      if (!this.ctx.player(id)?.isBot) continue;
      const allowed = this.options.filter((o) => !o.authors.includes(id));
      if (!allowed.length) continue;
      // i bot ci prendono un po' più spesso del caso
      const truth = allowed.find((o) => o.truth);
      const choice = truth && this.ctx.rng() < 0.4 ? truth : pick(allowed, this.ctx.rng);
      this.ctx.after(2000 + this.ctx.rng() * 9000, () => this.onAction(id, { a: "pick", option: choice.id }));
    }
  }

  private reveal(): void {
    if (this.phase !== "pick") return;
    this.phase = "reveal";
    const pts: Record<string, number> = {};
    const add = (id: string, n: number) => {
      pts[id] = (pts[id] ?? 0) + n;
      this.ctx.addScore(id, n);
    };
    for (const [voter, optId] of this.picks) {
      const o = this.options.find((x) => x.id === optId);
      if (!o) continue;
      if (o.truth) add(voter, BUG_TRUTH_POINTS);
      else
        for (const a of o.authors) {
          if (a === voter) continue;
          add(a, BUG_FOOL_POINTS);
          this.fooled.set(a, (this.fooled.get(a) ?? 0) + 1);
        }
    }
    this.lastPoints = pts;
    // la balla che ha ingannato di più
    let best: Option | null = null;
    let bestN = 0;
    for (const o of this.options) {
      if (o.truth) continue;
      const n = [...this.picks.values()].filter((v) => v === o.id).length;
      if (n > bestN) {
        bestN = n;
        best = o;
      }
    }
    if (best && best.authors[0] && bestN >= 2) {
      const p = this.ctx.player(best.authors[0]);
      this.ctx.nonna({ text: `${p?.name ?? "Qualcuno"} ne ha fregati ${bestN}! Che faccia tosta!`, mood: "sly" });
    } else {
      const right = [...this.picks.values()].filter((v) => this.options[v]?.truth).length;
      this.ctx.nonna({
        text: right === 0 ? "Nessuno sapeva la verità! Ignoranti, tornate a scuola!" : fill("{n} di voi conoscevano la verità. Bravi, studiosi.", { n: String(right) }),
        mood: right === 0 ? "angry" : "happy",
      });
    }
    this.ctx.fx("reveal");
    this.ctx.setDeadline(REVEAL_MS);
    this.ctx.changed();
    this.ctx.after(REVEAL_MS, () => this.next());
  }

  private end(): void {
    let top: string | null = null;
    let n = 1;
    for (const [id, c] of this.fooled) {
      if (c > n || (c === n && !top)) {
        n = c;
        top = id;
      }
    }
    if (top && n >= 2) this.ctx.award({ title: "Bugiardo Patentato", emoji: "🤥", playerId: top, why: `Ha ingannato ${n} persone` });
    this.ctx.finish();
  }

  view(playerId: string | null) {
    const w = this.word;
    const base = {
      kind: this.kind,
      phase: this.phase,
      index: this.idx,
      total: this.words.length,
      word: w?.word ?? "",
      participant: playerId ? this.participants.includes(playerId) : false,
    };
    if (this.phase === "write") {
      return { ...base, myLie: playerId ? this.lies.get(playerId) ?? null : null, doneIds: [...this.lies.keys()] };
    }
    const revealed = this.phase === "reveal";
    return {
      ...base,
      options: this.options.map((o) => ({
        id: o.id,
        text: o.text,
        mine: playerId ? o.authors.includes(playerId) : false,
        truth: revealed ? o.truth : undefined,
        authors: revealed ? o.authors : undefined,
        pickers: revealed ? [...this.picks].filter(([, v]) => v === o.id).map(([k]) => k) : undefined,
      })),
      myPick: playerId ? this.picks.get(playerId) ?? null : null,
      doneIds: [...this.picks.keys()],
      points: revealed ? this.lastPoints : null,
    };
  }
}
