import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from "fs";

/* ---------- Helfer ---------- */

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Klickt „Weiter/Next“ – unverändert */
async function clickNextButton(page: Page, timeout = 20_000) {
  logger.info("Suche nach WEITER‑Button ...");
  const ok = await page.evaluate(
    () => {
      const wanted = ["weiter", "next", "continue"];
      const btn = [...document.querySelectorAll<HTMLElement>("button,div[role='button']")]
        .find(b => wanted.includes((b.innerText || "").trim().toLowerCase()) && !b.hasAttribute("disabled"));
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    { timeout }
  );
  if (!ok) throw new Error("WEITER‑Button nicht gefunden");
  logger.info("✅ WEITER‑Button geklickt");
}

/** Wartet auf *aktivierten* Share‑Button im Dialog und klickt ihn */
async function clickRealShare(page: Page, timeout = 60_000) {
  logger.info("Warte auf aktivierten SHARE‑Button ...");

  /* 1) Warten, bis Upload‑Progress verschwunden ist                            */
  /*    (manchmal ist erst dann der Button enabled)                             */
  try {
    await page.waitForFunction(
      () => !document.querySelector('div[role="progressbar"]'),
      { timeout }
    );
  } catch {
    logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
  }

  /* 2) Innerhalb des Dialogs nach dem richtigen Button suchen & klicken       */
  const clicked = await page.waitForFunction(
    () => {
      const dlg = document.querySelector("div[role='dialog']");
      if (!dlg) return false;

      const btn = [...dlg.querySelectorAll<HTMLElement>("button,div[role='button']")].find(b => {
        const text = (b.textContent || "").trim();
        const visible = b.offsetParent !== null;
        const enabled =
          !b.hasAttribute("disabled") &&
          !(b as HTMLButtonElement).disabled &&
          b.getAttribute("aria-disabled") !== "true";
        return (
          visible &&
          enabled &&
          (text === "Teilen" || text === "Share")
        );
      });

      if (btn) {
        btn.click();
        return true; // beendet waitForFunction
      }
      return false;
    },
    { timeout }
  );

  if (!clicked) throw new Error("Share‑Button nicht klickbar");

  logger.info("✅ Share‑Button geklickt, warte auf Dialog‑Verschwinden ...");

  /* 3) Bestätigung: Dialog verschwindet oder URL ändert sich                   */
  await Promise.race([
    page.waitForFunction(() => !document.querySelector("div[role='dialog']"), { timeout }),
    page.waitForNavigation({ timeout, waitUntil: "networkidle2" }), // bei Redirect in den Feed
  ]);

  logger.info("✅ Post wurde veröffentlicht (Dialog weg oder Navigation)");  
}

/** Caption suchen & füllen (dein Original mit minimalen Anpassungen) */
async function findAndFillCaption(page: Page, content: string) {
  logger.info(`Versuche Caption einzugeben ...`);
  const selectors = [
    'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"][aria-label*="caption"]',
    'div[contenteditable="true"]',
  ];

  for (const sel of selectors) {
    try {
      await page.waitForSelector(sel, { timeout: 3000, visible: true });
      const ok = await page.evaluate((s, txt) => {
        const el = document.querySelector<HTMLElement>(s);
        if (!el) return false;
        el.focus();
        el.click();
        el.innerHTML = `<p><span data-lexical-text="true">${txt}</span></p>`;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: txt }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, sel, content);

      if (ok) {
        logger.info(`✅ Caption gesetzt (Selektor: ${sel})`);
        return;
      }
    } catch {/* einfach nächster Selektor */}
  }
  throw new Error("Caption‑Feld nicht gefunden");
}

/** Placeholder‑Bild erzeugen, falls keines vorhanden */
async function ensureImageExists(): Promise<string> {
  const imagePath = path.resolve("assets/brokkoli.jpg");
  if (!fs.existsSync(imagePath)) {
    fs.mkdirSync(path.dirname(imagePath), { recursive: true });
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    fs.writeFileSync(imagePath, Buffer.from(b64, "base64"));
    logger.info("Placeholder‑Bild erstellt");
  }
  return imagePath;
}

/* ---------- Haupt‑Workflow ---------- */

export async function postJoke(page: Page) {
  logger.info("Starte Post‑Erstellung ...");

  /* 0) Witz & Bild vorbereiten */
  const joke = await generateJoke();
  const caption = Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string);
  const imagePath = await ensureImageExists();

  /* 1) Instagram‑Homepage */
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
  await delay(2000);

  /* 2) „+“-Icon (Beitrag erstellen) */
  const plusSelectors = [
    'svg[aria-label*="New post"]',
    'svg[aria-label*="Create"]',
    'svg[aria-label*="Neuer Beitrag"]',
  ];
  let clicked = false;
  for (const s of plusSelectors) {
    try {
      await page.waitForSelector(s, { timeout: 5000, visible: true });
      await page.click(s);
      clicked = true;
      break;
    } catch {/* weiter */}
  }
  if (!clicked) throw new Error("Plus‑Icon nicht gefunden");

  await delay(2000);

  /* 3) Bild hochladen */
  const fileInputSel = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileInputSel, { timeout: 15000 });
  const fileInput = await page.$(fileInputSel);
  if (!fileInput) throw new Error("Datei‑Input nicht gefunden");
  await fileInput.uploadFile(imagePath);
  await delay(3000);

  /* 4) Zwei‑mal Weiter */
  await clickNextButton(page);
  await delay(2000);
  await clickNextButton(page);
  await delay(2000);

  /* 5) Caption */
  await findAndFillCaption(page, caption);
  await delay(5000); // Instagram braucht Zeit

  /* 6) Teilen */
  await clickRealShare(page);      // <‑‑ neuer robuster Klick

  logger.info("🎉 Post‑Prozess abgeschlossen");
}
