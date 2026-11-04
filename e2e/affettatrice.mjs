// Test end-to-end dell'Affettatrice: si gioca davvero strisciando sul tagliere.
// Uso: node e2e/affettatrice.mjs [baseUrl]
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const BASE = process.argv[2] || "http://127.0.0.1:8787";
const SHOTS = new URL("./shots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch();
const errors = [];
const results = [];
const check = (n, ok) => (results.push(!!ok), console.log((ok ? "✔ " : "✘ ") + n));

async function play(label, opts) {
  const page = await (await browser.newContext(opts)).newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  await page.goto(BASE + "/affettatrice");
  await page.waitForSelector(".aff-logo");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS + `aff-${label}-menu.png` });
  await page.click("text=Affetta!");
  let shot = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 14_000) {
    const st = await page.evaluate(() => window.__aff.state);
    if (!st.running) break;
    // affetta il primo pezzo buono visibile e lontano dai petardi
    const target = st.items.find((i) => !i.bomb && i.y > 60 && i.y < (page.viewportSize().height - 40) && !st.items.some((b) => b.bomb && Math.hypot(b.x - i.x, b.y - i.y) < 150));
    if (target) {
      await page.mouse.move(target.x - 70, target.y - 20);
      await page.mouse.down();
      await page.mouse.move(target.x + 70, target.y + 20, { steps: 6 });
      await page.mouse.up();
      if (!shot && st.score >= 3) {
        shot = true;
        await page.screenshot({ path: SHOTS + `aff-${label}-play.png` });
      }
    }
    await page.waitForTimeout(40);
  }
  const mid = await page.evaluate(() => window.__aff.state);
  check(`${label}: si affetta davvero (punti ${mid.score})`, mid.score >= 3);
  await page.evaluate(() => window.__aff.gameOver());
  await page.waitForSelector(".aff-final", { timeout: 5000 });
  await page.fill('.aff-card input[aria-label="Il tuo nome"]', "Tester " + label);
  await page.click("text=Salva in classifica");
  await page.waitForSelector(`.aff-board li:has-text("Tester ${label}")`, { timeout: 5000 }).catch(() => {});
  check(`${label}: il punteggio entra in classifica`, await page.$(`.aff-board li:has-text("Tester ${label}")`));
  await page.screenshot({ path: SHOTS + `aff-${label}-over.png` });
  await page.click("text=Rigioca");
  check(`${label}: si può rigiocare`, (await page.evaluate(() => window.__aff.state)).running);
}

await play("desktop", { viewport: { width: 1280, height: 800 } });
await play("phone", { ...devices["Pixel 7"] });

const top = await (await fetch(BASE + "/api/affettatrice/top")).json();
check("API classifica risponde", top.today.length >= 1);
const cheat = await (await fetch(BASE + "/api/affettatrice/score", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Furbetto", score: 99999, ms: 5000 }) })).json();
check("punteggi impossibili rifiutati", cheat.ok === false);

console.log(errors.length ? "ERRORI:\n" + errors.join("\n") : "Nessun errore in console ✔");
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
