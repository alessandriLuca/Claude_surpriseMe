import { describe, expect, it } from "vitest";
import type { RoomSummary } from "../src/game/engine";
import { PIAZZA_STALE_MS, PiazzaState } from "../src/game/piazza";

const room = (code: string, extra: Partial<RoomSummary> = {}): RoomSummary => ({
  code,
  public: true,
  phase: "lobby",
  players: 2,
  max: 12,
  avatars: ["🍕", "🍷"],
  host: "Gino",
  hostAvatar: "🍕",
  connected: 2,
  ...extra,
});

describe("Piazza", () => {
  it("elenca solo le tavolate pubbliche con qualcuno dentro, prima quelle in attesa", () => {
    const p = new PiazzaState();
    p.update(room("AAAA", { phase: "playing", players: 6 }), 0);
    p.update(room("BBBB"), 0);
    p.update(room("CCCC", { public: false }), 0);
    p.update(room("DDDD", { connected: 0 }), 0);
    expect(p.list(1000).map((r) => r.code)).toEqual(["BBBB", "AAAA"]);
    // le persone a giocare contano anche le tavolate private
    expect(p.playing(1000)).toBe(6);
  });

  it("dimentica le tavolate che non si fanno più sentire", () => {
    const p = new PiazzaState();
    p.update(room("AAAA"), 0);
    expect(p.list(PIAZZA_STALE_MS + 1)).toEqual([]);
    expect(p.prune(PIAZZA_STALE_MS + 1)).toBe(true);
  });

  it("la chat vuole un nome e non accetta raffiche", () => {
    const p = new PiazzaState();
    const anon = { name: "", avatar: "🙂", lastChat: 0 };
    expect(p.say(anon, "ciao", 10_000)).toBe(null);
    const v = { ...PiazzaState.identify({ name: "Zia Pina", avatar: "👵" }), lastChat: 0 };
    expect(v.avatar).toBe("👵");
    expect(p.say(v, "c'è qualcuno per una partita?", 10_000)?.text).toBe("c'è qualcuno per una partita?");
    expect(p.say(v, "ehi", 10_500)).toBe(null);
    expect(p.say(v, "ehi", 12_000)?.name).toBe("Zia Pina");
  });

  it("avatar strani vengono sostituiti", () => {
    expect(PiazzaState.identify({ name: "x", avatar: "<script>" }).avatar).toBe("🙂");
  });
});
