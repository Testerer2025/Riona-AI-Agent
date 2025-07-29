import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from 'fs';

// Normale delay Funktion
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Klickt im aktuell offenen Instagram‑Dialog das erste sichtbare
 *  Button‑Element, dessen Text ODER aria‑label eines der Suchwörter enthält.  */
async function clickDialogButton(
  page: Page,
  candidates: string[],
  timeout = 20_000
) {
  try {
    const ok = await page.waitForFunction(
      (texts) => {
        const dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
        if (!dialog) return false;
        const btn = [...dialog.querySelectorAll<HTMLElement>('button,div[role="button"]')]
          .find(
            (b) =>
              texts.some((t) =>
                (b.innerText || "").trim().toLowerCase().includes(t) ||
                (b.getAttribute("aria-label") || "").toLowerCase().includes(t)
              ) && !b.hasAttribute("disabled")
          );
        if (btn) {
          (btn as HTMLElement).click();
          return true;
        }
        return false;
      },
      { timeout },
      candidates.map((t) => t.toLowerCase())
    );

    if (!ok) throw new Error(`Button ${candidates.join("/")} nicht gefunden`);
  } catch (error) {
    logger.error(`Fehler beim Klicken des Dialog-Buttons: ${error}`);
    throw error;
  }
}

// ROBUSTE Caption-Eingabe mit mehreren Methoden
async function findAndFillCaption(page: Page, content: string): Promise<void> {
  logger.info(`Versuche Caption einzugeben: "${content.substring(0, 100)}..."`);
  
  const captionSelectors = [
    'div[contenteditable="true"][aria-label*="caption"]',
    'textarea[aria-label*="caption"]',
    'textarea[aria-label*="Bildunterschrift"]', 
    'textarea[placeholder*="Schreibe"]',
    'textarea[placeholder*="Write a caption"]',
    'div[contenteditable="true"]',
    'textarea'
  ];

  let captionFilled = false;

  for (const selector of captionSelectors) {
    try {
      logger.info(`Versuche Caption-Selektor: ${selector}`);
      
      await page.waitForSelector(selector, { timeout: 3000, visible: true });
      
      // Methode 1: JavaScript-based (wie bei React-Apps nötig)
      const jsSuccess = await page.evaluate((sel, text) => {
        const element = document.querySelector(sel) as HTMLElement;
        if (!element) return false;
        
        // Fokus setzen
        element.focus();
        element.click();
        
        // Text setzen je nach Element-Typ
        if (element.tagName === 'TEXTAREA') {
          const textarea = element as HTMLTextAreaElement;
          textarea.value = text;
          
          // React Events triggern
          const nativeTextAreaSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
          if (nativeTextAreaSetter) {
            nativeTextAreaSetter.call(textarea, text);
          }
        } else if (element.contentEditable === 'true') {
          element.innerText = text;
        }
        
        // Events feuern
        element.dispatchEvent(new Event('focus', { bubbles: true }));
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.dispatchEvent(new Event('blur', { bubbles: true }));
        
        return true;
      }, selector, content);
      
      if (jsSuccess) {
        logger.info(`JavaScript-Methode erfolgreich für: ${selector}`);
        
        // Zusätzlich: Puppeteer type() als Backup
        try {
          const captionElement = await page.$(selector);
          if (captionElement) {
            await captionElement.focus();
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await delay(300);
            await captionElement.type(content, { delay: 50 });
            logger.info("Zusätzlich: Puppeteer type() ausgeführt");
          }
        } catch (e) {
          logger.warn("Puppeteer type() fehlgeschlagen, aber JavaScript-Methode sollte funktioniert haben");
        }
        
        captionFilled = true;
        
        // Prüfe was wirklich im Feld steht
        await delay(500);
        const actualText = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return "ELEMENT_NOT_FOUND";
          if (el.tagName === 'TEXTAREA') {
            return (el as HTMLTextAreaElement).value;
          } else if ((el as HTMLElement).contentEditable === 'true') {
            return (el as HTMLElement).innerText;
          }
          return "UNKNOWN_TYPE";
        }, selector);
        
        logger.info(`FINAL: Text im Feld: "${actualText}"`);
        break;
      }
      
    } catch (error) {
      logger.debug(`Selektor ${selector} nicht gefunden`);
      continue;
    }
  }

  if (!captionFilled) {
    throw new Error("Caption-Feld konnte nicht gefunden werden");
  }
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
        await clickDialogButton(page, ["next", "weiter", "continue", "fortfahren"]);
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

    // DEBUG: Screenshot VOR dem Teilen - immer in ./debug für GitHub
    const screenshotDir = './debug';
    
    // Erstelle Debug-Ordner falls nicht vorhanden
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    
    const screenshotPath = `${screenshotDir}/caption_debug_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath });
    logger.info(`Debug-Screenshot vor Teilen erstellt: ${screenshotPath}`);

    /* ░░ 6) „Teilen/Share" ░░ */
    try {
      logger.info("Versuche Post zu teilen...");
      await clickDialogButton(page, ["share", "teilen", "post", "veröffentlichen"]);
      
      // Warten auf Bestätigung
      await delay(5000);
      
      // Prüfen ob Post erfolgreich war
      try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 3000, hidden: true });
        logger.info("Post erfolgreich geteilt! 🎉");
      } catch (e) {
        // Dialog noch da, könnte aber trotzdem erfolgreich sein
        logger.info("Post wahrscheinlich erfolgreich geteilt");
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
