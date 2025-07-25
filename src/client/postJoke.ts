import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

/** Pause-Helfer (ersetzt Page.waitForTimeout, das in älteren Puppeteer‑Typings fehlt) */
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Klickt den **ersten** Button, dessen InnerText einen der übergebenen Suchbegriffe enthält.
 * Alle Vergleiche laufen case‑insensitiv.
 */
async function clickFirstButton(
  page: Page,
  labels: string[],
  timeout = 10_000
) {
  const lower = labels.map(t => t.toLowerCase());

  // Warten, bis irgendein passender Button auftaucht …
  await page.waitForFunction(
    (lbls: string[]) => {
      return [...document.querySelectorAll("button")].some(btn => {
        const txt = btn.innerText.trim().toLowerCase();
        return lbls.some(l => txt.includes(l));
      });
    },
    { timeout },
    lower
  );

  // …und dann klicken.
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const txt: string = (await page.evaluate(el => el.innerText, btn)).trim().toLowerCase();
    if (lower.some(l => txt.includes(l))) {
      await btn.click();
      return;
    }
  }
  throw new Error(`Kein Button mit Labeln ${labels.join(", ")} gefunden`);
}

export async function postJoke(page: Page) {
  const joke = await generateJoke();
  logger.info("Neuer Witz: " + joke);

  // 1️⃣  Startseite öffnen
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  // 2️⃣  Auf das „+“‑Icon klicken
  const plusSelector =
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]';
  await page.waitForSelector(plusSelector, { timeout: 10_000 });
  const plus = await page.$(plusSelector);
  if (!plus) throw new Error("Kein '+'‑Icon gefunden");
  await plus.click();

  // 3️⃣  Verstecktes <input type="file"> finden und Bild hochladen
  const fileInputSelector = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileInputSelector, { timeout: 10_000 });
  const fileInput = await page.$(fileInputSelector);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
  const imgPath = path.resolve("assets/brokkoli.jpg");
  await fileInput.uploadFile(imgPath);

  // 4️⃣  Durch die zwei (manchmal drei) „Weiter“-Dialoge klicken
  for (let step = 0; step < 3; step++) {
    try {
      // Haupt‑Button „Weiter / Next / …“
      await clickFirstButton(page, [
        "weiter",
        "next",
        "avanti",
        "siguiente",
        "seguinte"
      ], 15_000);

      await sleep(800);

      // Sonderfall: Zuschnitt‑Dialog (Button „Originalgröße“ o. Ä.)
      const cropBtnXpath =
        "//button[contains(text(),'Original') or contains(text(),'Originalgröße')]";
      const [cropBtn] = await page.$x(cropBtnXpath);
      if (cropBtn) {
        await cropBtn.click();
        await sleep(500);
      }

      // Break, sobald das Caption‑Feld sichtbar ist
      if (await page.$('textarea[aria-label*="caption"], textarea[placeholder*="Schreibe"]')) {
        break;
      }
    } catch (err) {
      // Kein weiterer Dialog mehr vorhanden
      logger.debug("Dialog-Schleife beendet: " + err);
      break;
    }
  }

  // 5️⃣  Caption/Witz eintragen
  const captionSel =
    'textarea[aria-label*="caption"], textarea[placeholder*="Schreibe"]';
  await page.waitForSelector(captionSel, { timeout: 15_000 });
  await page.type(captionSel, joke);

  // 6️⃣  „Teilen / Share“ klicken
  await clickFirstButton(page, ["teilen", "share", "posten", "publizieren"], 15_000);

  // 7️⃣  Warten, bis Upload fertig und wir zurück auf der Startseite sind
  await page
    .waitForNavigation({ waitUntil: "networkidle2", timeout: 30_000 })
    .catch(() => {});

  logger.info("Witz gepostet! 🎉");
}
