// Test end-to-end di "Pigna trova il fazzoletto": si giocano alcuni livelli veri.
// Uso: node e2e/pigna.mjs [baseUrl]
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

async function run(label, opts, mode) {
  const page = await (await browser.newContext(opts)).newPage();
  page.on("pageerror", (e) => errors.push(`[${label}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${label}] ${m.text()}`));
  await page.goto(BASE + "/pigna");
  await page.waitForSelector(".aff-logo");
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOTS + `pigna-${label}-menu.png` });
  await page.click("text=Cerca, Pigna!");
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOTS + `pigna-${label}-level1.png` });

  const st0 = await page.evaluate(() => window.__pigna.state);
  // prova i comandi: un tocco su una casella libera fa camminare Pigna
  if (mode === "tap") {
    const box = await page.locator("#pgBoard").boundingBox();
    const cols = await page.evaluate(() => document.querySelector("#pgBoard").width / devicePixelRatio);
    void cols;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(900);
  } else {
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(300);
  }
  const st1 = await page.evaluate(() => window.__pigna.state);
  check(`${label}: Pigna si muove (${mode})`, st1.dog.x !== st0.dog.x || st1.dog.y !== st0.dog.y);

  // usa l'aiutino una volta
  await page.click("#btnBark");
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + `pigna-${label}-bark.png` });

  // completa 3 livelli andando dritto al fazzoletto (passando prima da un nascondiglio sbagliato)
  for (let lvl = 1; lvl <= 3; lvl++) {
    const st = await page.evaluate(() => window.__pigna.state);
    const wrong = st.spots.find(([x, y]) => x !== st.target[0] || y !== st.target[1]);
    if (lvl === 1 && wrong) {
      await page.evaluate(([x, y]) => window.__pigna.goTo(x, y), wrong);
      await page.waitForFunction(([x, y]) => window.__pigna.state.dog.x === x && window.__pigna.state.dog.y === y, wrong, { timeout: 15000 });
      await page.waitForTimeout(900);
    }
    // annusare un nascondiglio o incontrare il gatto ferma Pigna: le ridiamo l'ordine finché non arriva
    for (let i = 0; i < 25 && !(await page.$("text=Trovato!")); i++) {
      await page.evaluate(([x, y]) => window.__pigna.goTo(x, y), st.target);
      await page.waitForTimeout(1200);
    }
    await page.waitForSelector("text=Trovato!", { timeout: 5000 }).catch(() => {});
    const ok = await page.$("text=Trovato!");
    check(`${label}: livello ${lvl} completato`, ok);
    if (lvl === 1) await page.screenshot({ path: SHOTS + `pigna-${label}-found.png` });
    if (!ok) break;
    await page.click("text=Avanti, livello");
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: SHOTS + `pigna-${label}-level4.png` });
  const st = await page.evaluate(() => window.__pigna.state);
  check(`${label}: punteggio che cresce (${st.score}) e livello 4`, st.score > 400 && st.level === 4);
  await page.evaluate(() => window.__pigna.gameOver());
  await page.waitForSelector(".aff-final");
  await page.fill('.aff-card input[aria-label="Il tuo nome"]', "Pigna fan " + label);
  await page.click("text=Salva in classifica");
  await page.waitForSelector(`.aff-board li:has-text("Pigna fan ${label}")`, { timeout: 5000 }).catch(() => {});
  check(`${label}: classifica di Pigna`, await page.$(`.aff-board li:has-text("Pigna fan ${label}")`));
  await page.screenshot({ path: SHOTS + `pigna-${label}-over.png` });
}

await run("desktop", { viewport: { width: 1280, height: 860 } }, "keys");
await run("phone", { ...devices["iPhone 13"] }, "tap");

const top = await (await fetch(BASE + "/api/pigna/top")).json();
const aff = await (await fetch(BASE + "/api/affettatrice/top")).json();
check("classifiche separate per i due giochi", top.today.every((e) => !aff.today.some((a) => a.name === e.name)));
const bogus = await fetch(BASE + "/api/inesistente/top");
check("giochi sconosciuti non hanno classifica", bogus.status !== 200 || !(await bogus.text()).includes('"all"'));

console.log(errors.length ? "ERRORI:\n" + errors.join("\n") : "Nessun errore in console ✔");
await browser.close();
process.exit(results.every(Boolean) && !errors.length ? 0 : 1);
