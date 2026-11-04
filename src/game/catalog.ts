import type { GameInfo, GameKind } from "./types";

export const GAMES: Record<GameKind, GameInfo> = {
  botta: {
    kind: "botta",
    title: "Botta e Risposta",
    emoji: "🎤",
    tagline: "Due risposte, uno spunto, un solo vincitore.",
    rules: [
      "Ricevi degli spunti: scrivi la risposta più divertente che ti viene.",
      "Ogni spunto va a due giocatori: gli altri votano la risposta migliore.",
      "100 punti per voto. Se prendi tutti i voti: ASFALTATO! bonus.",
    ],
    minPlayers: 3,
  },
  pittore: {
    kind: "pittore",
    title: "Pittore Maledetto",
    emoji: "🎨",
    tagline: "Disegna la parola, gli altri indovinano.",
    rules: [
      "A turno uno disegna una parola segreta.",
      "Gli altri scrivono in chat: chi indovina prima prende più punti.",
      "Chi disegna prende punti per ogni persona che indovina.",
    ],
    minPlayers: 2,
  },
  chi: {
    kind: "chi",
    title: "Chi è stato?",
    emoji: "🕵️",
    tagline: "Punta il dito. Tanto lo sappiamo tutti.",
    rules: [
      "Arriva una domanda tipo: 'Chi si addormenterebbe al proprio matrimonio?'",
      "Vota il giocatore più adatto (anche te stesso, se hai coraggio).",
      "Prendi punti se voti come la maggioranza.",
    ],
    minPlayers: 3,
  },
  espresso: {
    kind: "espresso",
    title: "Espresso Express",
    emoji: "☕",
    tagline: "Premi quando esce il caffè. Né prima, né dopo.",
    rules: [
      "La moka è sul fuoco: aspetta che esca il caffè.",
      "Appena diventa VERDE premi il più veloce possibile.",
      "Se premi prima: caffè bruciato e punti in meno!",
    ],
    minPlayers: 1,
  },
  bugiardo: {
    kind: "bugiardo",
    title: "Il Bugiardo",
    emoji: "🤥",
    tagline: "Parole vere, definizioni false.",
    rules: [
      "Appare una parola italiana rarissima (ma vera!).",
      "Inventa una definizione falsa che sembri credibile.",
      "Poi trova quella vera: punti se indovini, punti se gli altri cascano nella tua balla.",
    ],
    minPlayers: 2,
  },
};

export const GAME_ORDER: GameKind[] = ["espresso", "botta", "pittore", "bugiardo", "chi"];
