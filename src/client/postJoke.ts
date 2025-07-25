import { Page } from "puppeteer";
import path from "path";
import { setTimeout as delay } from "timers/promises";      // Ersatz für page.waitForTimeout
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

export async function postJoke(page: Page) {
  /* 0) Witz holen */
  const joke = await generateJoke();                       // → string ODER [{ witz: string }]
  logger.info(`Neuer Witz: ${JSON.stringify(joke)}`);

  /* 1) Startseite */
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  /* 2) „+“‑Icon (Neuer Beitrag) */
  const plusSel =
    'svg[aria-label*="New post"],svg[aria-label*="Create"],svg[aria-label*="Neuer Beitrag"]';
  await page.waitForSelector(plusSel, { timeout: 10_000 });
  await page.click(plusSel);

  /* 3) verstecktes <input type=file> und Bild hochladen */
  const fileSel = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileSel, { timeout: 10_000 });
  const fileInput = await page.$(fileSel);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
  await fileInput.uploadFile(path.resolve("assets/brokkoli.jpg"));

  /* 4) zweimal „Weiter“ / „Next“ */
  const nextSel = 'button:has-text("Next"),button:has-text("Weiter")';
  for (let i = 0; i < 2; i++) {
    await page.waitForSelector(nextSel, { timeout: 10_000 });
    await page.click(nextSel);
    await delay(1_000);
  }

  /* 5) Caption‑Textbox – erst Dialog sicher da, dann mehrsprachige Varianten */
  await page.waitForSelector('div[role="dialog"]', { timeout: 15_000 });

  const captionSel = [
    'div[role="dialog"] textarea[aria-label*="caption"]',
    'div[role="dialog"] textarea[placeholder*="Schreibe"]',
    'div[role="dialog"] textarea[placeholder*="Beschriftung"]'
  ].join(',');

  await page.waitForSelector(captionSel, { timeout: 15_000 });
  const textarea = await page.$(captionSel);
  if (!textarea) throw new Error("Keine Caption‑Textbox gefunden");
  await textarea.type(Array.isArray(joke) ? joke[0]?.witz ?? "" : joke);

  /* 6) „Teilen“ / „Share“ */
  const shareSel = 'button:has-text("Share"),button:has-text("Teilen")';
  await page.waitForSelector(shareSel, { timeout: 10_000 });
  await page.click(shareSel);

  logger.info("Witz gepostet! 🎉");
}
