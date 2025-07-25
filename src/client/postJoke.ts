import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export async function postJoke(page: Page) {
  const joke = await generateJoke();
  logger.info("Neuer Witz: " + joke);

  await page.goto("https://www.instagram.com/");

  // „Neuen Beitrag“‑Button
  await page.waitForSelector(
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]'
  );
  await page.click(
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]'
  );

  // ►► Datei‑Chooser
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    page.click('div[role="dialog"] button, div[role="dialog"] div[role="button"]')
  ]);
  const imgPath = path.resolve("assets/brokkoli.jpg");
  await chooser.accept([imgPath]);

  // ►► Weiter
  await page.waitForSelector('button:has-text("Next"), button:has-text("Weiter")');
  await page.click('button:has-text("Next"), button:has-text("Weiter")');

  // ►► Caption einsetzen
  await page.waitForSelector('textarea[aria-label*="caption"]');
  await page.type('textarea[aria-label*="caption"]', joke);

  // ►► Teilen
  await page.click('button:has-text("Share"), button:has-text("Teilen")');
  logger.info("Witz gepostet!");

  // Kurze Pause, damit Instagram den Upload sicher verarbeitet
  await delay(5_000);
}
