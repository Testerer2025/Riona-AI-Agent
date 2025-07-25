/*  src/client/postJoke.ts  */
import { Page } from "puppeteer";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

export async function postJoke(page: Page) {
  /* ░░ 0) Witz holen ░░ */
  const joke = await generateJoke();
  logger.info(`Neuer Witz: ${JSON.stringify(joke)}`);

  /* ░░ 1) Instagram‑Startseite ░░ */
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  /* ░░ 2) „+“‑Icon (Neuer Beitrag) ░░ */
  const plusSel =
    'svg[aria-label*="New post"],svg[aria-label*="Create"],svg[aria-label*="Neuer Beitrag"]';
  await page.waitForSelector(plusSel, { timeout: 10_000 });
  await page.click(plusSel);

  /* ░░ 3) Datei‑Input finden & Bild hochladen ░░ */
  const fileSel = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileSel, { timeout: 10_000 });
  const fileInput = await page.$(fileSel);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
  await fileInput.uploadFile(path.resolve("assets/brokkoli.jpg"));

  /* ░░ 4) Zweimal „Weiter/Next“ ░░ */
  const nextXPath =
    '//div[@role="dialog"]//*[self::button or self::div[@role="button"]][normalize-space()="Next" or normalize-space()="Weiter" or @aria-label="Next" or @aria-label="Weiter"]';

  for (let i = 0; i < 2; i++) {
    // auf das jeweils aktive Weiter‑Element warten
    await page.waitForSelector(`xpath/${nextXPath}`, { timeout: 20_000 });
    const [nextBtn] = await page.$x(nextXPath);
    if (!nextBtn) throw new Error('„Weiter/Next“‑Button nicht gefunden!');
    await nextBtn.click();
    await delay(1_000);
  }

  /* ░░ 5) Caption (Witz) einfügen ░░ */
  const captionSel =
    'textarea[aria-label*="caption"],textarea[placeholder*="Schreibe"]';
  await page.waitForSelector(captionSel, { timeout: 10_000 });
  await page.type(
    captionSel,
    Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string)
  );

  /* ░░ 6) „Teilen/Share“ ░░ */
  const shareXPath =
    '//div[@role="dialog"]//*[self::button or self::div[@role="button"]][normalize-space()="Share" or normalize-space()="Teilen" or @aria-label="Share" or @aria-label="Teilen"]';

  await page.waitForSelector(`xpath/${shareXPath}`, { timeout: 20_000 });
  const [shareBtn] = await page.$x(shareXPath);
  if (!shareBtn) throw new Error('„Share/Teilen“‑Button nicht gefunden!');
  await shareBtn.click();

  logger.info("Witz gepostet! 🎉");
}
