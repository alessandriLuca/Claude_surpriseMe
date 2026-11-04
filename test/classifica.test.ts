import { describe, expect, it } from "vitest";
import { dayKey, insertScore, validateScore } from "../src/game/classifica";

describe("classifica dell'Affettatrice", () => {
  it("accetta punteggi plausibili e rifiuta quelli impossibili", () => {
    expect(validateScore({ name: "Luca", avatar: "🍕", score: 120, ms: 60_000 }, 1)?.score).toBe(120);
    expect(validateScore({ name: "Luca", avatar: "🍕", score: 5000, ms: 10_000 }, 1)).toBe(null);
    expect(validateScore({ name: "", score: 10, ms: 10_000 }, 1)).toBe(null);
    expect(validateScore({ name: "x", score: 1.5, ms: 10_000 }, 1)).toBe(null);
    expect(validateScore({ name: "x", score: 10, ms: 100 }, 1)).toBe(null);
  });

  it("tiene un solo record per nome e ordina", () => {
    let list: any[] = [];
    list = insertScore(list, { name: "A", avatar: "🍕", score: 10, ts: 1 }).list;
    list = insertScore(list, { name: "B", avatar: "🍕", score: 30, ts: 2 }).list;
    const r = insertScore(list, { name: "a", avatar: "🍕", score: 50, ts: 3 });
    expect(r.rank).toBe(1);
    expect(r.list.map((x) => x.score)).toEqual([50, 30]);
    const worse = insertScore(r.list, { name: "A", avatar: "🍕", score: 5, ts: 4 });
    expect(worse.rank).toBe(0);
    expect(worse.list.length).toBe(2);
  });

  it("taglia la classifica alla dimensione massima", () => {
    let list: any[] = [];
    for (let i = 0; i < 25; i++) list = insertScore(list, { name: "P" + i, avatar: "🍕", score: i + 1, ts: i }, 20).list;
    expect(list.length).toBe(20);
    expect(insertScore(list, { name: "Scarso", avatar: "🍕", score: 1, ts: 99 }, 20).rank).toBe(0);
  });

  it("il giorno è quello italiano", () => {
    // 23:30 UTC del 4 novembre = 00:30 del 5 novembre a Roma
    expect(dayKey(Date.UTC(2026, 10, 4, 23, 30))).toBe("2026-11-05");
  });
});
