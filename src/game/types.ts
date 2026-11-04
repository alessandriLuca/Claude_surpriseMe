// Tipi condivisi del motore di gioco della Sagra.

export type GameKind = "botta" | "pittore" | "chi" | "espresso" | "bugiardo";

export interface Player {
  id: string;
  /** token segreto usato per riconnettersi */
  token: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  connected: boolean;
  isBot: boolean;
  spectator: boolean;
  joinedAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  color: string;
  score: number;
  connected: boolean;
  isBot: boolean;
}

export type RoomPhase = "lobby" | "intro" | "playing" | "interlude" | "final";

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface NonnaLine {
  text: string;
  mood?: "happy" | "angry" | "shock" | "proud" | "sly";
}

/** Contesto che il motore offre a ogni minigioco. */
export interface GameContext {
  /** giocatori attivi (non spettatori), in ordine di ingresso */
  players(): Player[];
  player(id: string): Player | undefined;
  addScore(id: string, points: number): void;
  /** pianifica una callback; tutte vengono annullate al cambio fase */
  after(ms: number, fn: () => void): void;
  /** annulla tutti i timer della fase corrente */
  clearTimers(): void;
  /** imposta la scadenza visibile ai client (ms epoch) */
  setDeadline(msFromNow: number | null): void;
  /** segnala che lo stato è cambiato e va ritrasmesso */
  changed(): void;
  /** il minigioco ha finito */
  finish(): void;
  broadcast(msg: unknown): void;
  sendTo(playerId: string, msg: unknown): void;
  nonna(line: NonnaLine | string): void;
  rng(): number;
  now(): number;
  /** numero di "giri" scelto dall'host: 1 corta, 2 normale, 3 lunga */
  length: number;
  /** assegna un premio speciale da mostrare nel finale */
  award(a: { title: string; emoji: string; playerId: string; why: string }): void;
  /** effetto sonoro/visivo per tutti */
  fx(name: string): void;
}

export interface MiniGame {
  readonly kind: GameKind;
  start(): void;
  /** vista personalizzata per un giocatore (o spettatore se id null) */
  view(playerId: string | null): unknown;
  onAction(playerId: string, action: any): void;
  onPlayerLeft?(playerId: string): void;
  /** stato iniziale di eventuali dati incrementali (es. tratti del disegno) */
  catchUp?(playerId: string): unknown[];
}

export interface GameInfo {
  kind: GameKind;
  title: string;
  emoji: string;
  tagline: string;
  rules: string[];
  minPlayers: number;
}
