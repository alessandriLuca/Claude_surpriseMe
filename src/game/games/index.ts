import type { GameContext, GameKind, MiniGame } from "../types";
import { Botta } from "./botta";
import { Bugiardo } from "./bugiardo";
import { Chi } from "./chi";
import { Espresso } from "./espresso";
import { Pigiatura } from "./pigiatura";
import { Pittore } from "./pittore";

export function createGame(kind: GameKind, ctx: GameContext): MiniGame {
  switch (kind) {
    case "botta":
      return new Botta(ctx);
    case "pittore":
      return new Pittore(ctx);
    case "chi":
      return new Chi(ctx);
    case "espresso":
      return new Espresso(ctx);
    case "bugiardo":
      return new Bugiardo(ctx);
    case "pigiatura":
      return new Pigiatura(ctx);
  }
}
