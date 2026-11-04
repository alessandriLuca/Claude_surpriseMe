// Battute di Nonna Pina, la presentatrice della Sagra.

export const NONNA = {
  welcome: [
    "Benvenuti alla Sagra! Avete mangiato? No? Male.",
    "Siediti, che sei sciupato. Si gioca!",
    "Ragazzi, mettete giù il telefono... anzi no, tenetelo, serve per giocare.",
    "Allora, chi ha portato il vino?",
    "Ah, finalmente! Pensavo foste morti.",
  ],
  join: [
    "È arrivato {name}! Mettete un altro piatto.",
    "Oh, {name}! Sei ingrassato o sbaglio?",
    "Benvenuto {name}, siediti vicino al nonno.",
    "{name}, ti sei lavato le mani?",
    "C'è anche {name}! Adesso sì che si ragiona.",
    "Ecco {name}, sempre in ritardo come il treno regionale.",
  ],
  botJoin: [
    "È arrivato {name}, il cugino del paese accanto. Non parla molto.",
    "Ho invitato {name}. È un po' strano, ma porta i dolci.",
  ],
  leave: [
    "{name} se n'è andato senza salutare. Che maleducato!",
    "{name} è uscito a fumare. Torna, eh!",
  ],
  start: [
    "Si comincia! E nessuno si alza da tavola finché non abbiamo finito.",
    "Che la Sagra abbia inizio! Che vinca il migliore, cioè il mio preferito.",
    "Pronti? Allacciate i grembiuli!",
  ],
  intro: {
    botta: [
      "Botta e Risposta! Fatemi ridere, che a una certa età serve.",
      "Adesso voglio sentire le vostre cattiverie. Ma con educazione.",
    ],
    pittore: [
      "Pittore Maledetto! Disegnate come Michelangelo... o almeno come il nipote.",
      "Prendete i pennelli! E non sporcate la tovaglia.",
    ],
    chi: [
      "Chi è stato? Adesso si scopre chi è il vero colpevole.",
      "Puntate il dito, tanto lo sappiamo tutti chi è stato.",
    ],
    espresso: [
      "Espresso Express! Quando esce il caffè, premete. Né prima né dopo!",
      "Vediamo chi ha i riflessi pronti. Io alla vostra età prendevo le mosche al volo.",
    ],
    bugiardo: [
      "Il Bugiardo! Inventatevi le balle più credibili, come fa lo zio con le tasse.",
      "Parole strane, definizioni false. Vediamo chi la racconta meglio.",
    ],
  } as Record<string, string[]>,
  answering: [
    "Scrivete, scrivete. Ma niente parolacce davanti al prete.",
    "Su, che il sugo si fredda!",
    "Pensateci bene. O male, basta che fa ridere.",
  ],
  voting: [
    "Votate con il cuore. E con lo stomaco.",
    "Adesso votate. Niente brogli, che vi vedo.",
  ],
  sweep: [
    "ASFALTATO! Tutti i voti a {name}!",
    "{name} ha fatto il pieno! Come alla sagra degli gnocchi.",
  ],
  tie: [
    "Pareggio! Come quando litigo con mia sorella: nessuno vince.",
    "Parità! Siete tutti e due bravi. O tutti e due scarsi.",
  ],
  correctGuess: [
    "Bravo {name}! Hai indovinato!",
    "{name} ci ha preso! Ti meriti una fetta di torta.",
  ],
  drawer: [
    "Tocca a {name} disegnare. Forza Picasso!",
    "{name}, fai vedere che non hai sprecato i soldi delle elementari.",
  ],
  nobodyGuessed: [
    "Nessuno ha indovinato! Ma cos'era, un pomodoro marcio?",
    "Zero! Neanche il gatto avrebbe capito quel disegno.",
  ],
  chiReveal: [
    "Il colpevole è {name}! Lo sapevo io.",
    "Tutti d'accordo: {name}! Vergogna!",
    "{name}, la gente ha parlato.",
  ],
  espressoEarly: [
    "{name} ha premuto troppo presto! Caffè bruciato!",
    "Ma che fretta hai, {name}? Il caffè non è pronto!",
  ],
  espressoWin: [
    "{name} è il più veloce! Riflessi da barista napoletano!",
    "{name} ha preso il caffè per primo! Ristretto!",
  ],
  interlude: [
    "Pausa! Chi vuole un altro po' di lasagna?",
    "Guardate la classifica, e chi è ultimo lava i piatti.",
    "Facciamo il punto, come al telegiornale.",
  ],
  final: [
    "E il Re della Sagra è... {name}! Portategli la porchetta!",
    "Ha vinto {name}! Lo dicevo io che era il mio nipote preferito.",
  ],
  last: [
    "E {name}, ultimo... lavi tu i piatti.",
    "{name}, non ti preoccupare, l'importante è partecipare. Dicono.",
  ],
  idle: [
    "Ai miei tempi si giocava a carte e basta.",
    "Qualcuno ha visto i miei occhiali?",
    "Non bevete troppo, che poi guidate.",
    "Mangia, che ti fa bene!",
    "Una volta ho vinto la gara di tortellini. Tre volte.",
  ],
};

export function fill(line: string, vars: Record<string, string>): string {
  return line.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
