import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

export async function postJoke(page: Page) {
  const joke = await generateJoke();
  logger.info("Neuer Witz: " + joke);

  await page.goto("https://www.instagram.com/");
  await page.waitForSelector('svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]');
  await page.click('svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]');

  // Bild hochladen
  const [chooser] = await Promise.all([
    page.waitForFileChooser(),
    page.click('div[role="dialog"] button, div[role="dialog"] div[role="button"]')
  ]);
  const imgPath = path.resolve("assets/brokkoli.jpg");
  await chooser.accept([imgPath]);

  // Weiter
  await page.waitForSelector('button:has-text("Next"), button:has-text("Weiter")');
  await page.click('button:has-text("Next"), button:has-text("Weiter")');

  // Caption
  await page.waitForSelector('textarea[aria-label*="caption"]');
  await page.type('textarea[aria-label*="caption"]', joke);

  // Teilen
  await page.click('button:has-text("Share"), button:has-text("Teilen")');
  logger.info("Witz gepostet!");
}
