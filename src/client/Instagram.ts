import { Browser, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Server } from "proxy-chain";
import { IGpassword, IGusername } from "../secret";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { runAgent } from "../Agent";
import { getInstagramCommentSchema } from "../Agent/schema";
import { postJoke } from "./postJoke";
import mongoose from 'mongoose';
import crypto from 'crypto';
import { ensureImageExists } from "./postJoke";
import { Post, Comment } from "../models";

// 🔒 ERWEITERTE MUTEX-LOGIK
let isPosting = false;        
let isCommenting = false;     
let systemBusy = false;       

puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 🔒 SICHERER POSTING-WRAPPER
async function safePostJoke(page: any): Promise<void> {
  if (systemBusy || isPosting || isCommenting) {
    logger.info("🚫 System busy - Post verschoben");
    return;
  }

  isPosting = true;
  systemBusy = true;
  logger.info("🔒 Posting-Locks gesetzt - alle anderen Aktivitäten pausiert");
  
  if (isCommenting) {
    logger.info("⏸️ Pausiere Kommentieren für Post...");
    isCommenting = false;
    await delay(3000);
  }

  try {
    logger.info("🚀 Starte sicheren Post-Prozess...");
    
    const currentUrl = page.url();
    if (!currentUrl.includes('instagram.com') || currentUrl.includes('/p/') || currentUrl.includes('create')) {
      logger.info("📍 Navigiere zur Instagram-Hauptseite vor Post...");
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await delay(3000);
    }
    
    await postJoke(page);
    
    logger.info("✅ Post erfolgreich - kehre zum Feed zurück");
    
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(5000);
    
  } catch (error) {
    logger.error("❌ Post-Fehler:", error);
    
    try {
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await delay(3000);
    } catch (navError) {
      logger.error("❌ Navigation nach Post-Fehler fehlgeschlagen:", navError);
    }
  } finally {
    isPosting = false;
    systemBusy = false;
    logger.info("🔓 Post-Prozess beendet - System wieder frei");
  }
}

// 🔒 SICHERER KOMMENTAR-WRAPPER  
async function safeInteractWithPosts(page: any): Promise<void> {
  if (systemBusy || isPosting) {
    logger.info("🚫 System busy oder Posting läuft - Kommentieren pausiert");
    return;
  }

  isCommenting = true;
  
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('instagram.com') || currentUrl.includes('/p/') || currentUrl.includes('create')) {
      logger.info("📍 Navigiere zum Feed für Kommentieren...");
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await delay(3000);
    }
    
    await interactWithPosts(page);
    
  } catch (error) {
    logger.error("❌ Kommentar-Fehler:", error);
  } finally {
    isCommenting = false;
  }
}

function generatePostId(caption: string, postIndex: number, author: string): string {
  const content = `${caption}_${postIndex}_${author}`.substring(0, 100);
  return crypto.createHash('md5').update(content).digest('hex');
}

async function hasAlreadyCommented(postId: string): Promise<boolean> {
  try {
    const existingComment = await Comment.findOne({ post_id: postId });
    return !!existingComment;
  } catch (error) {
    logger.error("Fehler bei Kommentar-Duplikat-Check:", error);
    return false;
  }
}

// 🎯 ROBUSTE Author-Extraktion
async function getPostAuthor(page: any, postSelector: string): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) {
        console.log(`DEBUG: Post not found with selector: ${selector}`);
        return 'unknown';
      }
      
      console.log(`DEBUG: Analyzing post for author...`);
      
      const headerSelectors = [
        'header a[role="link"]',
        'article header a',
        'header div a',
        'h2 a'
      ];
      
      for (const headerSel of headerSelectors) {
        const headerLinks = post.querySelectorAll(headerSel);
        console.log(`DEBUG: Found ${headerLinks.length} header links with selector: ${headerSel}`);
        
        for (const link of headerLinks) {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          
          if (href) {
            const match = href.match(/^\/([^\/\?]+)(?:\/|\?|$)/);
            if (match && match[1]) {
              const username = match[1];
              
              if (username && 
                  username.length > 0 && 
                  username.length <= 30 &&
                  username !== 'p' && 
                  username !== 'reel' && 
                  username !== 'reels' &&
                  username !== 'stories' &&
                  username !== 'explore' &&
                  username !== 'accounts' &&
                  !username.includes('audio') &&
                  username.match(/^[a-zA-Z0-9._]+$/)) {
                
                console.log(`DEBUG: ✅ Valid username from href: "${username}"`);
                return username;
              }
            }
          }
          
          if (text && 
              text.length > 0 && 
              text.length <= 30 &&
              !text.includes('•') &&
              !text.includes('Std.') &&
              !text.includes('Tag') &&
              text.match(/^[a-zA-Z0-9._]+$/)) {
            
            console.log(`DEBUG: ✅ Valid username from text: "${text}"`);
            return text;
          }
        }
      }
      
      console.log('DEBUG: No valid username found in header, trying fallback...');
      
      const allLinks = post.querySelectorAll('a[href^="/"]');
      for (const link of allLinks) {
        const href = link.getAttribute('href');
        if (href) {
          const match = href.match(/^\/([^\/\?]+)(?:\/|\?|$)/);
          if (match && match[1]) {
            const username = match[1];
            if (username && 
                username.length > 0 && 
                username.length <= 30 &&
                username !== 'p' &&
                !username.includes('audio') &&
                username.match(/^[a-zA-Z0-9._]+$/)) {
              
              const rect = link.getBoundingClientRect();
              const postRect = post.getBoundingClientRect();
              const isInUpperHalf = rect.top < (postRect.top + postRect.height / 2);
              
              if (isInUpperHalf) {
                console.log(`DEBUG: ✅ Valid username from upper post area: "${username}"`);
                return username;
              }
            }
          }
        }
      }
      
      console.log('DEBUG: No valid username found anywhere, returning unknown');
      return 'unknown';
    }, postSelector);
  } catch (error) {
    logger.error("Fehler beim Extrahieren des Post-Authors:", error);
    return 'unknown';
  }
}

function isOwnPost(page: any, postSelector: string): Promise<boolean> {
  const ownUsername = process.env.IGclearusername || 'fallback_username';
  
  return page.evaluate((selector: string, ownUsernameParam: string) => {
    console.log(`DEBUG: Own username check: "${ownUsernameParam}"`);
    
    const post = document.querySelector(selector);
    if (!post) {
      console.log(`DEBUG: Post not found for own-post check: ${selector}`);
      return false;
    }
    
    const header = post.querySelector('header');
    if (header) {
      const headerLinks = header.querySelectorAll('a[href^="/"]');
      console.log(`DEBUG: Checking ${headerLinks.length} header links for own username`);
      
      for (const link of headerLinks) {
        const href = link.getAttribute('href');
        
        if (href) {
          const match = href.match(/^\/([^\/\?]+)(?:\/|\?|$)/);
          if (match && match[1]) {
            const username = match[1];
            
            if (username && 
                username.length > 0 && 
                username.length <= 30 &&
                username !== 'p' &&
                username !== 'reel' &&
                username !== 'reels' &&
                username !== 'tv' &&
                username !== 'stories' &&
                username !== 'explore' &&
                username !== 'accounts' &&
                username !== 'direct' &&
                !username.includes('audio') &&
                !username.includes('hashtag') &&
                username.match(/^[a-zA-Z0-9._]+$/)) {
              
              console.log(`DEBUG: Comparing header username "${username}" with own "${ownUsernameParam}"`);
              
              if (username === ownUsernameParam) {
                console.log(`DEBUG: ✅ MATCH! This is own post`);
                return true;
              }
            }
          }
        }
      }
    }
    
    console.log(`DEBUG: ❌ NO MATCH - Not own post`);
    return false;
  }, postSelector, ownUsername);
}

function generateEmergencyPost(): string {
  const timestamp = new Date().toISOString().slice(5, 16);
  const randomTopic = [
    "Heute ist ein neuer Tag für frische Ideen",
    "Was sind eure Pläne für diese Woche",
    "Teamwork makes the dream work - wie wahr ist das",
    "Authentizität ist der Schlüssel zum Erfolg",
    "Kleine Schritte führen zu großen Zielen"
  ];
  
  const topic = randomTopic[Math.floor(Math.random() * randomTopic.length)];
  
  return `${topic}? 💭

Teilt eure Gedanken in den Kommentaren!

#monday #motivation #thoughts #${timestamp.replace(/[-:]/g, '')}`;
}

function parseSimpleResponse(response: any): string {
  try {
    console.log("AI Response Type:", typeof response);
    console.log("AI Response Value:", JSON.stringify(response));
    
    if (Array.isArray(response)) {
      if (response[0]?.instagram_post) return response[0].instagram_post;
      if (response[0]?.friday_post) return response[0].friday_post;        
      if (response[0]?.motivational_post) return response[0].motivational_post; 
      if (response[0]?.agency_post) return response[0].agency_post;        
      if (response[0]?.tip_post) return response[0].tip_post;              
      if (response[0]?.witz) return response[0].witz;
      if (response[0]?.joke) return response[0].joke;
      if (response[0]?.content) return response[0].content;
      if (response[0]?.post) return response[0].post;
      if (typeof response[0] === "string") return response[0];
    }
    
    if (typeof response === "object" && response !== null) {
      if (response.instagram_post) return String(response.instagram_post);
      if (response.friday_post) return String(response.friday_post);        
      if (response.motivational_post) return String(response.motivational_post); 
      if (response.agency_post) return String(response.agency_post);        
      if (response.tip_post) return String(response.tip_post);              
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
        if (Array.isArray(parsed) && parsed[0]?.friday_post) {          
          return parsed[0].friday_post;
        }
        if (Array.isArray(parsed) && parsed[0]?.witz) {
          return parsed[0].witz;
        }
        if (parsed?.instagram_post) return parsed.instagram_post;
        if (parsed?.friday_post) return parsed.friday_post;            
        if (parsed?.witz) return parsed.witz;
        return response;
      } catch {
        return response;
      }
    }
    
    console.log("Unerwartetes Datenformat:", JSON.stringify(response));
    
    const responseObj = Array.isArray(response) ? response[0] : response;
    if (responseObj && typeof responseObj === 'object') {
      console.log("Verfügbare Felder:", Object.keys(responseObj));
      
      const firstValue = Object.values(responseObj)[0];
      if (typeof firstValue === 'string') {
        console.log("Verwende ersten String-Wert als Fallback:", firstValue.substring(0, 100));
        return firstValue;
      }
    }
    
    console.log("FALLBACK: Generiere neuen Post da AI-Response invalid");
    return generateEmergencyPost();
    
  } catch (error) {
    console.error("Parse Error:", error);
    return generateEmergencyPost();
  }
}

async function generateUniquePostBasedOnHistory(): Promise<{content: string, imagePath: string}> {
  try {
    logger.info("🔍 Analysiere Post-Historie für intelligente Content-Generierung...");
    
    const recentPosts = await Post.find()
      .sort({ posted_at: -1 })
      .limit(50)
      .select('content image_name posted_at post_type');
    
    logger.info(`📊 Gefunden: ${recentPosts.length} Posts für Analyse`);
    
    if (recentPosts.length < 5) {
      logger.info("📝 Wenige Posts vorhanden - verwende vereinfachte Generierung");
      
      const simplePrompt = `
      Erstelle einen professionellen Instagram-Post für eine Social Media Agentur.
      
      Anforderungen:
      - 300-450 Zeichen
      - Deutsch
      - Authentisch und wertvoll
      - Frage am Ende für Engagement
      - Relevante Hashtags
      
      Themen-Ideen: Marketing-Trends, Team-Erfolge, Kundenbeziehungen, Tools, Branchenentwicklungen
      
      Antworte nur mit dem fertigen Post-Text.
      `;
      
      const simpleResponse = await runAgent(null as any, simplePrompt);
      const postContent = parseSimpleResponse(simpleResponse);
      const imagePath = await ensureImageExists(postContent);
      
      return { content: postContent, imagePath };
    }
    
    const analysisPrompt = `
    Du bist ein Content-Strategieexperte. Analysiere diese ${recentPosts.length} vorherigen Posts und erstelle Guidelines für einen neuen, einzigartigen Post.

    VORHERIGE POSTS:
    ${recentPosts.map((post, index) => {
      const daysAgo = Math.ceil((Date.now() - post.posted_at.getTime()) / (1000 * 60 * 60 * 24));
      return `Post ${index + 1} (vor ${daysAgo} Tagen): "${post.content}"`;
    }).join('\n\n')}

    AUFGABE: Analysiere diese Posts und identifiziere:
    
    1. **Überstrapazierte Themen** (was wurde zu oft behandelt?)
    2. **Überstrapazierte Strukturen** (gleiche Aufbau-Muster?)
    3. **Überstrapazierte Wörter/Phrasen** (welche Begriffe kommen zu häufig vor?)
    4. **Überstrapazierte Emojis** (welche werden übermäßig verwendet?)
    5. **Zeitliche Lücken** (welche Themen wurden lange nicht behandelt?)
    6. **Stilistische Monotonie** (zu ähnlicher Tonfall?)

    Gib mir dann KONKRETE EMPFEHLUNGEN für einen neuen Post, der:
    - Ein UNTERREPRÄSENTIERTES Thema behandelt
    - Eine ANDERE Struktur/Format hat
    - FRISCHE Begriffe und Emojis verwendet
    - Einen VARIIERENDEN Tonfall hat

    Antworte in diesem Format:
    {
      "avoid_themes": ["Thema 1", "Thema 2"],
      "avoid_structures": ["Struktur 1", "Struktur 2"],
      "avoid_words": ["Wort 1", "Wort 2"],
      "avoid_emojis": ["🚀", "💡"],
      "recommended_theme": "Konkretes neues Thema",
      "recommended_structure": "Neue Post-Struktur",
      "recommended_tone": "Gewünschter Tonfall",
      "fresh_elements": ["Element 1", "Element 2"]
    }
    `;

    logger.info("🤖 Führe Post-Historie-Analyse durch...");
    const analysisResponse = await runAgent(null as any, analysisPrompt);
    
    let guidelines;
    try {
      const responseText = typeof analysisResponse === 'string' ? analysisResponse : JSON.stringify(analysisResponse);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        guidelines = JSON.parse(jsonMatch[0]);
        logger.info("✅ Post-Analyse erfolgreich geparst");
        logger.info(`📋 Zu vermeiden: ${guidelines.avoid_themes?.join(', ')}`);
        logger.info(`🎯 Empfohlenes Thema: ${guidelines.recommended_theme}`);
      } else {
        throw new Error("Keine Guidelines-JSON gefunden");
      }
    } catch (parseError) {
      logger.warn("⚠️ Guidelines-Parsing fehlgeschlagen, verwende Basis-Empfehlungen");
      guidelines = {
        avoid_themes: ["Motivation", "Tips"],
        recommended_theme: "Brancheninsights oder Kundengeschichten",
        recommended_structure: "Frage-Antwort Format",
        recommended_tone: "Authentisch und persönlich"
      };
    }

    const targetedPrompt = `
    Erstelle einen Instagram-Post für eine Social Media Agentur basierend auf dieser strategischen Analyse:

    **VERMEIDE DIESE ÜBERSTRAPAZIERTEN ELEMENTE:**
    - Themen: ${guidelines.avoid_themes?.join(', ') || 'Keine spezifischen'}
    - Strukturen: ${guidelines.avoid_structures?.join(', ') || 'Keine spezifischen'}
    - Wörter: ${guidelines.avoid_words?.join(', ') || 'Keine spezifischen'} 
    - Emojis: ${guidelines.avoid_emojis?.join(', ') || 'Keine spezifischen'}

    **NUTZE DIESE FRISCHEN ANSÄTZE:**
    - Thema: ${guidelines.recommended_theme || 'Unternehmensprozesse oder Kundenerfahrungen'}
    - Struktur: ${guidelines.recommended_structure || 'Storytelling oder persönliche Anekdote'}
    - Tonfall: ${guidelines.recommended_tone || 'Ehrlich und bodenständig'}
    - Frische Elemente: ${guidelines.fresh_elements?.join(', ') || 'Neue Perspektiven'}

    **ANFORDERUNGEN:**
    - 300-450 Zeichen für Instagram
    - Professionell aber authentisch
    - Deutsch
    - Echter Mehrwert für die Community
    - Komplett anders als die analysierten Posts
    - Call-to-Action in Form einer Frage oder Diskussionsanstoß

    **BEISPIEL-THEMEN (falls du Inspiration brauchst):**
    - Wie sich die Agentur-Landschaft verändert
    - Lustige Kundenanfragen und was wir daraus lernen
    - Warum manche Kampagnen scheitern (ehrlich)
    - Behind-the-scenes von Projekt-Challenges
    - Wie AI unser Daily Business verändert
    - Was Kunden wirklich wollen vs. was sie sagen

    Antworte nur mit dem fertigen Instagram-Post Text, keine Erklärungen.
    `;

    logger.info("🎨 Generiere gezielten Post basierend auf Historie-Analyse...");
    const targetedPostResponse = await runAgent(null as any, targetedPrompt);
    const postContent = parseSimpleResponse(targetedPostResponse);

    const imagePath = await ensureImageExists(postContent);

    const contentHash = crypto.createHash('md5').update(postContent).digest('hex');
    const exactDuplicate = await Post.findOne({ content_hash: contentHash });
    
    if (exactDuplicate) {
      logger.warn("❌ Trotz Analyse wurde exakter Duplikat generiert - verwende Backup");
      const backupContent = generateEmergencyPost();
      const backupImagePath = await ensureImageExists(backupContent);
      return { content: backupContent, imagePath: backupImagePath };
    }

    logger.info("✅ Einzigartiger, auf Historie-basierter Post generiert");
    logger.info(`📝 Neuer Post (${postContent.length} Zeichen): "${postContent.substring(0, 100)}..."`);
    
    return { content: postContent, imagePath };

  } catch (error) {
    logger.error("❌ Historie-basierte Generierung fehlgeschlagen:", error);
    
    const emergencyContent = generateEmergencyPost();
    const emergencyImagePath = await ensureImageExists(emergencyContent);
    
    return { content: emergencyContent, imagePath: emergencyImagePath };
  }
}

async function debugPostStructure(page: any, maxPosts: number = 2): Promise<void> {
  logger.info("🔍 DEBUG: Analysiere Post-Struktur...");
  
  for (let i = 1; i <= maxPosts; i++) {
    const postSelector = `article:nth-of-type(${i})`;
    
    if (!(await page.$(postSelector))) {
      logger.info(`DEBUG: Post ${i} nicht gefunden`);
      break;
    }
    
    logger.info(`\n=== POST ${i} DEBUG ===`);
    
    const linkAnalysis = await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) return { error: 'Post not found' };
      
      const links = Array.from(post.querySelectorAll('a')).map((a, idx) => ({
        index: idx,
        href: a.getAttribute('href'),
        text: a.textContent?.trim() || '',
        role: a.getAttribute('role'),
        hasSpanWithDirAuto: !!a.querySelector('span[dir="auto"]')
      })).filter(link => link.href || link.text);
      
      return { links, totalLinks: links.length };
    }, postSelector);
    
    logger.info(`Post ${i} Links:`, JSON.stringify(linkAnalysis, null, 2));
    
    const author = await getPostAuthor(page, postSelector);
    const isOwn = await isOwnPost(page, postSelector);
    
    logger.info(`ERGEBNIS Post ${i}:`);
    logger.info(`  - Author: "${author}"`);
    logger.info(`  - Is Own: ${isOwn}`);
    logger.info(`  - Own Username: "${process.env.IGclearusername}"`);
    logger.info("---");
  }
}

async function getPostUrl(page: any, postSelector: string): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) return '';
      
      const linkSelectors = [
        'header a[href*="/p/"]',
        'a[href*="/p/"]',
        'time a',
        'article a[href*="/p/"]'
      ];
      
      for (const linkSelector of linkSelectors) {
        const linkElement = post.querySelector(linkSelector);
        if (linkElement && linkElement.getAttribute('href')) {
          const href = linkElement.getAttribute('href');
          if (href && href.includes('/p/')) {
            return `https://www.instagram.com${href}`;
          }
        }
      }
      
      return `https://www.instagram.com/p/unknown_${Date.now()}`;
    }, postSelector);
  } catch (error) {
    logger.error("Fehler beim Extrahieren der Post-URL:", error);
    return `https://www.instagram.com/p/error_${Date.now()}`;
  }
}

async function saveCommentToDatabase(
  postId: string, 
  postUrl: string, 
  caption: string, 
  author: string, 
  commentText: string, 
  isOwn: boolean = false
): Promise<void> {
  try {
    const commentHash = crypto.createHash('md5').update(commentText).digest('hex');
    
    const comment = new Comment({
      post_id: postId,
      post_url: postUrl,
      post_caption: caption.substring(0, 500),
      post_author: author,
      comment_text: commentText,
      comment_hash: commentHash,
      commented_at: new Date(),
      success: true,
      is_own_post: isOwn
    });
    
    await comment.save();
    
    logger.info(`✅ Kommentar in MongoDB gespeichert:`);
    logger.info(`📝 Post-Author: ${author}`);
    logger.info(`💬 Kommentar: "${commentText}"`);
    logger.info(`🔗 Post-URL: ${postUrl}`);
    logger.info(`🆔 Post-ID: ${postId.substring(0, 12)}...`);
    
  } catch (error) {
    logger.error("❌ MongoDB-Kommentar-Speicherung fehlgeschlagen:", error);
  }
}

async function runInstagram() {
    const server = new Server({ port: 8000 });
    await server.listen();
    const proxyUrl = `http://localhost:8000`;
    const browser = await puppeteer.launch({
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        headless: true,                      
        args: [
            `--proxy-server=${proxyUrl}`,     
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--no-zygote",
        ],
    });

    const page = await browser.newPage();
    const cookiesPath = "/persistent/Instagramcookies.json";

    const checkCookies = await Instagram_cookiesExist();
    logger.info(`Checking cookies existence: ${checkCookies}`);

    if (checkCookies) {
        const cookies = await loadCookies(cookiesPath);
        await page.setCookie(...cookies);
        logger.info('Cookies loaded and set on the page.');

        await page.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });

        const isLoggedIn = await page.$("a[href='/direct/inbox/']");
        if (isLoggedIn) {
            logger.info("Login verified with cookies.");
            logger.info(`🔍 DEIN USERNAME für Own-Post Detection: "${process.env.IGclearusername}"`);
        } else {
            logger.warn("Cookies invalid or expired. Logging in again...");
            await loginWithCredentials(page, browser);
        }
    } else {
        await loginWithCredentials(page, browser);
    }

    await page.screenshot({ path: "logged_in.png" });
    await page.goto("https://www.instagram.com/");

    logger.info("🔍 Teste Author-Erkennung nach Login...");
    await debugPostStructure(page, 2);
    
    logger.info(`🔍 Eigener Username: "${process.env.IGclearusername}"`);

    // 🧪 TEST-MODUS: 5 Minuten (NUR ZUM TESTEN!)
    // ⚠️ FÜR PRODUCTION: Auf mindestens 30 Minuten ändern!
    const POST_INTERVAL = process.env.TEST_MODE === 'true' ? 5 * 60 * 1000 : 30 * 60 * 1000;
    logger.info(`📅 Post-Intervall: ${POST_INTERVAL / (60 * 1000)} Minuten`);
    
    setInterval(async () => {
        if (systemBusy || isPosting || isCommenting) {
            logger.info("🚫 Post-Timer: System busy - überspringe diesen Zyklus");
            return;
        }
        
        logger.info("✅ Post-Timer: System frei - starte Post-Prozess");
        await safePostJoke(page);
    }, POST_INTERVAL);

    // Warte 5 Minuten bevor Kommentieren/Liken startet
    logger.info("Warte 5 Minuten bevor Like/Comment-Aktivität startet...");
    await delay(5 * 60 * 1000);
    logger.info("Starte jetzt Like/Comment-Aktivität...");

    // 💬 SICHERE HAUPT-LOOP mit Konflikte-Vermeidung
    while (true) {
        await safeInteractWithPosts(page);

        logger.info("Iteration complete, waiting 30 seconds before refreshing …");
        await delay(30_000);

        if (!isPosting && !systemBusy) {
            try {
                await page.reload({ waitUntil: "networkidle2" });
            } catch (e) {
                logger.warn("Error reloading page, continuing iteration: " + e);
            }
        } else {
            logger.info("⏸️ Reload übersprungen - System busy");
        }
    }
}

const loginWithCredentials = async (page: any, browser: Browser) => {
    try {
        await page.goto("https://www.instagram.com/accounts/login/");
        await page.waitForSelector('input[name="username"]');

        await page.type('input[name="username"]', IGusername);
        await page.type('input[name="password"]', IGpassword);
        await page.click('button[type="submit"]');

        await page.waitForNavigation();

        const cookies = await browser.cookies();
        await saveCookies("/persistent/Instagramcookies.json", cookies);
    } catch (error) {
        logger.error("Error logging in with credentials:");
    }
}

async function interactWithPosts(page: any) {
    let postIndex = 1;
    const maxPosts = 50;

    while (postIndex <= maxPosts) {
        // 🔒 SOFORTIGER AUSSTIEG bei Post-Start
        if (isPosting || systemBusy) {
            logger.info("🚫 SOFORTIGER STOPP: Posting läuft - beende Kommentar-Loop");
            isCommenting = false;
            return;
        }

        try {
            const postSelector = `article:nth-of-type(${postIndex})`;

            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Ending iteration...");
                return;
            }

            if (isPosting || systemBusy) {
                logger.info("🚫 System wurde während Post-Verarbeitung busy - SOFORTIGER AUSSTIEG");
                isCommenting = false;
                return;
            }

            // 1. Extrahiere Post-Daten
            const postAuthor = await getPostAuthor(page, postSelector);
            
            if (isPosting || systemBusy) {
                logger.info("🚫 System busy während Author-Extraktion - AUSSTIEG");
                isCommenting = false;
                return;
            }
            
            const postUrl = await getPostUrl(page, postSelector);
            
            // 🔧 KORRIGIERTE Caption-Extraktion
            let caption = "";
            try {
                const captionSelectors = [
                    `${postSelector} span[dir="auto"]`,
                    `${postSelector} article span`,
                    `${postSelector} div[data-testid="post-text"]`
                ];
                
                for (const captionSel of captionSelectors) {
                    try {
                        const captionElements = await page.$$(captionSel);
                        
                        // 🔧 KRITISCHER FIX: Prüfe ob Array vorhanden ist
                        if (!captionElements || captionElements.length === 0) {
                            console.log(`No elements found for selector: ${captionSel}`);
                            continue;
                        }
                        
                        for (const element of captionElements) {
                            if (!element) continue;
                            
                            try {
                                const text = await element.evaluate((el: HTMLElement) => {
                                    if (!el || !el.innerText) return '';
                                    
                                    const innerText = el.innerText.trim();
                                    
                                    // Filter UI-Elemente
                                    if (innerText.includes('Für dich vorgeschlagen') ||
                                        innerText.includes('Gefällt') ||
                                        innerText.includes('Kommentare') ||
                                        innerText.includes('Teilen') ||
                                        innerText === '•' ||
                                        innerText.match(/^\d+\s+(Std|Tag|Tage|h|m)/) ||
                                        innerText.length < 15) {
                                        return '';
                                    }
                                    
                                    return innerText;
                                });
                                
                                if (text && text.length > 15 && text.length > caption.length) {
                                    caption = text;
                                    console.log(`Caption found: ${text.substring(0, 100)}...`);
                                }
                            } catch (evalError: any) {
                                console.log(`Element evaluation error: ${evalError?.message || evalError}`);
                                continue;
                            }
                        }
                        
                        if (caption && caption.length > 15) break;
                        
                    } catch (selectorError: any) {
                        console.log(`Selector error for ${captionSel}: ${selectorError?.message || selectorError}`);
                        continue;
                    }
                }
                
                // Fallback wenn keine Caption gefunden
                if (!caption || caption.length < 15) {
                    caption = `Post ${postIndex} by ${postAuthor} - analyzing content`;
                    console.log(`Using fallback caption for post ${postIndex}`);
                }
                
            } catch (captionError: any) {
                console.log(`Caption extraction error for post ${postIndex}: ${captionError?.message || captionError}`);
                caption = `Post ${postIndex} - caption extraction failed`;
            }

  

            if (isPosting || systemBusy) {
                logger.info("🚫 System busy während Caption-Extraktion - AUSSTIEG");
                isCommenting = false;
                return;
            }

            // 🔧 KORRIGIERTE "Mehr anzeigen" Logik
            try {
                const moreLinkSelectors = [
                    `${postSelector} span._ap3a span div span.x1lliihq`,
                    `${postSelector} button[aria-label*="mehr"]`,
                    `${postSelector} span[role="button"]`,
                    `${postSelector} .x9f619 span._ap3a`
                ];
                
                for (const moreLinkSel of moreLinkSelectors) {
                    const moreLink = await page.$(moreLinkSel);
                    if (moreLink) {
                        const linkText = await moreLink.evaluate((el: HTMLElement) => el.textContent?.trim() || '');
                        if (linkText.includes('mehr') || linkText.includes('...')) {
                            console.log(`Expanding caption for post ${postIndex}...`);
                            await moreLink.click();
                            await delay(1000);
                            
                            // Caption neu extrahieren nach Expansion
                            const expandedElement = await page.$(`${postSelector} span[dir="auto"]`);
                            if (expandedElement) {
                                const expandedCaption = await expandedElement.evaluate((el: HTMLElement) => el.innerText?.trim() || '');
                                if (expandedCaption && expandedCaption.length > caption.length) {
                                    caption = expandedCaption;
                                    console.log(`Expanded Caption for post ${postIndex}: ${expandedCaption.substring(0, 100)}...`);
                                }
                            }
                            break;
                        }
                    }
                }
            } catch (expandError) {
                console.log(`Error expanding caption for post ${postIndex}:`, expandError);
            }

            const postId = generatePostId(caption, postIndex, postAuthor);

            // 3. Prüfe ob es ein eigener Post ist
            const isOwn = await isOwnPost(page, postSelector);
            if (isOwn) {
                logger.info(`⏭️ Überspringe eigenen Post ${postIndex} von ${postAuthor}`);
                
                if (!isPosting && !systemBusy) {
                    await performLikeAction(page, postSelector, postIndex);
                }

                postIndex++;
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                continue;
            }

            // 4. Prüfe ob bereits kommentiert
            const alreadyCommented = await hasAlreadyCommented(postId);
            if (alreadyCommented) {
                logger.info(`⏭️ Post ${postIndex} bereits kommentiert (${postAuthor}) - überspringe`);
                
                if (!isPosting && !systemBusy) {
                    await performLikeAction(page, postSelector, postIndex);
                }

                postIndex++;
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                continue;
            }

            // 5. LIKE LOGIC - ausgelagert in eigene Funktion
            if (!isPosting && !systemBusy) {
                await performLikeAction(page, postSelector, postIndex);
            }

            // 6. COMMENT LOGIC - korrigiert und vereinfacht
            if (!isPosting && !systemBusy) {
                const commentSuccess = await performCommentAction(page, postSelector, postIndex, postId, postUrl, caption, postAuthor);
                
                if (commentSuccess) {
                    logger.info(`✅ Kommentar erfolgreich gepostet für Post ${postIndex}`);
                } else {
                    logger.warn(`⚠️ Kommentar fehlgeschlagen für Post ${postIndex}`);
                }
            } else {
                logger.info(`⏸️ Überspringe Kommentar für Post ${postIndex} - System busy`);
            }

            if (isPosting || systemBusy) {
                logger.info("🚫 System busy vor Wait - SOFORTIGER AUSSTIEG");
                isCommenting = false;
                return;
            }

            // Wait before moving to the next post
            const baseDelay = 180_000;                     
            const jitter = Math.floor(Math.random() * 30_000); 
            const waitTime = baseDelay + jitter;
            console.log(`Waiting ${waitTime / 1000} seconds before moving to the next post...`);
            
            const chunkSize = 10_000;
            const chunks = Math.ceil(waitTime / chunkSize);
            
            for (let i = 0; i < chunks; i++) {
                if (isPosting || systemBusy) {
                    logger.info("🚫 System busy während Wait - SOFORTIGER AUSSTIEG");
                    isCommenting = false;
                    return;
                }
                
                const currentChunkTime = Math.min(chunkSize, waitTime - (i * chunkSize));
                await delay(currentChunkTime);
            }

            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            postIndex++;
            
        } catch (error) {
            console.error(`Error interacting with post ${postIndex}:`, error);
            
            try {
                await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                postIndex++;
            } catch (scrollError) {
                console.error("Error scrolling to next post:", scrollError);
                break;
            }
        }
    }
}

// 🔧 NEUE HILFSFUNKTION: Like-Action ausgelagert
async function performLikeAction(page: any, postSelector: string, postIndex: number): Promise<void> {
    try {
        const likeButtonSelectors = [
            `${postSelector} svg[aria-label="Like"]`,
            `${postSelector} svg[aria-label*="Like"]`, 
            `${postSelector} svg[aria-label="Gefällt mir"]`,
            `${postSelector} button svg[aria-label*="Like"]`,
            `${postSelector} div[role="button"] svg[aria-label*="Like"]`,
            `${postSelector} [data-testid="like-button"]`
        ];
        
        let likeButtonFound = false;
        
        for (const selector of likeButtonSelectors) {
            const likeButton = await page.$(selector);
            if (likeButton) {
                const ariaLabel = await likeButton.evaluate((el: Element) =>
                    el.getAttribute("aria-label")
                );
                
                console.log(`Found like button with selector: ${selector}, aria-label: ${ariaLabel}`);
                
                if (ariaLabel === "Like" || ariaLabel === "Gefällt mir") {
                    console.log(`Liking post ${postIndex}...`);
                    await likeButton.click();
                    console.log(`Post ${postIndex} liked.`);
                    likeButtonFound = true;
                    break;
                } else if (ariaLabel?.includes("Unlike") || ariaLabel?.includes("Gefällt mir nicht mehr")) {
                    console.log(`Post ${postIndex} is already liked.`);
                    likeButtonFound = true;
                    break;
                }
            }
        }
        
        if (!likeButtonFound) {
            console.log(`Like button not found for post ${postIndex} - trying alternative approach.`);
            
            const heartIcon = await page.evaluate((selector: string) => {
                const post = document.querySelector(selector);
                if (!post) return false;
                
                const heartSelectors = [
                    'svg path[d*="M16.792 3.904"]',
                    'svg[aria-label*="Like"]',
                    'button[type="button"] svg'
                ];
                
                for (const heartSel of heartSelectors) {
                    const heart = post.querySelector(heartSel);
                    if (heart) {
                        const button = heart.closest('button') || heart.closest('div[role="button"]');
                        if (button) {
                            (button as HTMLElement).click();
                            return true;
                        }
                    }
                }
                return false;
            }, postSelector);
            
            if (heartIcon) {
                console.log(`Post ${postIndex} liked via heart icon.`);
            } else {
                console.log(`Could not find any like button for post ${postIndex}.`);
            }
        }
    } catch (likeError) {
        console.log(`Error liking post ${postIndex}:`, likeError);
    }
}

// 🔧 NEUE HILFSFUNKTION: Comment-Action ausgelagert und korrigiert
async function performCommentAction(
    page: any, 
    postSelector: string, 
    postIndex: number, 
    postId: string, 
    postUrl: string, 
    caption: string, 
    postAuthor: string
): Promise<boolean> {
    try {
        console.log(`\n🔍 DEBUG: Starte Kommentar-Prozess für Post ${postIndex}`);
        
        // 1. Comment Box finden
        const commentBoxSelector = `${postSelector} textarea`;
        const commentBox = await page.$(commentBoxSelector);
        
        if (!commentBox) {
            console.log(`❌ Comment box not found for post ${postIndex}.`);
            return false;
        }
        console.log(`✅ Comment box gefunden für Post ${postIndex}`);

        logger.info(`💬 Kommentiere neuen Post ${postIndex} von ${postAuthor}...`);
        
        if (isPosting || systemBusy) {
            logger.info("🚫 System busy vor AI-Comment - überspringe");
            return false;
        }
        
        // 2. AI-Kommentar generieren
        const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". Ensure the reply is relevant, insightful, and adds value to the conversation. It should reflect empathy and professionalism, and avoid sounding too casual or superficial. also it should be 300 characters or less. and it should not go against instagram Community Standards on spam. so you will have to try your best to humanize the reply`;
        const schema = getInstagramCommentSchema();
        
        if (isPosting || systemBusy) {
            logger.info("🚫 System busy vor runAgent - überspringe");
            return false;
        }
        
        console.log(`🤖 Generiere AI-Kommentar für Post ${postIndex}...`);
        const result = await runAgent(schema, prompt);
        const comment = result[0]?.comment;

        if (!comment || isPosting || systemBusy) {
            logger.warn("No comment generated or system became busy, skipping comment.");
            return false;
        }

        console.log(`✅ AI-Kommentar generiert (${comment.length} Zeichen): "${comment}"`);

        // 3. Text in Comment Box eingeben
        console.log(`⌨️ Gebe Text in Comment-Box ein...`);
        await commentBox.click(); // Stelle sicher, dass Box fokussiert ist
        await delay(500);
        
        await commentBox.type(comment);
        await delay(2000); // Längere Wartezeit
        
        // 4. Prüfe ob Text wirklich eingegeben wurde
        const inputValue = await commentBox.evaluate((el: HTMLTextAreaElement) => el.value);
        console.log(`🔍 Text in Box: "${inputValue}" (${inputValue.length} Zeichen)`);
        
        if (!inputValue || inputValue.length === 0) {
            console.log(`❌ Kein Text in Comment-Box - Abbruch`);
            return false;
        }

        // 5. Screenshot vor Post-Button Klick
        await page.screenshot({ path: `debug_before_post_${postIndex}.png` });
        console.log(`📸 Screenshot erstellt: debug_before_post_${postIndex}.png`);

        // 6. Post-Button finden und klicken - ERWEITERTE DEBUG-VERSION
        console.log(`🔍 Suche Post-Button für Post ${postIndex}...`);
        
        const postButtonInfo = await page.evaluate(() => {
            const buttonSelectors = [
                'div[role="button"]',
                'button[type="button"]', 
                'button',
                '[data-testid="post-button"]',
                '[aria-label*="Post"]',
                '[aria-label*="Posten"]'
            ];
            
            const allButtons: any[] = [];
            
            for (const btnSelector of buttonSelectors) {
                const buttons = Array.from(document.querySelectorAll(btnSelector));
                buttons.forEach((button, index) => {
                    const text = button.textContent?.trim().toLowerCase() || '';
                    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
                    const disabled = button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true';
                    const visible = (button as HTMLElement).offsetParent !== null;
                    
                    allButtons.push({
                        selector: btnSelector,
                        index: index,
                        text: text,
                        ariaLabel: ariaLabel,
                        disabled: disabled,
                        visible: visible,
                        isPostButton: (text === 'post' || text === 'posten' || text === 'teilen' || text === 'share' || ariaLabel?.includes('post') || ariaLabel?.includes('posten')) && !disabled && visible
                    });
                });
            }
            
            return allButtons;
        });

        console.log(`🔍 Gefundene Buttons:`, JSON.stringify(postButtonInfo, null, 2));
        
        const validPostButtons = postButtonInfo.filter((btn: any) => btn.isPostButton);
        console.log(`✅ Valide Post-Buttons gefunden: ${validPostButtons.length}`);

        if (validPostButtons.length === 0) {
            console.log(`❌ Kein Post-Button gefunden für Post ${postIndex}`);
            return false;
        }

        // 7. Klicke den ersten validen Post-Button
        const postButtonFound = await page.evaluate(() => {
            const buttonSelectors = [
                'div[role="button"]',
                'button[type="button"]', 
                'button',
                '[data-testid="post-button"]',
                '[aria-label*="Post"]',
                '[aria-label*="Posten"]'
            ];
            
            for (const btnSelector of buttonSelectors) {
                const buttons = Array.from(document.querySelectorAll(btnSelector));
                const postButton = buttons.find(button => {
                    const text = button.textContent?.trim().toLowerCase();
                    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase();
                    
                    return (text === 'post' || 
                            text === 'posten' || 
                            text === 'teilen' ||
                            text === 'share' ||
                            ariaLabel?.includes('post') ||
                            ariaLabel?.includes('posten')) &&
                           !button.hasAttribute('disabled') &&
                           button.getAttribute('aria-disabled') !== 'true' &&
                           (button as HTMLElement).offsetParent !== null;
                }) as HTMLElement;
                
                if (postButton) {
                    console.log(`🔘 Klicke Post-Button: "${postButton.textContent}"`);
                    postButton.click();
                    return { found: true, text: postButton.textContent };
                }
            }
            
            return { found: false, text: null };
        });

        console.log(`🔘 Post-Button Klick-Result:`, postButtonFound);

        if (!postButtonFound.found) {
            console.log(`❌ Post-Button konnte nicht geklickt werden für Post ${postIndex}`);
            return false;
        }

        // 8. Warte und prüfe ob Kommentar wirklich gepostet wurde
        console.log(`⏳ Warte auf Kommentar-Verarbeitung...`);
        await delay(3000);
        
        // 9. Screenshot nach Post-Button Klick
        await page.screenshot({ path: `debug_after_post_${postIndex}.png` });
        console.log(`📸 Screenshot erstellt: debug_after_post_${postIndex}.png`);

        // 10. Prüfe ob Comment-Box geleert wurde (Indikator für erfolgreichen Post)
        const finalInputValue = await commentBox.evaluate((el: HTMLTextAreaElement) => el.value).catch(() => '');
        console.log(`🔍 Comment-Box nach Post: "${finalInputValue}"`);

        if (finalInputValue.length === 0) {
            console.log(`✅ Comment-Box wurde geleert - Kommentar wahrscheinlich erfolgreich`);
        } else {
            console.log(`⚠️ Comment-Box noch gefüllt - Kommentar möglicherweise NICHT gepostet`);
        }

        if (postButtonFound.found && !isPosting && !systemBusy) {
            console.log(`✅ Post-Prozess abgeschlossen für Post ${postIndex}`);
            
            await saveCommentToDatabase(postId, postUrl, caption, postAuthor, comment, false);
            return true;
        } else {
            console.log(`❌ Post-Prozess fehlgeschlagen für Post ${postIndex}`);
            return false;
        }
        
    } catch (commentError: any) {
        console.error(`❌ Error commenting on post ${postIndex}:`, commentError?.message || commentError);
        return false;
    }
}

export { runInstagram };
