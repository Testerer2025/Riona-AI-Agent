import { Page } from "puppeteer";
import path from "path";
import { setTimeout as delay } from "timers/promises";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

/** Klickt im aktuell offenen Instagram‑Dialog das erste sichtbare
 *  Button‑Element, dessen Text ODER aria‑label eines der Suchwörter enthält.  */
async function clickDialogButton(
  page: Page,
  candidates: string[],
  timeout = 20_000
) {
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
}

// Verbesserte Caption-Suche mit mehr Selektoren
async function findAndFillCaption(page: Page, content: string): Promise<void> {
  const captionSelectors = [
    // Häufigste Instagram Selektoren für Caption
    'textarea[aria-label*="caption"]',
    'textarea[aria-label*="Bildunterschrift"]',
    'textarea[placeholder*="Schreibe"]',
    'textarea[placeholder*="Write a caption"]',
    'div[contenteditable="true"][aria-label*="caption"]',
    'div[contenteditable="true"][data-testid*="caption"]',
    // Fallback Selektoren
    'textarea[data-testid="creation-detailed-post-composer-text-input"]',
    'div[contenteditable="true"]',
    'textarea',
    // Weitere mögliche Selektoren
    'div[role="textbox"]',
    'div[role="textbox"][contenteditable="true"]'
  ];

  let captionFilled = false;

  for (const selector of captionSelectors) {
    try {
      logger.info(`Versuche Caption-Selektor: ${selector}`);
      
      // Warte auf Element mit kürzerem Timeout pro Selektor
      await page.waitForSelector(selector, { timeout: 3000, visible: true });
      
      // Element gefunden - klicke und fülle aus
      await page.click(selector);
      await delay(500);
      
      // Lösche vorherigen Inhalt
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await delay(200);
      
      // Tippe den neuen Inhalt
      await page.type(selector, content, { delay: 50 });
      
      logger.info(`Caption erfolgreich eingegeben mit Selektor: ${selector}`);
      captionFilled = true;
      break;
      
    } catch (error) {
      // Dieser Selektor hat nicht funktioniert, versuche den nächsten
      logger.debug(`Selektor ${selector} nicht gefunden, versuche nächsten...`);
      continue;
    }
  }

  if (!captionFilled) {
    // Letzte Chance: Versuche über JavaScript
    try {
      logger.info("Versuche Caption über JavaScript zu setzen...");
      
      const result = await page.evaluate((text) => {
        // Suche nach allen möglichen Caption-Elementen
        const possibleElements = [
          ...document.querySelectorAll('textarea'),
          ...document.querySelectorAll('div[contenteditable="true"]'),
          ...document.querySelectorAll('div[role="textbox"]')
        ];
        
        for (const element of possibleElements) {
          const htmlEl = element as HTMLElement;
          
          // Prüfe ob es ein Caption-Feld sein könnte
          const ariaLabel = htmlEl.getAttribute('aria-label') || '';
          const placeholder = htmlEl.getAttribute('placeholder') || '';
          
          if (ariaLabel.toLowerCase().includes('caption') || 
              ariaLabel.toLowerCase().includes('bildunterschrift') ||
              placeholder.toLowerCase().includes('schreibe') ||
              placeholder.toLowerCase().includes('write')) {
            
            // Fokussiere das Element
            htmlEl.focus();
            
            // Setze den Wert
            if (htmlEl.tagName.toLowerCase() === 'textarea') {
              (htmlEl as HTMLTextAreaElement).value = text;
            } else {
              htmlEl.innerText = text;
            }
            
            // Trigger Events
            htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
            htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
            
            return true;
          }
        }
        return false;
      }, content);
      
      if (result) {
        logger.info("Caption erfolgreich über JavaScript gesetzt");
        captionFilled = true;
      }
      
    } catch (jsError) {
      logger.error("JavaScript Caption-Methode fehlgeschlagen:", jsError);
    }
  }

  if (!captionFilled) {
    throw new Error("Caption-Feld konnte mit keiner Methode gefunden werden");
  }
}

export async function postJoke(page: Page) {
  /* ░░ 0) Witz holen ░░ */
  const joke = await generateJoke();
  logger.info(`Neuer Witz: ${JSON.stringify(joke)}`);

  try {
    /* ░░ 1) Instagram‑Startseite ░░ */
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(2000);

    /* ░░ 2) „+"‑Icon ░░ */
    const plusSel =
      'svg[aria-label*="New post"],svg[aria-label*="Create"],svg[aria-label*="Neuer Beitrag"],svg[aria-label*="Beitrag erstellen"]';
    await page.waitForSelector(plusSel, { timeout: 20_000, visible: true });
    await page.click(plusSel);
    await delay(2000);

    /* ░░ 3) Datei‑Input ░░ */
    const fileSel = 'input[type="file"][accept*="image"]';
    await page.waitForSelector(fileSel, { timeout: 20_000 });
    const fileInput = await page.$(fileSel);
    if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
    await fileInput.uploadFile(path.resolve("assets/brokkoli.jpg"));
    await delay(3000); // Warten bis Bild verarbeitet ist

    /* ░░ 4) Zweimal „Weiter/Next" ░░ */
    for (let i = 0; i < 2; i++) {
      logger.info(`Klicke Weiter-Button ${i + 1}/2`);
      await clickDialogButton(page, ["next", "weiter"]);
      await delay(2000);
    }

    /* ░░ 5) Caption - VERBESSERTE VERSION ░░ */
    logger.info("Beginne Caption-Eingabe...");
    const jokeContent = Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string);
    await findAndFillCaption(page, jokeContent);
    await delay(2000);

    /* ░░ 6) „Teilen/Share" ░░ */
    logger.info("Versuche Post zu teilen...");
    await clickDialogButton(page, ["share", "teilen"]);

    logger.info("Witz gepostet! 🎉");
    
  } catch (error) {
    logger.error("Fehler beim Posten:", error);
    
    // Debug Screenshot
    try {
      await page.screenshot({ path: `debug_post_error_${Date.now()}.png` });
      logger.info("Debug-Screenshot erstellt");
    } catch (screenshotError) {
      // Ignoriere Screenshot-Fehler
    }
    
    throw error;
  }
}
