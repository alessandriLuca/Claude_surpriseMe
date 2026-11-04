// La Piazza: il registro delle tavolate aperte e la chat comune della home.
// Logica pura (testabile); il Durable Object in worker.ts la avvolge.

import type { RoomSummary } from "./engine";
import { cleanText } from "./util";

export const PIAZZA_STALE_MS = 100_000;
export const PIAZZA_CHAT_KEEP = 50;
export const PIAZZA_CHAT_MAX = 140;
export const PIAZZA_CHAT_GAP_MS = 1500;
const MAX_LISTED = 30;

export interface PiazzaMsg {
  id: number;
  name: string;
  avatar: string;
  text: string;
  ts: number;
}

export interface Visitor {
  name: string;
  avatar: string;
  lastChat: number;
}

const AVATAR_RE = /^[\p{Extended_Pictographic}‍️\u{1f3fb}-\u{1f3ff}]{1,8}$/u;

export class PiazzaState {
  private rooms = new Map<string, { s: RoomSummary; at: number }>();
  chat: PiazzaMsg[] = [];
  private seq = 0;

  update(s: RoomSummary, now: number): void {
    this.rooms.set(s.code, { s, at: now });
  }

  remove(code: string): void {
    this.rooms.delete(code);
  }

  prune(now: number): boolean {
    let changed = false;
    for (const [k, v] of this.rooms) {
      if (now - v.at > PIAZZA_STALE_MS || v.s.connected === 0) {
        this.rooms.delete(k);
        changed = true;
      }
    }
    return changed;
  }

  /** Tavolate pubbliche con qualcuno dentro: prima quelle che aspettano gente. */
  list(now: number): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((r) => now - r.at <= PIAZZA_STALE_MS && r.s.public && r.s.connected > 0)
      .map((r) => r.s)
      .sort((a, b) => {
        const wa = a.phase === "lobby" ? 0 : 1;
        const wb = b.phase === "lobby" ? 0 : 1;
        return wa - wb || b.players - a.players || a.code.localeCompare(b.code);
      })
      .slice(0, MAX_LISTED);
  }

  /** Persone a giocare in questo momento (tutte le stanze, anche private). */
  playing(now: number): number {
    let n = 0;
    for (const r of this.rooms.values()) if (now - r.at <= PIAZZA_STALE_MS) n += r.s.connected;
    return n;
  }

  /** Aggiunge un messaggio alla chat della Piazza; null se rifiutato. */
  say(v: Visitor, raw: unknown, now: number): PiazzaMsg | null {
    if (!v.name) return null;
    if (now - v.lastChat < PIAZZA_CHAT_GAP_MS) return null;
    const text = cleanText(raw, PIAZZA_CHAT_MAX);
    if (!text) return null;
    v.lastChat = now;
    const m: PiazzaMsg = { id: ++this.seq, name: v.name, avatar: v.avatar, text, ts: now };
    this.chat.push(m);
    if (this.chat.length > PIAZZA_CHAT_KEEP) this.chat.splice(0, this.chat.length - PIAZZA_CHAT_KEEP);
    return m;
  }

  static identify(msg: any): { name: string; avatar: string } {
    const name = cleanText(msg?.name, 18);
    const avatar = typeof msg?.avatar === "string" && AVATAR_RE.test(msg.avatar) ? msg.avatar : "🙂";
    return { name, avatar };
  }
}
