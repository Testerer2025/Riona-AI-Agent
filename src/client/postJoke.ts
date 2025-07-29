import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from 'fs';

// Normale delay Funktion
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Klickt im aktuell offenen Instagram‑Dialog das erste sichtbare
 *  Button‑Element, dessen Text ODER aria‑label eines der Suchwörter enthält.  */
/** Klickt WEITER-Buttons (nicht Share!) */
async function clickNextButton(page: Page, timeout = 20_000) {
  try {
    logger.info(`Suche nach WEITER-Button...`);
    
    // Nur nach "Weiter/Next" suchen, NICHT nach Share/Teilen!
    const nextButtonClicked = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, div[role="button"]');
      for (const btn of buttons) {
        const text = btn.textContent?.trim().toLowerCase();
        if (text === 'weiter' || text === 'next' || text === 'continue') {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    
    if (nextButtonClicked) {
      logger.info("✅ WEITER-Button gefunden und geklickt");
      return;
    }
    
    // Fallback
    const ok = await page.waitForFunction(
      () => {
        const dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
        if (!dialog) return false;
        const btn = [...dialog.querySelectorAll<HTMLElement>('button,div[role="button"]')]
          .find(b => {
            const text = (b.innerText || "").trim().toLowerCase();
            return (text === 'weiter' || text === 'next' || text === 'continue') && 
                   !b.hasAttribute("disabled");
          });
        if (btn) {
          (btn as HTMLElement).click();
          return true;
        }
        return false;
      },
      { timeout }
    );

    if (!ok) throw new Error(`WEITER-Button nicht gefunden`);
    logger.info("✅ WEITER-Button über Fallback gefunden");
    
  } catch (error) {
    logger.error(`Fehler beim Klicken des WEITER-Buttons: ${error}`);
    throw error;
  }
}

/** Klickt SHARE-Button (nur beim finalen Teilen!) */
async function clickShareButton(page: Page): Promise<void> {
  logger.info("Warte auf aktivierten SHARE‑Button…");

  /* 1. Zuerst den Upload‑Spinner abwarten – sonst bleibt der Button disabled */
  try {
    await page.waitForFunction(() => !document.querySelector('div[role="progressbar"]'), { timeout: 60_000 });
  } catch {
    logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
  }

  /* 2. Innerhalb des Dialogs den sichtbaren, NICHT deaktivierten Button suchen */
  const clicked = await page.waitForFunction(
    () => {
      const dialog = document.querySelector('div[role="dialog"]');
      if (!dialog) return false;

      const btn = [...dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')].find(b => {
        const txt = (b.textContent || "").trim();
        const visible = b.offsetParent !== null;
        const enabled = !b.hasAttribute("disabled") &&
                        !(b as HTMLButtonElement).disabled &&
                        b.getAttribute("aria-disabled") !== "true";
        return visible && enabled && (txt === "Teilen" || txt === "Share");
      });

      if (btn) {
        btn.click();
        return true;
      }
      return false;
    },
    { timeout: 60_000 }
  );

  if (!clicked) throw new Error("Share‑Button nicht klickbar");
  logger.info("✅ Share‑Button geklickt, warte auf Dialog‑Verschwinden…");

  /* 3. Bestätigung: Dialog verschwindet oder Feed lädt neu */
  await Promise.race([
    page.waitForFunction(() => !document.querySelector('div[role="dialog"]'), { timeout: 60_000 }),
    page.waitForNavigation({ timeout: 60_000, waitUntil: "networkidle2" }),
  ]);

  logger.info("✅ Post veröffentlicht (Dialog weg oder Navigation)");
}




async function findAndFillCaption(page: Page, text: string): Promise<void> {
  logger.info(`Versuche Caption einzugeben: "${text.slice(0, 100)}…"`);
  
  // Instagram‑Lexical‑Editor (wie im Snippet: div[role="textbox"] … data-lexical-editor)
  const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
  await page.waitForSelector(sel, { timeout: 10_000, visible: true });
  const handle = await page.$(sel);
  if (!handle) throw new Error("Caption‑Feld nicht gefunden");

  // Inhalt löschen und echten Tippevorgang durchführen, damit React den State speichert
  await handle.click({ clickCount: 1 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(sel, text, { delay: 25 }); // erzeugt focus / input / change‑Events
  await delay(500);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await delay(300);

  // kleiner Log zum Gegencheck
  const current = await page.evaluate(s => document.querySelector<HTMLElement>(s)?.innerText || "", sel);
  logger.info(`Caption‑Länge nach Eingabe: ${current.length}`);
}






// Erstelle ein einfaches Placeholder-Bild falls keins existiert
async function ensureImageExists(): Promise<string> {
  const imagePath = path.resolve("assets/brokkoli.jpg");
  const assetsDir = path.dirname(imagePath);
  
  // Erstelle assets Verzeichnis falls es nicht existiert
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  // Prüfe ob Bild existiert
  if (!fs.existsSync(imagePath)) {
    logger.warn("Bild nicht gefunden, erstelle Placeholder...");
    
    // Erstelle ein einfaches 1x1 Pixel PNG als Fallback
    // Das ist ein base64-kodiertes 1x1 weißes PNG
    const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const buffer = Buffer.from(base64PNG, 'base64');
    fs.writeFileSync(imagePath, buffer);
    
    logger.info("Placeholder-Bild erstellt");
  }
  
  return imagePath;
}

export async function postJoke(page: Page) {
  try {
    logger.info("Starte Post-Erstellung...");

    /* ░░ 0) Witz holen ░░ */
    const joke = await generateJoke();
    logger.info(`Neuer Witz generiert: ${JSON.stringify(joke)}`);

    /* ░░ 0.1) Stelle sicher dass ein Bild existiert ░░ */
    const imagePath = await ensureImageExists();

    /* ░░ 1) Instagram‑Startseite ░░ */
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(2000);

    /* ░░ 2) „+"‑Icon finden und klicken ░░ */
    try {
      // Mehrere mögliche Selektoren für das Plus-Icon
      const plusSelectors = [
        'svg[aria-label*="New post"]',
        'svg[aria-label*="Create"]', 
        'svg[aria-label*="Neuer Beitrag"]',
        'svg[aria-label*="Beitrag erstellen"]',
        'a[href="#"] svg', // Fallback
        'div[role="menuitem"] svg' // Navigation
      ];

      let plusFound = false;
      for (const selector of plusSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000, visible: true });
          await page.click(selector);
          plusFound = true;
          logger.info(`Plus-Icon gefunden mit Selektor: ${selector}`);
          break;
        } catch (e) {
          continue;
        }
      }

      if (!plusFound) {
        throw new Error("Plus-Icon nicht gefunden");
      }

    } catch (error) {
      logger.error("Plus-Icon nicht gefunden, versuche Alternative...");
      throw error;
    }

    await delay(2000);

    /* ░░ 3) Datei‑Input ░░ */
    try {
      const fileSel = 'input[type="file"][accept*="image"]';
      await page.waitForSelector(fileSel, { timeout: 15_000 });
      const fileInput = await page.$(fileSel);
      if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
      
      await fileInput.uploadFile(imagePath);
      logger.info("Bild erfolgreich hochgeladen");
      await delay(3000); // Warten bis Upload verarbeitet ist
      
    } catch (error) {
      logger.error("Fehler beim Datei-Upload:", error);
      throw error;
    }

    /* ░░ 4) Zweimal „Weiter/Next" ░░ */
    try {
      for (let i = 0; i < 2; i++) {
        logger.info(`Klicke Weiter-Button ${i + 1}/2`);
        await clickNextButton(page); // Verwende die neue Funktion!
        await delay(2000);
      }
    } catch (error) {
      logger.error("Fehler bei Weiter-Buttons:", error);
      throw error;
    }

    /* ░░ 5) Caption - VOLLSTÄNDIGES DEBUG ░░ */
    logger.info("Beginne Caption-Eingabe...");
    const jokeContent = Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string);
    logger.info(`Vollständiger Caption-Text: "${jokeContent}"`); // DEBUG - zeigt ganzen Text
    
    await findAndFillCaption(page, jokeContent);
    
    // WICHTIG: Länger warten damit Instagram den Text erkennt
    logger.info("Warte 5 Sekunden damit Instagram Text verarbeitet...");
    await delay(5000);

    // Extra: Nochmal ins Caption-Feld klicken um sicherzustellen dass Text da ist
    try {
      await page.click('div[contenteditable="true"][aria-label*="caption"]');
      logger.info("Nochmal ins Caption-Feld geklickt zur Sicherheit");
      await delay(1000);
    } catch (e) {
      logger.info("Extra-Klick fehlgeschlagen, aber das ist ok");
    }

    // DEBUG: Screenshot - einfach ins Hauptverzeichnis
    const screenshotPath = `debug_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    logger.info(`Debug-Screenshot vor Teilen erstellt: ${screenshotPath}`);

    /* ░░ 6) „Teilen/Share" ░░ */
    try {
      logger.info("Versuche Post zu teilen...");
      
      // DEBUG: Prüfe vor dem Share-Klick nochmal das Caption-Feld
      const preShareCheck = await page.evaluate(() => {
        const captionEl = document.querySelector('div[role="textbox"][contenteditable="true"]') as HTMLElement;
        if (captionEl) {
          return {
            hasText: captionEl.innerText.length > 0,
            textLength: captionEl.innerText.length,
            textContent: captionEl.innerText.substring(0, 100)
          };
        }
        return { hasText: false, textLength: 0, textContent: "ELEMENT_NOT_FOUND" };
      });
      
      logger.info(`PRE-SHARE CHECK - Hat Text: ${preShareCheck.hasText}, Länge: ${preShareCheck.textLength}`);
      logger.info(`PRE-SHARE TEXT: "${preShareCheck.textContent}"`);
      
      await clickShareButton(page); // Verwende die neue Funktion!
      
      // Warten auf Bestätigung - LÄNGER warten
      logger.info("Warte 15 Sekunden auf Upload-Completion...");
      await delay(15000); // Länger warten für Upload
      
      // DEBUG: Nach dem Share - prüfe ob Dialog verschwunden oder Fehler aufgetreten
      const postShareStatus = await page.evaluate(() => {
        // Suche nach Dialogen
        const dialogs = document.querySelectorAll('div[role="dialog"]');
        const hasDialog = dialogs.length > 0;
        
        // Suche nach Error-Messages
        const errorMessages = document.querySelectorAll('[data-testid="error"], .error, [aria-live="polite"]');
        const errors = Array.from(errorMessages).map(el => el.textContent).filter(text => text && text.length > 0);
        
        // Suche nach Success-Indicators  
        const successIndicators = document.querySelectorAll('[data-testid="success"], .success');
        const hasSuccess = successIndicators.length > 0;
        
        return {
          hasDialog,
          dialogCount: dialogs.length,
          errors,
          hasSuccess,
          currentUrl: window.location.href
        };
      });
      
      logger.info(`POST-SHARE STATUS:`);
      logger.info(`- Dialoge noch da: ${postShareStatus.hasDialog} (${postShareStatus.dialogCount})`);
      logger.info(`- Fehler gefunden: ${JSON.stringify(postShareStatus.errors)}`);
      logger.info(`- Success-Indicator: ${postShareStatus.hasSuccess}`);
      logger.info(`- Current URL: ${postShareStatus.currentUrl}`);
      
      // Prüfen ob Post erfolgreich war
      try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 3000, hidden: true });
        logger.info("✅ Post erfolgreich geteilt - Dialog verschwunden!");
      } catch (e) {
        logger.warn("⚠️ Dialog noch sichtbar - Post möglicherweise nicht erfolgreich");
        
        // DEBUG: Was steht in den noch sichtbaren Dialogen?
        const dialogContent = await page.evaluate(() => {
          const dialogs = document.querySelectorAll('div[role="dialog"]');
          return Array.from(dialogs).map(dialog => ({
            text: dialog.textContent?.substring(0, 200),
            buttons: Array.from(dialog.querySelectorAll('button')).map(btn => btn.textContent)
          }));
        });
        
        logger.info(`Verbleibende Dialog-Inhalte: ${JSON.stringify(dialogContent)}`);
      }
      
    } catch (error) {
      logger.error("Fehler beim Teilen:", error);
      throw error;
    }

  } catch (error) {
    logger.error("Gesamter Post-Prozess fehlgeschlagen:", error);
    
    // Screenshot für Debugging - angepasst für GitHub/Render
    try {
      const screenshotDir = process.env.NODE_ENV === 'production' ? '/persistent' : './debug';
      const errorScreenshot = `${screenshotDir}/debug_post_error_${Date.now()}.png`;
      await page.screenshot({ path: errorScreenshot });
      logger.info(`Error-Screenshot gespeichert: ${errorScreenshot}`);
    } catch (e) {
      // Screenshot fehlgeschlagen, ignorieren
    }
    
    throw error;
  }
}
