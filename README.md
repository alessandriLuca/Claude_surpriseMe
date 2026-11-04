# 🎉 SAGRA! — il party game da sagra di paese

Un party game **multigiocatore in tempo reale**, tutto in italiano, che gira su **Cloudflare Workers + Durable Objects**.
Ci si siede a tavola, ognuno usa il proprio telefono, e la serata la presenta **Nonna Pina** (che parla davvero, se il browser ha una voce italiana).

Non ci sono app da installare, account da creare o file audio da scaricare: musica ed effetti sono **sintetizzati al volo** nel browser (c'è pure una tarantella originale per fisarmonica sintetica).

## I giochi

| | Gioco | Come funziona |
|---|---|---|
| ☕ | **Espresso Express** | La moka è sul fuoco: premi appena lo schermo diventa verde. Se premi prima, caffè bruciato e punti in meno. |
| 🎤 | **Botta e Risposta** | Due giocatori rispondono allo stesso spunto ("La password del Wi-Fi del Vaticano"), gli altri votano. Se prendi tutti i voti: **ASFALTATO!** |
| 🎨 | **Pittore Maledetto** | Uno disegna la parola segreta su una lavagna condivisa in tempo reale, gli altri indovinano in chat. |
| 🤥 | **Il Bugiardo** | Esce una parola italiana rarissima ma vera ("Abbiosciarsi"). Tutti inventano una definizione falsa, poi bisogna trovare quella vera. |
| 🕵️ | **Chi è stato?** | "Chi si addormenterebbe al proprio matrimonio?" Voto segreto: punti a chi vota con la maggioranza. |
| 🍇 | **La Pigiatura** | 10 secondi per pestare l'uva toccando lo schermo il più veloce possibile: le botti di tutti si riempiono in diretta. |

A fine serata ci sono podio, coriandoli e **premi speciali**: *Re della Sagra*, *Riflessi da Gatto*, *Battuta d'Oro*, *Piedi d'Oro*, *Michelangelo di Paese*, *Bugiardo Patentato*, *Il Solito Sospettato*… e *Lava i Piatti* per l'ultimo.

### Altre cose belle

- **La Piazza** nella home: vedi le tavolate aperte a tutti e ti siedi con un tocco, senza codice. C'è il contatore di chi sta giocando e una chat comune per trovare compagnia.
- **Chat della tavolata** sempre aperta, anche durante i giochi, con il contatore dei messaggi non letti. Nel Pittore la parola segreta viene bloccata: niente spoiler.
- **Tavolata privata o pubblica**: ogni tavolata nasce **privata** (si entra solo col codice); l'host può renderla pubblica con un interruttore e farla comparire nella Piazza.
- **Turni su misura**: oltre alla durata generale, l'host sceglie quante volte disegna ognuno nel Pittore (da 1 a 4).

- **Codice stanza + QR code** per entrare al volo; link condivisibile.
- **Modalità TV** (`/CODICE?tv=1`): uno schermo grande che mostra la partita a tutti, come al bar.
- **I cugini-bot**: pochi a tavola? L'host aggiunge "Zio Peppino" e compagnia, che rispondono, votano e indovinano (male).
- **Reazioni emoji** che volano sullo schermo di tutti.
- **Riconnessione automatica**: se chiudi il telefono e rientri, ritrovi il tuo posto e i tuoi punti.
- Durata scelta dall'host (corta / normale / lunga), giochi a scelta, host che può saltare le spiegazioni.
- Funziona bene da telefono, tablet, computer e TV. Rispetta "riduci movimento".

## Come si gioca

1. Uno apre il sito e preme **"Apparecchia una nuova tavolata"**: diventa l'host.
2. Gli altri inquadrano il QR (o scrivono il codice di 4 lettere).
3. L'host sceglie i giochi e la durata, poi **Si comincia!**
4. Consigliati da 3 a 12 giocatori. Con meno di 3 si possono aggiungere i bot.

## Mettilo online su Cloudflare

Serve un account Cloudflare (va bene quello **gratuito**: i Durable Objects con SQLite sono inclusi nel piano Free).

```bash
npm install
```

```bash
npx wrangler login
```

```bash
npm run deploy
```

Wrangler stampa l'indirizzo, tipo `https://sagra.<tuo-sottodominio>.workers.dev`. Fatto: mandalo nel gruppo di famiglia.

### Deploy automatico da GitHub

Il workflow `.github/workflows/deploy.yml` esegue typecheck e test a ogni push, e su `main` pubblica su Cloudflare se trova questi due segreti nel repository (*Settings → Secrets and variables → Actions*):

- `CLOUDFLARE_API_TOKEN`: crealo da *Cloudflare Dashboard → My Profile → API Tokens*, modello **"Edit Cloudflare Workers"**.
- `CLOUDFLARE_ACCOUNT_ID`: lo trovi nella home della dashboard di Cloudflare.

In alternativa puoi collegare il repository direttamente da *Cloudflare Dashboard → Workers & Pages → Create → Import a repository* (comando di deploy: `npx wrangler deploy`).

## Sviluppo in locale

```bash
npm run dev
```

Apri `http://localhost:8787` in più schede (o da più telefoni nella stessa rete) e gioca contro te stesso.

```bash
npm test
```

```bash
npm run typecheck
```

C'è anche un test end-to-end che apre tre browser veri (desktop, iPhone, Android) più uno schermo TV, e gioca una serata intera cliccando l'interfaccia, salvando gli screenshot in `e2e/shots/`:

```bash
node e2e/run.mjs http://127.0.0.1:8787
```

(serve Playwright con Chromium: `npm i -D playwright && npx playwright install chromium`).

## Come è fatto

```
src/
  worker.ts            Worker: API, Durable Object Room (una per tavolata) e Piazza (unica)
  game/
    engine.ts          motore della stanza: giocatori, host, fasi, bot, punteggi, chat
    piazza.ts          registro delle tavolate pubbliche e chat della home
    games/*.ts         i 6 minigiochi (logica autoritativa lato server)
    content/*.ts       spunti, parole, battute della nonna (tutto a mano)
public/
  index.html, css/     interfaccia (niente framework, niente build)
  js/app.js            client: stato, schermate, timer
  js/screens/*.js      una schermata per gioco
  js/audio.js          effetti e tarantella sintetizzati con Web Audio
  js/nonna.js          Nonna Pina: SVG animato + sintesi vocale
test/                  test del motore con orologio finto (vitest)
e2e/run.mjs            partita completa con browser veri (Playwright)
```

- Ogni stanza è un **Durable Object** che tiene lo stato in memoria e parla con i client via **WebSocket**. Il server è autoritativo: i client mandano azioni, il server manda a ciascuno la sua vista personalizzata (chi disegna vede la parola, gli altri no).
- I timer sono lato server; il client stima lo sfasamento dell'orologio con un ping per mostrare i conti alla rovescia giusti.
- In Espresso Express il tempo di reazione è misurato sul telefono, con controlli lato server contro chi bara (niente tap prima del via, niente riflessi sotto i 90 ms). Nella Pigiatura il server limita le pestate a 20 al secondo, così gli autoclicker non servono.
- Le stanze vuote vengono sgomberate automaticamente dopo 30 minuti.
- La Piazza è un unico Durable Object: le stanze le mandano un riassunto quando cambiano (e un segnale di vita ogni 40 s); lei lo inoltra in tempo reale a chi è in home.

Licenza MIT. Fatto con amore, ragù e Cloudflare Workers.
