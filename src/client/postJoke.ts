import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from "fs";

/* -------------------------------------------------------------------------- */
/*                               Hilfsfunktionen                              */
/* -------------------------------------------------------------------------- */

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Klickt WEITER‑Button (unverändert, aber mit extra Log) */
async function clickNextButton(page: Page, timeout = 20_000) {
  logger.info("Suche nach WEITER‑Button...");
  const ok = await page.evaluate(() => {
    const wanted = ["weiter", "next", "continue"];
    const btn = [...document.querySelectorAll<HTMLElement>("button, div[role='button']")]
      .find(b => wanted.includes((b.innerText || "").trim().toLowerCase()) &&
                 !b.hasAttribute("disabled"));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!ok) throw new Error("WEITER‑Button nicht gefunden");
  logger.info("✅ WEITER‑Button geklickt");
}

/** Wartet auf aktivierten „Teilen/Share“‑Button (Snippet berücksichtigt) */
async function clickRealShare(page: Page, timeout = 60_000) {
  logger.info("Warte auf aktivierten SHARE‑Button...");

  /* 1) Erst warten, bis kein Upload‑Spinner mehr da ist */
  try {
    await page.waitForFunction(
      () => !document.querySelector('div[role="progressbar"]'),
      { timeout }
    );
  } catch {
    logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
  }

  /* 2) Im Dialog nach sichtbarem & aktiviertem Button „Teilen/Share“ suchen */
  const clicked = await page.waitForFunction(
    () => {
      const dlg = document.querySelector("div[role='dialog']");
      if (!dlg) return false;

      const btn = [...dlg.querySelectorAll<HTMLElement>("button, div[role='button']")].find(b => {
        const text   = (b.textContent || "").trim();
        const vis    = b.offsetParent !== null;
        const aktiv  = !b.hasAttribute("disabled") &&
                       !(b as HTMLButtonElement).disabled &&
                       b.getAttribute("aria-disabled") !== "true";
        return vis && aktiv && (text === "Teilen" || text === "Share");
      });

      if (btn) { btn.click(); return true; }
      return false;
    },
    { timeout }
  );

  if (!clicked) throw new Error("Share‑Button nicht klickbar");
  logger.info("✅ Share‑Button geklickt, warte auf Dialog‑Verschwinden...");

  /* 3) Bestätigung */
  await Promise.race([
    page.waitForFunction(() => !document.querySelector("div[role='dialog']"), { timeout }),
    page.waitForNavigation({ timeout, waitUntil: "networkidle2" }),
  ]);

  logger.info("✅ Post vermutlich veröffentlicht (Dialog weg / Navigation)");
}

/** Findet das Caption‑Feld, tippt den Text & loggt alles */
async function findAndFillCaption(page: Page, text: string) {
  logger.info(`Versuche Caption einzugeben: "${text.substring(0, 100)}..."`);

  /* --- Alle potenziellen Felder auflisten (Debug) --- */
  const allFields = await page.evaluate(() => {
    const els = [
      ...document.querySelectorAll('div[contenteditable="true"]'),
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('div[role="textbox"]')
    ];
    return els.map((el, i) => ({
      i,
      tag: el.tagName,
      aria: el.getAttribute("aria-label"),
      classes: el.className.slice(0, 120),
      visible: (el as HTMLElement).offsetParent !== null
    }));
  });
  logger.info(`ALLE FELDER: ${JSON.stringify(allFields, null, 2)}`);

  /* --- Eigentlichen Editor suchen (wie in deinem Snippet) --- */
  const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
  await page.waitForSelector(sel, { timeout: 5000, visible: true });
  const handle = await page.$(sel);
  if (!handle) throw new Error("Caption‑Feld nicht gefunden");

  /* --- Text eintippen (Keyboard‑Events) --- */
  await handle.click({ clickCount: 1 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(sel, text, { delay: 25 });   // tippen erzeugt echte Events
  await delay(500);                            // kurz verharren

  /* --- Blur, damit React State speichert --- */
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await delay(300);

  /* --- Kontrolle --- */
  const after = await page.evaluate(s => {
    const el = document.querySelector<HTMLElement>(s);
    return {
      innerText: el?.innerText,
      innerHTML: el?.innerHTML?.slice(0, 250)
    };
  }, sel);
  logger.info(`FINAL CHECK innerText (95 Zeichen): "${after.innerText?.slice(0, 95)}"`);
}

/** Placeholder‑Bild */
async function ensureImageExists(): Promise<string> {
  const imgPath = path.resolve("assets/brokkoli.jpg");
  if (!fs.existsSync(imgPath)) {
    fs.mkdirSync(path.dirname(imgPath), { recursive: true });
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
    logger.info("Placeholder‑Bild erstellt");
  }
  return imgPath;
}

/* -------------------------------------------------------------------------- */
/*                               Hauptfunktion                               */
/* -------------------------------------------------------------------------- */

export async function postJoke(page: Page) {
  try {
    logger.info("Starte Post‑Erstellung...");

    /* -- 0) Witz + Bild ---------------------------------------------------- */
    const joke       = await generateJoke();
    const captionTxt = Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string);
    logger.info(`Neuer Witz generiert: "${captionTxt}"`);
    const imgPath    = await ensureImageExists();

    /* -- 1) Instagram‑Home ------------------------------------------------- */
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(2000);

    /* -- 2) „+“‑Icon ------------------------------------------------------- */
    const plusSelectors = [
      'svg[aria-label*="New post"]',
      'svg[aria-label*="Create"]',
      'svg[aria-label*="Neuer Beitrag"]',
    ];
    for (const s of plusSelectors) {
      try { await page.waitForSelector(s, { timeout: 4000, visible: true }); await page.click(s); break; }
      catch {/* nächster */}
    }
    await delay(2000);

    /* -- 3) Bild hochladen ------------------------------------------------- */
    const fileSel  = 'input[type="file"][accept*="image"]';
    await page.waitForSelector(fileSel, { timeout: 15000 });
    await (await page.$(fileSel))?.uploadFile(imgPath);
    logger.info("Bild hochgeladen");
    await delay(3000);

    /* -- 4) Zwei‑mal WEITER ------------------------------------------------ */
    for (let i = 0; i < 2; i++) { logger.info(`WEITER (${i + 1}/2)`); await clickNextButton(page); await delay(2000); }

    /* -- 5) Caption -------------------------------------------------------- */
    await findAndFillCaption(page, captionTxt);
    logger.info("Warte 5 s, damit Instagram den Text verarbeitet...");
    await delay(5000);

    /* -- 6) Debug vor dem Teilen ------------------------------------------ */
    const preShare = await page.evaluate(() => {
      const cap = document.querySelector('div[role="textbox"][contenteditable="true"]');
      return {
        hasCaption: !!cap && cap.textContent?.trim().length! > 0,
        text: cap?.textContent?.slice(0, 100)
      };
    });
    logger.info(`PRE‑SHARE CHECK: ${JSON.stringify(preShare)}`);

    /* -- 7) Teilen --------------------------------------------------------- */
    await clickRealShare(page);

    /* -- 8) Abschluss‑Debug ------------------------------------------------ */
    logger.info("✅ Post‑Prozess abgeschlossen");

  } catch (err) {
    logger.error(`Post‑Fehler: ${err}`);
    try {
      const dir = process.env.NODE_ENV === "production" ? "/persistent" : "./debug";
      fs.mkdirSync(dir, { recursive: true });
      const pathShot = `${dir}/debug_post_error_${Date.now()}.png`;
      await page.screenshot({ path: pathShot });
      logger.info(`Error‑Screenshot gespeichert: ${pathShot}`);
    } catch {/* Screenshot‑Fehler ignorieren */}
    throw err;
  }
}
