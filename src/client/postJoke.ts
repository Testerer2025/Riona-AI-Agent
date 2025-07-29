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
    logger.info(`Suche nach Button mit Texten: ${candidates.join(', ')}`);
    
    // Methode 1: Suche nach spezifischem Share-Button (aus deinem HTML)
    const shareButtonClicked = await page.evaluate(() => {
      // Suche nach dem spezifischen "Teilen" Button aus deinem HTML
      const shareButtons = document.querySelectorAll('div[role="button"]');
      for (const btn of shareButtons) {
        const text = btn.textContent?.trim();
        if (text === 'Teilen' || text === 'Share') {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    });
    
    if (shareButtonClicked) {
      logger.info("✅ Share-Button über spezifische Suche gefunden und geklickt");
      return;
    }
    
    // Methode 2: Fallback - ursprüngliche Methode
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
    logger.info("✅ Share-Button über Fallback-Methode gefunden");
    
  } catch (error) {
    logger.error(`Fehler beim Klicken des Dialog-Buttons: ${error}`);
    
    // Debug: Zeige alle verfügbaren Buttons
    const availableButtons = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button, div[role="button"]');
      return Array.from(buttons).map(btn => ({
        text: btn.textContent?.trim(),
        ariaLabel: btn.getAttribute('aria-label'),
        disabled: btn.hasAttribute('disabled')
      })).slice(0, 10); // Nur erste 10 zur Übersicht
    });
    
    logger.info(`Verfügbare Buttons: ${JSON.stringify(availableButtons)}`);
    throw error;
  }
}

// GENAUER Debug: Zeige alle möglichen Caption-Felder
async function findAndFillCaption(page: Page, content: string): Promise<void> {
  logger.info(`Versuche Caption einzugeben: "${content.substring(0, 100)}..."`);
  
  // Erst mal: Zeige ALLE möglichen Caption-Felder
  const allCaptionFields = await page.evaluate(() => {
    const fields = [
      ...document.querySelectorAll('div[contenteditable="true"]'),
      ...document.querySelectorAll('textarea'),
      ...document.querySelectorAll('div[role="textbox"]')
    ];
    
    return fields.map((field, index) => ({
      index,
      tagName: field.tagName,
      ariaLabel: field.getAttribute('aria-label'),
      placeholder: field.getAttribute('placeholder'),
      textContent: field.textContent?.substring(0, 50),
      classes: field.className.substring(0, 100),
      isVisible: (field as HTMLElement).offsetParent !== null,
      hasDataLexical: field.hasAttribute('data-lexical-editor')
    }));
  });
  
  logger.info(`ALLE GEFUNDENEN FELDER: ${JSON.stringify(allCaptionFields, null, 2)}`);
  
  // Spezifische Selektoren für Instagram's Lexical Editor
  const captionSelectors = [
    'div[aria-label="Bildunterschrift verfassen …"][data-lexical-editor="true"]',
    'div[aria-label*="Bildunterschrift"][contenteditable="true"][data-lexical-editor="true"]',
    'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]',
    'div[aria-label*="Bildunterschrift"][contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"]'
  ];

  let captionFilled = false;

  for (const selector of captionSelectors) {
    try {
      logger.info(`Versuche Caption-Selektor: ${selector}`);
      
      await page.waitForSelector(selector, { timeout: 3000, visible: true });
      
      // Prüfe welches Element genau gefunden wurde
      const elementInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        if (!el) return null;
        
        return {
          ariaLabel: el.getAttribute('aria-label'),
          textContent: el.textContent,
          innerHTML: el.innerHTML.substring(0, 200),
          hasDataLexical: el.hasAttribute('data-lexical-editor'),
          isVisible: el.offsetParent !== null,
          boundingRect: el.getBoundingClientRect()
        };
      }, selector);
      
      logger.info(`GEFUNDEN: ${JSON.stringify(elementInfo)}`);
      
      // Nur fortfahren wenn es das richtige Feld ist
      if (!elementInfo?.ariaLabel?.includes('Bildunterschrift') && 
          !elementInfo?.ariaLabel?.includes('caption')) {
        logger.warn(`ÜBERSPRINGE - Nicht das Caption-Feld: ${elementInfo?.ariaLabel}`);
        continue;
      }
      
      // Instagram Lexical Editor - NUR JavaScript, KEIN Puppeteer
      const success = await page.evaluate((sel, text) => {
        const element = document.querySelector(sel) as HTMLElement;
        if (!element) return false;
        
        // 1. Fokus setzen
        element.focus();
        element.click();
        
        // 2. Lexical Editor: Setze innerHTML UND innerText
        element.innerHTML = `<p class="xdj266r x14z9mp xat24cr x1lziwak" dir="ltr"><span data-lexical-text="true">${text}</span></p>`;
        element.innerText = text;
        
        // 3. Alle Events für React/Lexical
        const events = [
          new Event('focus', { bubbles: true }),
          new Event('input', { bubbles: true, composed: true }),
          new Event('change', { bubbles: true }),
          new InputEvent('input', { data: text, bubbles: true, composed: true }),
          new Event('blur', { bubbles: true })
        ];
        
        events.forEach(event => element.dispatchEvent(event));
        
        return true;
      }, selector, content);
      
      if (success) {
        logger.info(`✅ Caption eingegeben in das RICHTIGE Feld: ${selector}`);
        captionFilled = true;
        
        // Debug: Was steht nach der Eingabe wirklich im Feld?
        await delay(1000);
        const finalCheck = await page.evaluate((sel) => {
          const el = document.querySelector(sel) as HTMLElement;
          if (!el) return { status: "ELEMENT_NOT_FOUND", innerHTML: "", innerText: "", textContent: "" };
          
          return {
            status: "SUCCESS",
            innerHTML: el.innerHTML,
            innerText: el.innerText,
            textContent: el.textContent || ""
          };
        }, selector);
        
        logger.info(`FINAL CHECK - innerHTML: "${finalCheck.innerHTML}"`);
        logger.info(`FINAL CHECK - innerText: "${finalCheck.innerText}"`);
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
      
      await clickDialogButton(page, ["share", "teilen", "post", "veröffentlichen"]);
      
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
