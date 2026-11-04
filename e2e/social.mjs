// Test end-to-end delle funzioni "social": Piazza nella home e chat della tavolata.
// Uso: avvia `npx wrangler dev` e poi `node e2e/social.mjs [baseUrl]`.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");

const BASE = process.argv[2] || "http://127.0.0.1:8787";
const SHOTS = new URL("./shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const checks = [];
const check = (name, ok) => {
  checks.push([name, !!ok]);
  console.log((ok ? "✔ " : "✘ ") + name);
};

async function open(label, opts) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  return page;
}

// Host apre una tavolata (pubblica di default)
const host = await open("host", { viewport: { width: 1280, height: 900 } });
await host.goto(BASE);
await host.fill('input[aria-label="Il tuo nome"]', "Luca");
await host.click("text=Apparecchia una nuova tavolata");
await host.waitForSelector(".room-code-big");
const code = (await host.textContent(".room-code-big")).trim();

// Uno sconosciuto arriva in home e vede la tavolata nella Piazza
const visitor = await open("visitor", { ...devices["iPhone 13"] });
await visitor.goto(BASE);
await visitor.fill('input[aria-label="Il tuo nome"]', "Sara");
await visitor.waitForSelector(`.pz-room:has-text("${code}")`, { timeout: 8000 }).catch(() => {});
check("la tavolata pubblica compare nella Piazza", await visitor.$(`.pz-room:has-text("${code}")`));
check("contatore delle persone che giocano", /stanno giocando|sta giocando/.test(await visitor.textContent(".pz-stats")));

// Un terzo in home: chat della Piazza
const third = await open("third", { viewport: { width: 1280, height: 900 } });
await third.goto(BASE);
await third.fill('input[aria-label="Il tuo nome"]', "Marco");
await third.waitForTimeout(800);
await visitor.locator(".piazza .cb-input").fill("Qualcuno per una partita?");
await visitor.locator(".piazza .cb-input").press("Enter");
await third.waitForSelector('.piazza .cb-text:has-text("Qualcuno per una partita?")', { timeout: 5000 }).catch(() => {});
check("chat della Piazza tra due persone in home", await third.$('.piazza .cb-text:has-text("Qualcuno per una partita?")'));
await visitor.screenshot({ path: SHOTS + "social-01-piazza-phone.png", fullPage: true });
await third.locator(".piazza").scrollIntoViewIfNeeded();
await third.screenshot({ path: SHOTS + "social-02-piazza-desktop.png" });

// Sara si siede dalla Piazza
await visitor.click(`.pz-room:has-text("${code}") button`);
await visitor.waitForSelector(".players-grid");
check("sedersi dalla Piazza porta nella tavolata", (await visitor.evaluate(() => window.__sagra.code)) === code);

// Chat nella lobby
await host.locator(".lobby-chat .cb-input").fill("Benvenuta Sara! 🍷");
await host.locator(".lobby-chat .cb-input").press("Enter");
await visitor.waitForSelector('.lobby-chat .cb-text:has-text("Benvenuta Sara!")', { timeout: 5000 }).catch(() => {});
check("chat in lobby", await visitor.$('.lobby-chat .cb-text:has-text("Benvenuta Sara!")'));
await host.waitForTimeout(400);
await host.screenshot({ path: SHOTS + "social-03-lobby-chat.png" });

// L'host rende la tavolata privata → sparisce dalla Piazza
await host.click(".switch");
await third.waitForFunction((c) => !document.querySelector(`.pz-room .pz-code`)?.textContent.includes(c), code, { timeout: 6000 }).catch(() => {});
check("una tavolata privata sparisce dalla Piazza", !(await third.$(`.pz-room:has-text("${code}")`)));
await host.click(".switch");

// Chat durante il gioco: aggiunge un bot e parte con Pittore
await host.click("text=Aggiungi un cugino");
await host.waitForFunction(() => window.__sagra.st.players.length >= 3);
// seleziona solo il Pittore
// i bottoni si ridisegnano a ogni clic: li cerchiamo ogni volta
while (await host.locator(".gtoggle.on").count()) await host.locator(".gtoggle.on").first().click();
await host.click('.gtoggle:has-text("Pittore")');
await host.click("text=Si comincia!");
await host.waitForFunction(() => window.__sagra.st.phase === "intro");
await host.click('button:has-text("▶")');
await host.waitForFunction(() => window.__sagra.st.phase === "playing");

const pages = [host, visitor];
let drawer = null;
for (const p of pages) if (await p.evaluate(() => window.__sagra.st.game.isDrawer)) drawer = p;
const other = drawer === host ? visitor : host;
if (drawer) {
  await drawer.click(".choices button");
  await drawer.waitForFunction(() => window.__sagra.st.game.phase === "draw");
  const word = await drawer.evaluate(() => window.__sagra.st.game.word);
  // il disegnatore prova a spoilerare nella chat generale
  await drawer.click("#btnChat");
  await drawer.locator("#chatPanel .cb-input").fill(`è un ${word}!`);
  await drawer.locator("#chatPanel .cb-input").press("Enter");
  await drawer.waitForTimeout(800);
  await drawer.locator("#chatPanel .cb-input").fill("dai che è facile");
  await drawer.locator("#chatPanel .cb-input").press("Enter");
  await other.waitForSelector("#chatBadge:not(.hidden)", { timeout: 5000 }).catch(() => {});
  check("badge dei messaggi non letti durante il gioco", await other.$("#chatBadge:not(.hidden)"));
  await other.waitForTimeout(300);
  await other.screenshot({ path: SHOTS + "social-04-ingame-peek.png" });
  await other.click("#btnChat");
  await other.waitForTimeout(400);
  const texts = await other.$$eval("#chatPanel .cb-text", (els) => els.map((e) => e.textContent));
  check("la parola segreta non passa nella chat", !texts.some((t) => t.toLowerCase().includes(word.toLowerCase())));
  check("i messaggi normali passano durante il gioco", texts.includes("dai che è facile"));
  await other.screenshot({ path: SHOTS + "social-05-ingame-panel.png" });
} else {
  check("trovato chi disegna", false);
}

console.log(errors.length ? "ERRORI:\n" + errors.join("\n") : "Nessun errore in console ✔");
await browser.close();
process.exit(checks.every(([, ok]) => ok) && errors.length === 0 ? 0 : 1);
