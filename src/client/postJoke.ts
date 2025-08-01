import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";
import fs from 'fs';
import mongoose from 'mongoose';
import crypto from 'crypto';

interface ImageCategory {
  keywords: string[];
  folder: string;
}

const imageCategories: ImageCategory[] = [
  {
    keywords: ['business', 'büro', 'meeting', 'arbeit', 'job', 'karriere', 'unternehmen', 'strategie', 'planung'],
    folder: 'business'
  },
  {
    keywords: ['social media', 'instagram', 'tiktok', 'facebook', 'linkedin', 'content', 'posting', 'community', 'engagement'],
    folder: 'social-media'
  },
  {
    keywords: ['analytics', 'daten', 'statistik', 'performance', 'roi', 'zahlen', 'auswertung', 'messung', 'kpi'],
    folder: 'analytics'
  },
  {
    keywords: ['technologie', 'tools', 'digital', 'innovation', 'ki', 'software', 'app', 'tech', 'computer'],
    folder: 'tech'
  },
  {
    keywords: ['team', 'agentur', 'zusammenarbeit', 'mitarbeiter', 'kollaboration', 'gruppe', 'workshop'],
    folder: 'team'
  },
  {
    keywords: ['marketing', 'werbung', 'kampagne', 'brand', 'marke', 'advertising', 'promotion'],
    folder: 'marketing'
  },
];

// MongoDB Schema für Posts
const PostSchema = new mongoose.Schema({
  content: { type: String, required: true },
  content_hash: { type: String, required: true, unique: true },
  image_name: { type: String, required: true },
  image_path: { type: String, required: true },
  posted_at: { type: Date, default: Date.now },
  post_type: { type: String, default: 'instagram_post' },
  success: { type: Boolean, default: true },
  similarity_score: { type: Number, default: 0 }
});

const Post = mongoose.model('Post', PostSchema);

// Normale delay Funktion
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Text-Ähnlichkeit berechnen (Jaccard-Ähnlichkeit)
function calculateSimilarity(text1: string, text2: string): number {
  // Entferne Hashtags und Emojis für besseren Vergleich
  const clean1 = text1.replace(/#\w+/g, '').replace(/[^\w\s]/g, '').toLowerCase();
  const clean2 = text2.replace(/#\w+/g, '').replace(/[^\w\s]/g, '').toLowerCase();
  
  const words1 = new Set(clean1.split(/\s+/).filter(word => word.length > 2));
  const words2 = new Set(clean2.split(/\s+/).filter(word => word.length > 2));
  
  const intersection = new Set([...words1].filter(word => words2.has(word)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

// Prüfe auf ähnliche Posts und Bild-Duplikate
async function checkPostAndImageDuplicates(content: string, imagePath: string): Promise<{isValid: boolean, reason?: string}> {
  try {
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const imageName = path.basename(imagePath);
    
    // 1. Prüfe auf exakte Content-Duplikate (Hash)
    const exactDuplicate = await Post.findOne({ content_hash: contentHash });
    if (exactDuplicate) {
      logger.warn("❌ Exakter Post-Duplikat gefunden");
      return { isValid: false, reason: 'exact_content_duplicate' };
    }
    
    // 2. Prüfe die letzten 10 Posts auf Ähnlichkeit
    const recentPosts = await Post.find()
      .sort({ posted_at: -1 })
      .limit(10)
      .select('content image_name posted_at');
    
    for (const post of recentPosts) {
      const similarity = calculateSimilarity(content, post.content);
      if (similarity > 0.7) { // 70% Ähnlichkeit
        logger.warn(`❌ Ähnlicher Post gefunden (${Math.round(similarity * 100)}% ähnlich)`);
        logger.warn(`Alter Post: "${post.content.substring(0, 50)}..."`);
        return { isValid: false, reason: 'similar_content' };
      }
    }
    
    // 3. Prüfe die letzten 2 Posts auf gleiches Bild
    const lastTwoPosts = recentPosts.slice(0, 2);
    for (const post of lastTwoPosts) {
      if (post.image_name === imageName) {
        logger.warn(`❌ Gleiches Bild wie vor ${lastTwoPosts.indexOf(post) + 1} Post(s) verwendet: ${imageName}`);
        return { isValid: false, reason: 'duplicate_image' };
      }
    }
    
    logger.info("✅ Post und Bild sind einzigartig - kann gepostet werden");
    return { isValid: true };
    
  } catch (error) {
    logger.error("Fehler bei Duplikat-Check:", error);
    // Bei Fehler erlaube Posting (failsafe)
    return { isValid: true };
  }
}

// Speichere Post in MongoDB
async function savePostToDatabase(content: string, imagePath: string): Promise<void> {
  try {
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const imageName = path.basename(imagePath);
    
    const post = new Post({
      content: content,
      content_hash: contentHash,
      image_name: imageName,
      image_path: imagePath,
      posted_at: new Date(),
      post_type: 'instagram_post',
      success: true
    });
    
    await post.save();
    logger.info(`✅ Post in MongoDB gespeichert - Image: ${imageName}`);
    logger.info(`📊 Content Hash: ${contentHash.substring(0, 8)}...`);
    
  } catch (error) {
    logger.error("❌ MongoDB-Speicherung fehlgeschlagen:", error);
    // Nicht werfen - Post war erfolgreich, auch wenn Speicherung fehlschlägt
  }
}

// Generiere neue Post-Variation bei Duplikaten
async function generateUniquePost(maxRetries: number = 3): Promise<{content: string, imagePath: string}> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`📝 Generiere Post-Versuch ${attempt}/${maxRetries}...`);
      
      const content = await generateJoke();
      const jokeContent = Array.isArray(content) ? content[0]?.witz ?? "" : (content as string);
      
      let imagePath = await ensureImageExists(jokeContent);
      
      // Prüfe auf Duplikate
      const validation = await checkPostAndImageDuplicates(jokeContent, imagePath);
      
      if (validation.isValid) {
        logger.info(`✅ Einzigartiger Post nach ${attempt} Versuch(en) generiert`);
        return { content: jokeContent, imagePath };
      }
      
      // Bei Bild-Duplikat: Versuche anderes Bild aus derselben Kategorie
      if (validation.reason === 'duplicate_image') {
        logger.info("🔄 Versuche anderes Bild aus derselben Kategorie...");
        const category = determineImageCategory(jokeContent);
        imagePath = await getRandomImageFromCategory(category);
        
        const recheck = await checkPostAndImageDuplicates(jokeContent, imagePath);
        if (recheck.isValid) {
          logger.info("✅ Anderes Bild erfolgreich gewählt");
          return { content: jokeContent, imagePath };
        }
      }
      
      logger.warn(`⚠️ Versuch ${attempt} fehlgeschlagen: ${validation.reason}`);
      
      // Bei letztem Versuch: Akzeptiere es trotzdem
      if (attempt === maxRetries) {
        logger.warn("⚠️ Max. Versuche erreicht - verwende letzten generierten Post");
        return { content: jokeContent, imagePath };
      }
      
      // Kurz warten vor nächstem Versuch
      await delay(2000);
      
    } catch (error) {
      logger.error(`Fehler bei Post-Generierung Versuch ${attempt}:`, error);
      if (attempt === maxRetries) throw error;
    }
  }
  
  throw new Error("Konnte keinen einzigartigen Post generieren");
}

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
  await page.waitForFunction(
    () => location.pathname === '/'                              // zurück im Feed
       || !!document.querySelector('[data-testid="upload-flow-success-toast"]'),
    { timeout: 60_000 }
  );
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

// Erweiterte ensureImageExists Funktion
async function ensureImageExists(postContent?: string): Promise<string> {
  const assetsDir = path.resolve("assets");
  
  // Erstelle Hauptverzeichnis
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  // Erstelle alle Kategorieordner
  await createCategoryFolders();
  
  try {
    if (postContent) {
      // Bestimme Kategorie basierend auf Post-Inhalt
      const category = determineImageCategory(postContent);
      logger.info(`Erkannte Bildkategorie für Post: ${category}`);
      
      return await getRandomImageFromCategory(category);
    } else {
      // Fallback zu default Kategorie
      return await getRandomImageFromCategory('default');
    }
    
  } catch (error) {
    logger.error("Fehler bei intelligenter Bildauswahl:", error);
    return await createFallbackImage();
  }
}

function determineImageCategory(postContent: string): string {
  const content = postContent.toLowerCase();
  let bestMatch = { category: 'default', matchCount: 0, keywords: [] as string[] };
  
  for (const category of imageCategories) {
    let matchCount = 0;
    const foundKeywords: string[] = [];
    
    // Zähle alle Keyword-Treffer in dieser Kategorie
    for (const keyword of category.keywords) {
      if (content.includes(keyword.toLowerCase())) {
        matchCount++;
        foundKeywords.push(keyword);
      }
    }
    
    // Log für Debug
    if (matchCount > 0) {
      logger.info(`Kategorie "${category.folder}": ${matchCount} Treffer [${foundKeywords.join(', ')}]`);
    }
    
    // Neue beste Kategorie gefunden?
    if (matchCount > bestMatch.matchCount) {
      bestMatch = { category: category.folder, matchCount, keywords: foundKeywords };
    }
  }
  
  if (bestMatch.matchCount > 0) {
    logger.info(`✅ Gewählt: ${bestMatch.category} mit ${bestMatch.matchCount} Treffern: [${bestMatch.keywords.join(', ')}]`);
  } else {
    logger.info("Keine Keywords gefunden, verwende default");
  }
  
  return bestMatch.category;
}

async function getRandomImageFromCategory(category: string): Promise<string> {
  const categoryPath = path.resolve("assets", category);
  
  // Prüfe ob Kategorie-Ordner existiert
  if (!fs.existsSync(categoryPath)) {
    logger.warn(`Kategorie-Ordner ${category} existiert nicht, erstelle ihn...`);
    fs.mkdirSync(categoryPath, { recursive: true });
    
    // Wenn leer, fallback zu default
    if (category !== 'default') {
      return await getRandomImageFromCategory('default');
    }
  }
  
  // Lade alle Bilddateien aus dem Ordner
  const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
  const imageFiles = fs.readdirSync(categoryPath)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return supportedFormats.includes(ext);
    })
    .sort(() => Math.random() - 0.5); // ✅ Shuffle das Array!

  if (imageFiles.length === 0) {
    logger.warn(`Keine Bilder in Kategorie ${category} gefunden`);
    
    if (category !== 'default') {
      return await getRandomImageFromCategory('default');
    } else {
      // Erstelle Fallback-Bild für default
      return await createFallbackImage();
    }
  }

  // Wähle zufälliges Bild
  const randomIndex = Math.floor(Math.random() * imageFiles.length);
  const selectedImage = imageFiles[randomIndex];
  const imagePath = path.join(categoryPath, selectedImage);
  
  logger.info(`Gewähltes Bild: ${selectedImage} aus Kategorie ${category}`);
  return imagePath;
}

async function createCategoryFolders(): Promise<void> {
  const baseDir = path.resolve("assets");
  
  // Erstelle alle Kategorieordner + default
  const allFolders = [...imageCategories.map(cat => cat.folder), 'default'];
  
  for (const folder of allFolders) {
    const folderPath = path.join(baseDir, folder);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      logger.info(`Kategorie-Ordner erstellt: ${folder}`);
    }
  }
}

async function createFallbackImage(): Promise<string> {
  const fallbackPath = path.resolve("assets/default/fallback.jpg");
  const defaultDir = path.dirname(fallbackPath);
  
  // Erstelle default Ordner falls nicht vorhanden
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  
  // Erstelle 1x1 Pixel Placeholder (dein ursprünglicher Code)
  logger.warn("Erstelle Fallback-Bild...");
  const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(base64PNG, 'base64');
  fs.writeFileSync(fallbackPath, buffer);
  
  logger.info("Fallback-Bild erstellt");
  return fallbackPath;
}

// Debug-Funktion zum Testen der Bildauswahl
export async function testImageSelection(testPosts: string[]): Promise<void> {
  logger.info("=== BILD-AUSWAHL TEST ===");
  
  for (const post of testPosts) {
    const imagePath = await ensureImageExists(post);
    const category = determineImageCategory(post);
    logger.info(`Post: "${post.substring(0, 60)}..."`);
    logger.info(`→ Kategorie: ${category}`);
    logger.info(`→ Bild: ${imagePath}`);
    logger.info("---");
  }
}

export { ensureImageExists };

export async function postJoke(page: Page) {
  try {
    logger.info("🚀 Starte Post-Erstellung mit Duplikat-Check...");

    /* ░░ 0) Generiere einzigartigen Post und Bild ░░ */
    const { content: jokeContent, imagePath } = await generateUniquePost();
    
    logger.info(`📝 Finaler Post-Text: "${jokeContent.substring(0, 100)}..."`);
    logger.info(`🖼️ Gewähltes Bild: ${path.basename(imagePath)}`);

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
        await clickNextButton(page);
        await delay(2000);
      }
    } catch (error) {
      logger.error("Fehler bei Weiter-Buttons:", error);
      throw error;
    }

   /* ░░ 5) Caption eingeben ░░ */
    logger.info("Beginne Caption-Eingabe...");
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
      
      await clickShareButton(page);
      
      // Warten auf Bestätigung - LÄNGER warten
      logger.info("Warte 15 Sekunden auf Upload-Completion...");
      await delay(15000);
      
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
        
        // ✅✅ NEU: Post in MongoDB speichern NACH erfolgreichem Posting
        await savePostToDatabase(jokeContent, imagePath);
        
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
        
        // Speichere trotzdem - könnte erfolgreich gewesen sein
        await savePostToDatabase(jokeContent, imagePath);
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
