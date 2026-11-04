// Classifica dell'Affettatrice: logica pura (validazione e inserimento).

import { PiazzaState } from "./piazza";

export interface ScoreEntry {
  name: string;
  avatar: string;
  score: number;
  ts: number;
}

export const BOARD_SIZE = 20;
/** punti massimi plausibili al secondo (combo comprese) */
const MAX_POINTS_PER_SEC = 12;

/** Valida un punteggio inviato dal client; null se non è credibile. */
export function validateScore(raw: any, now: number): ScoreEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const { name, avatar } = PiazzaState.identify(raw);
  if (!name) return null;
  const score = Number(raw.score);
  const ms = Number(raw.ms);
  if (!Number.isInteger(score) || score <= 0 || score > 100_000) return null;
  if (!Number.isFinite(ms) || ms < 3000 || ms > 60 * 60 * 1000) return null;
  if (score > (ms / 1000) * MAX_POINTS_PER_SEC + 30) return null;
  return { name, avatar, score, ts: now };
}

/**
 * Inserisce in una classifica ordinata. Ogni nome compare una volta sola
 * (vale il suo record). Ritorna la nuova lista e la posizione (1-based, 0 se fuori).
 */
export function insertScore(list: ScoreEntry[], e: ScoreEntry, size = BOARD_SIZE): { list: ScoreEntry[]; rank: number } {
  const key = e.name.toLowerCase();
  const existing = list.find((x) => x.name.toLowerCase() === key);
  if (existing && existing.score >= e.score) {
    return { list, rank: 0 };
  }
  const next = list.filter((x) => x.name.toLowerCase() !== key);
  next.push(e);
  next.sort((a, b) => b.score - a.score || a.ts - b.ts);
  const trimmed = next.slice(0, size);
  const idx = trimmed.indexOf(e);
  return { list: trimmed, rank: idx >= 0 ? idx + 1 : 0 };
}

/** Giorno di calendario italiano, per la classifica "di oggi". */
export function dayKey(now: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
