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
    logger.info(`Neuer Post-Content generiert: ${joke.substring(0, 50)}...`);

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
      
      // Alternative: Navigation Menu
      try {
        await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const createLink = links.find(link => 
            link.getAttribute('aria-label')?.includes('Create') ||
            link.getAttribute('aria-label')?.includes('New post')
          );
          if (createLink) {
            (createLink as HTMLElement).click();
            return true;
          }
          return false;
        });
      } catch (e) {
        throw new Error("Konnte Create-Button nicht finden");
      }
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

    /* ░░ 5) Caption eingeben ░░ */
    try {
      const captionSelectors = [
        'textarea[aria-label*="caption"]',
        'textarea[aria-label*="Bildunterschrift"]',
        'textarea[placeholder*="Schreibe"]',
        'div[contenteditable="true"]' // Fallback
      ];

      let captionFound = false;
      for (const selector of captionSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: 5000, visible: true });
          await page.click(selector); // Fokus setzen
          await delay(500);
          await page.type(selector, joke, { delay: 50 }); // Langsamer tippen
          captionFound = true;
          logger.info("Caption erfolgreich eingegeben");
          break;
        } catch (e) {
          continue;
        }
      }

      if (!captionFound) {
        throw new Error("Caption-Feld nicht gefunden");
      }

    } catch (error) {
      logger.error("Fehler bei Caption-Eingabe:", error);
      throw error;
    }

    await delay(2000);

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
    
    // Screenshot für Debugging
    try {
      await page.screenshot({ path: `debug_post_error_${Date.now()}.png` });
      logger.info("Debug-Screenshot gespeichert");
    } catch (e) {
      // Screenshot fehlgeschlagen, ignorieren
    }
    
    throw error;
  }
}
