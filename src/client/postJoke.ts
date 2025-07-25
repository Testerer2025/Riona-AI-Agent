import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

export async function postJoke(page: Page) {
  const joke = await generateJoke();
  logger.info("Neuer Witz: " + joke);

  // 1. Home – wir brauchen die Navigations‑Leiste
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  // 2. Auf das „+“-Icon (Neuer Beitrag) klicken
  const plusSelector =
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]';
  await page.waitForSelector(plusSelector, { timeout: 10000 });
  await page.click(plusSelector);

  // 3. Jetzt verstecktes <input type=file> finden
  //    – steht NICHT im dialog, sondern direkt im DOM:
  const fileInputSelector = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileInputSelector, { timeout: 10000 });

  const fileInput = await page.$(fileInputSelector);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");

  const imgPath = path.resolve("assets/brokkoli.jpg");     // dein Bild
  await fileInput.uploadFile(imgPath);

  // 4. Weiter‑Buttons (2‑mal): „Next“ / „Weiter“
  for (let i = 0; i < 2; i++) {
    const nextBtn = 'button:has-text("Next"), button:has-text("Weiter")';
    await page.waitForSelector(nextBtn, { timeout: 10000 });
    await page.click(nextBtn);
    await page.waitForTimeout(1000); // kleine Pause
  }

  // 5. Bild‑Caption einfügen
  const captionSel = 'textarea[aria-label*="caption"], textarea[placeholder*="Schreibe"]';
  await page.waitForSelector(captionSel, { timeout: 10000 });
  await page.type(captionSel, joke);

  // 6. Teilen / Share
  const shareBtn = 'button:has-text("Share"), button:has-text("Teilen")';
  await page.waitForSelector(shareBtn, { timeout: 10000 });
  await page.click(shareBtn);

  logger.info("Witz gepostet! 🎉");
}
