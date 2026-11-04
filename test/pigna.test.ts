import { describe, expect, it } from "vitest";
// @ts-expect-error modulo JS del client, senza tipi
import { distances, generateLevel, path, walkable, WALL } from "../public/js/pigna-level.js";

describe("Pigna: generatore di livelli", () => {
  it("ogni livello è risolvibile e ha tutto il necessario", () => {
    for (let n = 1; n <= 30; n++) {
      const lv = generateLevel(n);
      const [sx, sy] = lv.start;
      expect(walkable(lv, sx, sy)).toBe(true);
      const d = distances(lv, sx, sy);
      // tutte le celle libere sono raggiungibili
      lv.grid.forEach((c: number, i: number) => {
        if (c !== WALL) expect(d[i]).toBeGreaterThanOrEqual(0);
      });
      expect(lv.spots.length).toBeGreaterThanOrEqual(3);
      expect(lv.spots).toContain(lv.target);
      expect(d[lv.target]).toBeGreaterThanOrEqual(3);
      for (const b of lv.bones) expect(lv.spots).not.toContain(b);
      expect(lv.timeLimit).toBeGreaterThan(30);
    }
  });

  it("i livelli crescono e arrivano i gatti", () => {
    const a = generateLevel(1);
    const b = generateLevel(8);
    expect(b.cols * b.rows).toBeGreaterThan(a.cols * a.rows);
    expect(a.cats.length).toBe(0);
    expect(b.cats.length).toBe(2);
  });

  it("stesso livello, stessa stanza (deterministico)", () => {
    expect(generateLevel(4).grid).toEqual(generateLevel(4).grid);
  });

  it("il percorso porta davvero al fazzoletto", () => {
    const lv = generateLevel(6);
    const [sx, sy] = lv.start;
    const tx = lv.target % lv.cols;
    const ty = Math.floor(lv.target / lv.cols);
    const p = path(lv, sx, sy, tx, ty)!;
    expect(p.at(-1)).toEqual([tx, ty]);
    expect(p.length).toBe(distances(lv, sx, sy)[lv.target]);
    // nessun passo attraversa un muro e i passi sono adiacenti
    let [px, py] = [sx, sy];
    for (const [x, y] of p) {
      expect(walkable(lv, x, y)).toBe(true);
      expect(Math.abs(x - px) + Math.abs(y - py)).toBe(1);
      [px, py] = [x, y];
    }
  });
});
