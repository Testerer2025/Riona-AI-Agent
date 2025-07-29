import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from "fs";

/* ---------------------------------- Utils --------------------------------- */
const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/* ------------------------------ NEXT‑Button ------------------------------- */
async function clickNextButton(page: Page) {
  logger.info("Suche nach WEITER‑Button…");

  const ok = await page.waitForFunction(
    () => {
      const labels = ["weiter", "next", "continue"];
      const btn = [...document.querySelectorAll<HTMLElement>("button, div[role='button']")]
        .find(b => labels.includes((b.innerText || "").trim().toLowerCase()) && !b.hasAttribute("disabled"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    { timeout: 20_000 }
  );

  if (!ok) throw new Error("WEITER‑Button nicht gefunden");
  logger.info("✅ WEITER‑Button geklickt");
}

/* ----------------------------- SHARE‑Button ------------------------------- */
async function clickRealShare(page: Page) {
  logger.info("Warte auf aktivierten SHARE‑Button…");

  // 1) Warten bis Upload‑Spinner verschwunden ist
  try {
    await page.waitForFunction(() => !document.querySelector('div[role="progressbar"]'), { timeout: 60_000 });
  } catch {
    logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
  }

  // 2) Button suchen & klicken
  const clicked = await page.waitForFunction(
    () => {
      const dlg = document.querySelector('div[role="dialog"]');
      if (!dlg) return false;

      const btn = [...dlg.querySelectorAll<HTMLElement>('button, div[role="button"]')].find(b => {
        const text = (b.textContent || '').trim();
        const visible = b.offsetParent !== null;
        const enabled = !b.hasAttribute('disabled') && !(b as HTMLButtonElement).disabled && b.getAttribute('aria-disabled') !== 'true';
        return visible && enabled && (text === 'Teilen' || text === 'Share');
      });

      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    { timeout: 60_000 }
  );

  if (!clicked) throw new Error('Share‑Button nicht klickbar');
  logger.info('✅ Share‑Button geklickt, warte auf Dialog‑Verschwinden…');

  // 3) Bestätigung
  await Promise.race([
    page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 60_000 }),
    page.waitForNavigation({ timeout: 60_000, waitUntil: 'networkidle2' }),
  ]);

  logger.info('✅ Post vermutlich veröffentlicht.');
}

/* ------------------------- Caption in Editor tippen ----------------------- */
async function findAndFillCaption(page: Page, text: string) {
  logger.info(`Versuche Caption einzugeben…`);

  const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
  await page.waitForSelector(sel, { timeout: 10_000, visible: true });
  const handle = await page.$(sel);
  if (!handle) throw new Error('Caption‑Feld nicht gefunden');

  // Inhalt löschen & tippen
  await handle.click({ clickCount: 1 });
  await page.keyboard.down('Control');
  await page.keyboard.press('A');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.type(sel, text, { delay: 25 });
  await delay(500);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await delay(300);

  const check = await page.evaluate(s => {
    const el = document.querySelector<HTMLElement>(s);
    return el?.innerText || '';
  }, sel);
  logger.info(`Caption‑Länge nach Eingabe: ${check.length}`);
}

/* ----------------------- Fallback‑Bild sicherstellen ---------------------- */
async function ensureImageExists(): Promise<string> {
  const img = path.resolve('assets/brokkoli.jpg');
  if (!fs.existsSync(img)) {
    fs.mkdirSync(path.dirname(img), { recursive: true });
    const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    fs.writeFileSync(img, Buffer.from(b64, 'base64'));
    logger.info('Placeholder‑Bild erstellt');
  }
  return img;
}

/* ------------------------------ Hauptexport ------------------------------- */
export async function postJoke(page: Page) {
  try {
    logger.info('Starte Post‑Erstellung…');

    // 0) Witz + Bild
    const joke = await generateJoke();
    const caption = Array.isArray(joke) ? joke[0]?.witz ?? '' : (joke as string);
    const imagePath = await ensureImageExists();
    logger.info(`Caption‑Text (95 Zeichen): "${caption.slice(0, 95)}"`);

    // 1) Instagram‑Home
    await page.goto('https://www.instagram.com/', { waitUntil: 'networkidle2' });
    await delay(2000);

    // 2) Plus‑Icon
    const plusSelectors = [
      'svg[aria-label*="New post"]',
      'svg[aria-label*="Create"]',
      'svg[aria-label*="Neuer Beitrag"]',
    ];
    let opened = false;
    for (const s of plusSelectors) {
      try {
        await page.waitForSelector(s, { timeout: 4000, visible: true });
        await page.click(s);
        opened = true;
        break;
      } catch { /* nächster */ }
    }
    if (!opened) throw new Error('Plus‑Icon nicht gefunden');
    await delay(2000);

    // 3) Bild hochladen
    const fileSel = 'input[type="file"][accept*="image"]';
    await page.waitForSelector(fileSel, { timeout: 15_000 });
    await (await page.$(fileSel))?.uploadFile(imagePath);
    logger.info('Bild hochgeladen');
    await delay(3000);

    // 4) Weiter‑Buttons
    for (let i = 0; i < 2; i++) {
      logger.info(`WEITER‑Schritt ${i + 1}`);
      await clickNextButton(page);
      await delay(2000);
    }

    // 5) Caption
    await findAndFillCaption(page, caption);
    logger.info('Warte 5 s, damit Instagram Caption übernimmt…');
    await delay(5000);

    // 6) Teilen
    await clickRealShare(page);

    logger.info('🎉 Post‑Prozess abgeschlossen');
  } catch (err) {
    logger.error(`Post‑Fehler: ${err}`);
    try {
      fs.mkdirSync('./debug', { recursive: true });
      const shot = `./debug/error_${Date.now()}.png`;
      await page.screenshot({ path: shot });
      logger.info(`Screenshot gespeichert: ${shot}`);
    } catch {/* Screenshot‑Fehler ignorieren */}
    throw err;
  }
}
