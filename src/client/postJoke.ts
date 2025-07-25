import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

export async function postJoke(page: Page) {
  /* 1) Witz erzeugen */
  const joke = await generateJoke();
  if (!joke) {
    logger.warn("Joke leer – Posting übersprungen");
    return;
  }
  logger.info("Neuer Witz: " + joke);

  /* 2) Zur Startseite, Fonts laden, Viewport vergrößern */
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
  await page.evaluate(() => document.fonts.ready);

  /* 3) „Neuer Beitrag“‑Button finden */
  const newPostSelector =
    // alte aria‑Labels (EN/DE)
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"], ' +
    // Plus‑Icon ohne aria‑Label (2025‑Layout)
    'svg[width="24"][height="24"] path[d*="M12 5v14"][d*="M5 12h14"]';

  try {
    await page.waitForSelector(newPostSelector, { timeout: 60000 });
    await page.click(newPostSelector);
  } catch {
    logger.error("Neuer‑Post‑Button nicht gefunden – Posting übersprungen");
    return;
  }

  /* 4) Bild hochladen */
  const [chooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 30000 }),
    page.click('div[role="dialog"] button, div[role="dialog"] div[role="button"]'),
  ]);
  const imgPath = path.resolve("assets/brokkoli.jpg");
  await chooser.accept([imgPath]);

  /* 5) Weiter / Next */
  await page.waitForSelector('button:has-text("Next"), button:has-text("Weiter")', { timeout: 30000 });
  await page.click('button:has-text("Next"), button:has-text("Weiter")');

  /* 6) Caption setzen */
  await page.waitForSelector('textarea[aria-label*="caption"]', { timeout: 30000 });
  await page.type('textarea[aria-label*="caption"]', joke);

  /* 7) Teilen */
  await page.click('button:has-text("Share"), button:has-text("Teilen")');

  logger.info("Witz gepostet!");
}
