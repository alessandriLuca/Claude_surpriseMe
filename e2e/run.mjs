// Test end-to-end: tre giocatori veri (browser) + un bot + uno schermo TV
// giocano una serata completa cliccando l'interfaccia.
// Uso: avvia `npx wrangler dev` e poi `node e2e/run.mjs [baseUrl]`.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright è preinstallato globalmente nell'ambiente di sviluppo; in locale: npm i -D playwright
const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const SHOTS = new URL("./shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];

async function newPlayer(label, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`[${label}] ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.label = label;
  return page;
}

const A = await newPlayer("A-desktop", { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
const B = await newPlayer("B-iphone", { ...devices["iPhone 13"] });
const C = await newPlayer("C-android", { ...devices["Pixel 7"] });

// ------------------------------------------------------------- home + creazione
await A.goto(BASE);
await A.waitForSelector(".logo");
await A.screenshot({ path: SHOTS + "00-home-desktop.png" });
await A.fill('input[aria-label="Il tuo nome"]', "Luca");
await A.click("text=Apparecchia una nuova tavolata");
await A.waitForSelector(".room-code-big");
const code = (await A.textContent(".room-code-big")).trim();
console.log("stanza", code);

await B.goto(BASE + "/" + code);
await B.screenshot({ path: SHOTS + "01-join-phone.png" });
await B.fill('input[aria-label="Il tuo nome"]', "Giulia");
await B.click('button:has-text("Entra")');
await B.waitForSelector(".players-grid");

await C.goto(BASE);
await C.fill('input[aria-label="Il tuo nome"]', "Marco");
await C.fill('input[aria-label="Codice della stanza"]', code);
await C.click('button:has-text("Entra")');
await C.waitForSelector(".players-grid");

const TV = await newPlayer("TV", { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
await TV.goto(BASE + "/" + code + "?tv=1");
await TV.waitForSelector(".players-grid");

await A.click("text=Aggiungi un cugino");
await A.waitForFunction(() => window.__sagra.st.players.length === 4);
await A.waitForTimeout(400);
await A.screenshot({ path: SHOTS + "02-lobby-host.png" });
await B.screenshot({ path: SHOTS + "03-lobby-phone.png" });
await TV.screenshot({ path: SHOTS + "04-lobby-tv.png" });

// durata corta
await A.click('.seg button:has-text("Corta")');
await A.click("text=Si comincia!");

// ------------------------------------------------------------- cervello dei giocatori
const players = [A, B, C];
const seen = new Set();

async function st(page) {
  return page.evaluate(() => {
    const s = window.__sagra.st;
    return s ? { phase: s.phase, game: s.game, key: window.__sagra.screen?.key, you: s.you, hostId: s.hostId } : null;
  });
}

async function shot(page, key) {
  const name = `${page.label}-${key}`.replace(/[^a-z0-9-]+/gi, "_");
  if (seen.has(name)) return;
  seen.add(name);
  await page.waitForTimeout(350);
  await page.screenshot({ path: SHOTS + String(seen.size).padStart(3, "0") + "-" + name + ".png" });
}

let pittoreWord = null;

async function play(page) {
  const s = await st(page);
  if (!s) return;
  if (page === A || page === B || s.phase !== "playing") await shot(page, s.key);
  const g = s.game;
  if (s.phase === "intro" || s.phase === "interlude") {
    if (s.you === s.hostId) {
      await page.waitForTimeout(1200);
      await page.click('button:has-text("▶")').catch(() => {});
    }
    return;
  }
  if (s.phase !== "playing" || !g) return;
  switch (g.kind) {
    case "espresso":
      if (g.phase === "armed" && !g.tapped) {
        await page.waitForSelector(".espresso-stage.go", { timeout: 9000 }).catch(() => {});
        await page.waitForTimeout(150 + Math.random() * 200);
        await page.click(".espresso-stage").catch(() => {});
      }
      break;
    case "botta":
      if (g.phase === "answer") {
        // dopo ogni invio le schede vengono ricostruite: ri-cerchiamo ogni volta
        for (let i = 0; i < 3; i++) {
          const ta = page.locator("textarea").first();
          if (!(await ta.count())) break;
          await ta.fill(["Il prezzemolo della zia", "Un piccione in Vespa", "Tre chili di mortadella", "La suocera"][Math.floor(Math.random() * 4)]);
          await ta.press("Enter");
          await page.waitForTimeout(300);
        }
      } else if (g.phase === "vote" && g.canVote && g.myVote == null) {
        await page.click(".answer-btn:not([disabled])").catch(() => {});
      }
      break;
    case "pittore":
      if (g.isDrawer && g.phase === "choose") {
        await page.click(".choices button").catch(() => {});
      } else if (g.isDrawer && g.phase === "draw") {
        pittoreWord = g.word;
        if (!page.drewTurn || page.drewTurn !== g.turn) {
          page.drewTurn = g.turn;
          const box = await page.locator(".canvas-wrap canvas").boundingBox();
          if (box) {
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            await page.mouse.move(cx - 100, cy - 60);
            await page.mouse.down();
            for (let i = 0; i <= 40; i++) {
              const a = (i / 40) * Math.PI * 2;
              await page.mouse.move(cx + Math.cos(a) * 110, cy + Math.sin(a) * 90);
            }
            await page.mouse.up();
            await page.click('.tools .sw[aria-label="Colore #d62828"]').catch(() => {});
            await page.mouse.move(cx - 40, cy - 20);
            await page.mouse.down();
            await page.mouse.move(cx + 40, cy + 30, { steps: 10 });
            await page.mouse.up();
          }
          await shot(page, s.key + "-drawing");
          for (const other of players) if (other !== page) await shot(other, s.key + "-watching");
        }
      } else if (!g.isDrawer && g.phase === "draw" && !g.hasGuessed && g.participant) {
        const inp = page.locator(".chat input");
        if (await inp.isEnabled().catch(() => false)) {
          const tries = (page.tries = (page.tries ?? 0) + 1);
          await inp.fill(tries % 2 === 1 || !pittoreWord ? "un gatto?" : pittoreWord);
          await inp.press("Enter");
          await page.waitForTimeout(700);
        }
      }
      break;
    case "pigiatura":
      if (g.phase === "stomp" && g.participant) {
        const pad = await page.locator(".stomp-pad.go").boundingBox().catch(() => null);
        if (pad) {
          const n = 25 + Math.floor(Math.random() * 30);
          for (let i = 0; i < n; i++) {
            await page.mouse.click(pad.x + pad.width * (0.3 + Math.random() * 0.4), pad.y + pad.height / 2);
            await page.waitForTimeout(40);
            if (i === 15) await shot(page, s.key + "-stomping");
          }
        }
      }
      break;
    case "chi":
      if (g.phase === "vote" && !g.myVote) await page.click(".suspect:not([disabled])").catch(() => {});
      break;
    case "bugiardo":
      if (g.phase === "write" && !g.myLie) {
        const ta = await page.$("textarea");
        if (ta) {
          await ta.fill("Un formaggio stagionato in una grotta di " + page.label);
          await ta.press("Enter");
        }
      } else if (g.phase === "pick" && g.myPick == null) {
        await page.click(".opt:not(.mine):not([disabled])").catch(() => {});
      }
      break;
  }
}

const t0 = Date.now();
let done = false;
const loops = players.map(async (p) => {
  while (!done && Date.now() - t0 < 12 * 60_000) {
    try {
      await play(p);
    } catch (e) {
      errors.push(`[${p.label}] loop: ${e.message}`);
    }
    const s = await st(p).catch(() => null);
    if (s?.phase === "final") break;
    await p.waitForTimeout(250);
  }
});
// la TV fa screenshot di ogni schermata
const tvLoop = (async () => {
  while (!done && Date.now() - t0 < 12 * 60_000) {
    const s = await st(TV).catch(() => null);
    if (s) await shot(TV, s.key);
    if (s?.phase === "final") break;
    await TV.waitForTimeout(500);
  }
})();
await Promise.all(loops);
done = true;
await tvLoop;

await A.waitForTimeout(2500);
await A.screenshot({ path: SHOTS + "990-final-desktop.png", fullPage: true });
await B.screenshot({ path: SHOTS + "991-final-phone.png", fullPage: true });
await TV.screenshot({ path: SHOTS + "992-final-tv.png" });

const final = await A.evaluate(() => window.__sagra.st);
console.log("fase finale:", final.phase);
console.log("punteggi:", final.players.map((p) => `${p.name}=${p.score}`).join(", "));
console.log("premi:", (final.awards || []).map((a) => a.title).join(", "));
console.log("durata:", Math.round((Date.now() - t0) / 1000) + "s");

// rigioca: torna in lobby
await A.click("text=Un'altra partita").catch(() => {});
await A.waitForFunction(() => window.__sagra.st.phase === "lobby", null, { timeout: 5000 }).catch(() => errors.push("ritorno in lobby fallito"));

console.log(errors.length ? "ERRORI:\n" + errors.join("\n") : "Nessun errore in console ✔");
await browser.close();
process.exit(final.phase === "final" && errors.length === 0 ? 0 : 1);
