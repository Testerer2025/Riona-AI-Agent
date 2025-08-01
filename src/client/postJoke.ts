import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import { runAgent } from "../Agent/index";
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

// AI-basierte Ähnlichkeitsprüfung
async function checkPostSimilarityWithAI(newPost: string, recentPosts: any[]): Promise<{isValid: boolean, reason?: string, similarPost?: string}> {
  try {
    // Wenn keine Posts vorhanden, ist alles OK
    if (recentPosts.length === 0) {
      return { isValid: true };
    }
    
    // Bereite Kontext für AI vor
    const recentPostsText = recentPosts.map((post, index) => 
      `Post ${index + 1} (${Math.ceil((Date.now() - post.posted_at.getTime()) / (1000 * 60 * 60 * 24))} Tage alt): "${post.content}"`
    ).join('\n\n');
    
    const aiPrompt = `
    Du bist ein Experte für Content-Analyse. Prüfe ob der neue Post zu ähnlich zu den vorherigen Posts ist.
    
    NEUER POST:
    "${newPost}"
    
    VORHERIGE POSTS (letzte 30):
    ${recentPostsText}
    
    Analysiere diese Aspekte:
    1. Thematische Überschneidungen (gleiche Konzepte, auch wenn anders formuliert)
    2. Strukturelle Ähnlichkeiten (gleicher Aufbau, gleiche Emojis/Symbole)
    3. Zeitliche Bezüge (gleiche Wochentage, Jahreszeiten, Feiertage)
    4. Motivational-Pattern (ähnliche Ermutigungsformeln)
    5. Inhaltliche Wiederholungen (gleiche Tipps, Ratschläge)
    6. Sprachliche Muster (wiederkehrende Phrasen, Wörter)
    
    BEWERTUNG:
    - ERLAUBT: Wenn der neue Post frische Perspektiven, andere Themen oder völlig anderen Ansatz hat
    - ÄHNLICH: Wenn 2+ der oberen Aspekte stark übereinstimmen
    - SEHR ÄHNLICH: Wenn der Post im Grunde das Gleiche aussagt, nur anders formuliert
    
    Antworte in diesem JSON-Format:
    {
      "similarity_score": <0-100 Prozent>,
      "is_too_similar": <true/false>,
      "main_similarities": ["Aspekt 1", "Aspekt 2"],
      "most_similar_post": "Post X (Y Tage alt)",
      "recommendation": "Kurze Begründung"
    }
    
    Sei streng bei der Bewertung - Variation ist wichtiger als Konsistenz.
    `;
    
    console.log("🤖 Führe AI-Ähnlichkeitsanalyse durch...");
    const aiResponse = await runAgent(null as any, aiPrompt);
    
    // Parse AI Response
    let analysis;
    try {
      // Versuche JSON zu parsen
      const responseText = typeof aiResponse === 'string' ? aiResponse : JSON.stringify(aiResponse);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysis = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Kein JSON gefunden");
      }
    } catch (parseError) {
      console.warn("AI-Response konnte nicht geparst werden, verwende Fallback");
      return { isValid: true }; // Failsafe
    }
    
    // Analysiere AI-Ergebnis
    const isTooSimilar = analysis.is_too_similar || analysis.similarity_score > 60;
    
    if (isTooSimilar) {
      console.warn(`🤖 AI erkannte ${analysis.similarity_score}% Ähnlichkeit`);
      console.warn(`📋 Ähnlichkeiten: ${analysis.main_similarities?.join(', ')}`);
      console.warn(`📄 Ähnlichster Post: ${analysis.most_similar_post}`);
      console.warn(`💡 Empfehlung: ${analysis.recommendation}`);
      
      return {
        isValid: false,
        reason: 'ai_detected_similarity',
        similarPost: analysis.most_similar_post
      };
    }
    
    console.log(`✅ AI-Check bestanden (${analysis.similarity_score}% Ähnlichkeit)`);
    return { isValid: true };
    
  } catch (error) {
    console.error("Fehler bei AI-Ähnlichkeitsprüfung:", error);
    // Failsafe: Bei Fehler erlaube Posting
    return { isValid: true };
  }
}

// Erweiterte Duplikat-Prüfung mit AI
async function checkPostAndImageDuplicatesWithAI(content: string, imagePath: string): Promise<{isValid: boolean, reason?: string}> {
  try {
    const contentHash = crypto.createHash('md5').update(content).digest('hex');
    const imageName = path.basename(imagePath);
    
    // 1. Prüfe auf exakte Content-Duplikate (Hash)
    const exactDuplicate = await Post.findOne({ content_hash: contentHash });
    if (exactDuplicate) {
      logger.warn("❌ Exakter Post-Duplikat gefunden");
      return { isValid: false, reason: 'exact_content_duplicate' };
    }
    
    // 2. Lade die letzten 30 Posts für AI-Analyse
    const recentPosts = await Post.find()
      .sort({ posted_at: -1 })
      .limit(30)
      .select('content image_name posted_at');
    
    // 3. AI-basierte Ähnlichkeitsprüfung
    const aiSimilarityCheck = await checkPostSimilarityWithAI(content, recentPosts);
    
    if (!aiSimilarityCheck.isValid) {
      return { isValid: false, reason: aiSimilarityCheck.reason };
    }
    
    // 4. Prüfe die letzten 3 Posts auf gleiches Bild
    const lastThreePosts = recentPosts.slice(0, 3);
    for (const post of lastThreePosts) {
      if (post.image_name === imageName) {
        logger.warn(`❌ Gleiches Bild wie vor ${lastThreePosts.indexOf(post) + 1} Post(s) verwendet: ${imageName}`);
        return { isValid: false, reason: 'duplicate_image' };
      }
    }
    
    logger.info("✅ Post und Bild sind einzigartig (AI + Hash + Bild-Check bestanden)");
    return { isValid: true };
    
  } catch (error) {
    logger.error("Fehler bei erweiterten Duplikat-Check:", error);
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
    
    // Bessere Logs mit vollständigem Content
    logger.info(`✅ Post in MongoDB gespeichert:`);
    logger.info(`📝 Content (${content.length} Zeichen): "${content}"`);
    logger.info(`🖼️ Image: ${imageName}`);
    logger.info(`🔗 Hash: ${contentHash.substring(0, 12)}...`);
    
    // Verifikation: Lese den gespeicherten Post nochmal aus
    const savedPost = await Post.findOne({ content_hash: contentHash }).select('content');
    if (savedPost) {
      logger.info(`✓ Verifikation: Gespeichert (${savedPost.content.length} Zeichen)`);
      if (savedPost.content !== content) {
        logger.error(`❌ WARNUNG: Gespeicherter Content unterscheidet sich!`);
        logger.error(`Original: "${content}"`);
        logger.error(`Gespeichert: "${savedPost.content}"`);
      }
    }
    
  } catch (error) {
    logger.error("❌ MongoDB-Speicherung fehlgeschlagen:", error);
    logger.error(`Versuchte zu speichern: "${content}" (${content.length} Zeichen)`);
  }
}

// Generiere verbesserten Post basierend auf vorherigen Ablehnungen
async function generateImprovedPost(rejectionReasons: string[]): Promise<string> {
  const improvementPrompt = `
    Der vorherige Post wurde abgelehnt. Erstelle einen komplett anderen Post mit diesen Verbesserungen:
    
    VERMEIDE DIESE PROBLEME (aus vorherigen Versuchen):
    ${rejectionReasons.map(reason => `- ${reason}`).join('\n')}
    
    ERSTELLE EINEN VÖLLIG ANDEREN POST:
    - Komplett anderes Thema
    - Andere Struktur und Formulierung  
    - Andere Emojis oder gar keine
    - Anderer Tonfall (förmlicher/lockerer)
    - Andere Perspektive (Kunde statt Agentur, Problem statt Lösung)
    - Andere Post-Art (Frage statt Statement, Story statt Tipp)
    
    Anforderungen:
    - 350-450 Zeichen für Instagram
    - Professionell für Social Media Agentur
    - Deutsch
    - Bietet echten Mehrwert
    - Ist einzigartig und frisch
    
    Fokussiere auf: Business-Strategien, Tool-Empfehlungen, Kundenbeziehungen, Branchenentwicklungen, oder Team-Insights.
  `;
  
  const result = await runAgent(null as any, improvementPrompt);
  return parseSimpleResponse(result);
}

// Parse AI Response (wie in deiner ursprünglichen joke.ts)
function parseSimpleResponse(response: any): string {
  try {
    if (Array.isArray(response)) {
      if (response[0]?.instagram_post) return response[0].instagram_post;
      if (response[0]?.witz) return response[0].witz;
      if (response[0]?.joke) return response[0].joke;
      if (response[0]?.content) return response[0].content;
      if (response[0]?.post) return response[0].post;
      if (typeof response[0] === "string") return response[0];
    }
    
    if (typeof response === "object" && response !== null) {
      if (response.instagram_post) return String(response.instagram_post);
      if (response.witz) return String(response.witz);
      if (response.Witz) return String(response.Witz);
      if (response.joke) return String(response.joke);
      if (response.Joke) return String(response.Joke);
      if (response.content) return String(response.content);
      if (response.post) return String(response.post);
    }
    
    if (typeof response === "string") {
      try {
        const parsed = JSON.parse(response);
        if (Array.isArray(parsed) && parsed[0]?.instagram_post) {
          return parsed[0].instagram_post;
        }
        if (Array.isArray(parsed) && parsed[0]?.witz) {
          return parsed[0].witz;
        }
        if (parsed?.instagram_post) return parsed.instagram_post;
        if (parsed?.witz) return parsed.witz;
        return response;
      } catch {
        return response;
      }
    }
    
    console.log("Unerwartetes Datenformat:", JSON.stringify(response));
    return getBackupPost();
    
  } catch (error) {
    console.error("Parse Error:", error);
    return getBackupPost();
  }
}

// Intelligente Post-Variation mit AI-Feedback
async function generateUniquePostWithAI(maxRetries: number = 4): Promise<{content: string, imagePath: string}> {
  let rejectionReasons: string[] = [];
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`🎨 AI-gestützter Post-Versuch ${attempt}/${maxRetries}...`);
      
      // Bei weiteren Versuchen: Instruiere AI, vorherige Probleme zu vermeiden
      let content: string;
      if (attempt === 1) {
        content = await generateJoke();
      } else {
        content = await generateImprovedPost(rejectionReasons);
      }
      
      const jokeContent = Array.isArray(content) ? content[0]?.witz ?? "" : (content as string);
      let imagePath = await ensureImageExists(jokeContent);
      
      // Prüfe mit AI-verbesserter Duplikat-Erkennung
      const validation = await checkPostAndImageDuplicatesWithAI(jokeContent, imagePath);
      
      if (validation.isValid) {
        logger.info(`✅ Einzigartiger Post nach ${attempt} AI-Versuch(en) generiert`);
        return { content: jokeContent, imagePath };
      }
      
      // Sammle Ablehnungsgründe für nächsten Versuch
      rejectionReasons.push(validation.reason || 'unknown');
      
      // Bei Bild-Duplikat: Versuche anderes Bild
      if (validation.reason === 'duplicate_image') {
        logger.info("🔄 Versuche anderes Bild...");
        const category = determineImageCategory(jokeContent);
        imagePath = await getRandomImageFromCategory(category);
        
        const recheck = await checkPostAndImageDuplicatesWithAI(jokeContent, imagePath);
        if (recheck.isValid) {
          logger.info("✅ Anderes Bild erfolgreich gewählt");
          return { content: jokeContent, imagePath };
        }
      }
      
      logger.warn(`⚠️ AI-Versuch ${attempt} abgelehnt: ${validation.reason}`);
      
      // Bei letztem Versuch: Akzeptiere es trotzdem
      if (attempt === maxRetries) {
        logger.warn("⚠️ Max. AI-Versuche erreicht - verwende letzten Post");
        return { content: jokeContent, imagePath };
      }
      
      // Warten vor nächstem Versuch
      await delay(3000);
      
    } catch (error) {
      logger.error(`Fehler bei AI-Post-Generierung Versuch ${attempt}:`, error);
      if (attempt === maxRetries) throw error;
    }
  }
  
  throw new Error("Konnte keinen AI-validierten Post generieren");
}

function getBackupPost(): string {
  const backupPosts = [
    `🎯 Authentizität schlägt Perfektion. Jeden Tag.

Was ist euer authentischster Marketing-Moment gewesen?

#authentizität #realmarketing #storytelling #community`,

    `⚡ Plot Twist: Die besten Kampagnen entstehen oft aus "gescheiterten" Ideen.

Welche eurer verworfenen Ideen hätte vielleicht doch funktioniert?

#kreativität #ideenfindung #kampagnenentwicklung #innovation`,

    `🚀 Kleine Teams, große Wirkung: Manchmal ist weniger wirklich mehr.

Was ist euer bestes Beispiel für effiziente Teamarbeit?

#teamwork #effizienz #kleinesteams #grossewirkung`
  ];
  
  return backupPosts[Math.floor(Math.random() * backupPosts.length)];
}

/** Klickt WEITER-Buttons (nicht Share!) */
async function clickNextButton(page: Page, timeout = 20_000) {
  try {
    logger.info(`Suche nach WEITER-Button...`);
    
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

  try {
    await page.waitForFunction(() => !document.querySelector('div[role="progressbar"]'), { timeout: 60_000 });
  } catch {
    logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
  }

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

  await page.waitForFunction(
    () => location.pathname === '/'
       || !!document.querySelector('[data-testid="upload-flow-success-toast"]'),
    { timeout: 60_000 }
  );
}

async function findAndFillCaption(page: Page, text: string): Promise<void> {
  logger.info(`Versuche Caption einzugeben: "${text.slice(0, 100)}…"`);
  
  const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
  await page.waitForSelector(sel, { timeout: 10_000, visible: true });
  const handle = await page.$(sel);
  if (!handle) throw new Error("Caption‑Feld nicht gefunden");

  await handle.click({ clickCount: 1 });
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(sel, text, { delay: 25 });
  await delay(500);
  await page.evaluate(() => (document.activeElement as HTMLElement).blur());
  await delay(300);

  const current = await page.evaluate(s => document.querySelector<HTMLElement>(s)?.innerText || "", sel);
  logger.info(`Caption‑Länge nach Eingabe: ${current.length}`);
}

// Erweiterte ensureImageExists Funktion
async function ensureImageExists(postContent?: string): Promise<string> {
  const assetsDir = path.resolve("assets");
  
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
  
  await createCategoryFolders();
  
  try {
    if (postContent) {
      const category = determineImageCategory(postContent);
      logger.info(`Erkannte Bildkategorie für Post: ${category}`);
      return await getRandomImageFromCategory(category);
    } else {
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
    
    for (const keyword of category.keywords) {
      if (content.includes(keyword.toLowerCase())) {
        matchCount++;
        foundKeywords.push(keyword);
      }
    }
    
    if (matchCount > 0) {
      logger.info(`Kategorie "${category.folder}": ${matchCount} Treffer [${foundKeywords.join(', ')}]`);
    }
    
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
  
  if (!fs.existsSync(categoryPath)) {
    logger.warn(`Kategorie-Ordner ${category} existiert nicht, erstelle ihn...`);
    fs.mkdirSync(categoryPath, { recursive: true });
    
    if (category !== 'default') {
      return await getRandomImageFromCategory('default');
    }
  }
  
  const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
  const imageFiles = fs.readdirSync(categoryPath)
    .filter(file => {
      const ext = path.extname(file).toLowerCase();
      return supportedFormats.includes(ext);
    })
    .sort(() => Math.random() - 0.5);

  if (imageFiles.length === 0) {
    logger.warn(`Keine Bilder in Kategorie ${category} gefunden`);
    
    if (category !== 'default') {
      return await getRandomImageFromCategory('default');
    } else {
      return await createFallbackImage();
    }
  }

  const randomIndex = Math.floor(Math.random() * imageFiles.length);
  const selectedImage = imageFiles[randomIndex];
  const imagePath = path.join(categoryPath, selectedImage);
  
  logger.info(`Gewähltes Bild: ${selectedImage} aus Kategorie ${category}`);
  return imagePath;
}

async function createCategoryFolders(): Promise<void> {
  const baseDir = path.resolve("assets");
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
  
  if (!fs.existsSync(defaultDir)) {
    fs.mkdirSync(defaultDir, { recursive: true });
  }
  
  if (fs.existsSync(fallbackPath)) {
    return fallbackPath;
  }
  
  logger.warn("Erstelle Fallback-Bild...");
  const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  const buffer = Buffer.from(base64PNG, 'base64');
  fs.writeFileSync(fallbackPath, buffer);
  
  logger.info("Fallback-Bild erstellt");
  return fallbackPath;
}

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
    logger.info("🚀 Starte Post-Erstellung mit AI-Duplikat-Check...");

    /* ░░ 0) Generiere AI-validierten einzigartigen Post und Bild ░░ */
    const { content: jokeContent, imagePath } = await generateUniquePostWithAI();
    
    logger.info(`📝 Finaler Post-Text: "${jokeContent.substring(0, 100)}..."`);
    logger.info(`🖼️ Gewähltes Bild: ${path.basename(imagePath)}`);

    /* ░░ 1) Instagram‑Startseite ░░ */
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(2000);

    /* ░░ 2) „+"‑Icon finden und klicken ░░ */
    try {
      const plusSelectors = [
        'svg[aria-label*="New post"]',
        'svg[aria-label*="Create"]', 
        'svg[aria-label*="Neuer Beitrag"]',
        'svg[aria-label*="Beitrag erstellen"]',
        'a[href="#"] svg',
        'div[role="menuitem"] svg'
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
      await delay(3000);
      
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

    logger.info("Warte 5 Sekunden damit Instagram Text verarbeitet...");
    await delay(5000);

    try {
      await page.click('div[contenteditable="true"][aria-label*="caption"]');
      logger.info("Nochmal ins Caption-Feld geklickt zur Sicherheit");
      await delay(1000);
    } catch (e) {
      logger.info("Extra-Klick fehlgeschlagen, aber das ist ok");
    }

    // DEBUG: Screenshot
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
      
      logger.info("Warte 15 Sekunden auf Upload-Completion...");
      await delay(15000);
      
      // DEBUG: Nach dem Share - prüfe ob Dialog verschwunden oder Fehler aufgetreten
      const postShareStatus = await page.evaluate(() => {
        const dialogs = document.querySelectorAll('div[role="dialog"]');
        const hasDialog = dialogs.length > 0;
        
        const errorMessages = document.querySelectorAll('[data-testid="error"], .error, [aria-live="polite"]');
        const errors = Array.from(errorMessages).map(el => el.textContent).filter(text => text && text.length > 0);
        
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
        
        // ✅ NEU: Post in MongoDB speichern NACH erfolgreichem Posting
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
    
    // Screenshot für Debugging
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
