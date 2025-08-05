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
let isPosting = false;        // Post-Funktion läuft
let isCommenting = false;     // Kommentar-Funktion läuft  
let systemBusy = false;       // Allgemeiner Busy-Flag



const Post = mongoose.models.Post || mongoose.model('Post', PostSchema);

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// 🔒 SICHERER POSTING-WRAPPER
async function safePostJoke(page: any): Promise<void> {
  // ✅ LOCKS SOFORT SETZEN - VOR ALLEM ANDEREN!
  if (systemBusy || isPosting || isCommenting) {
    logger.info("🚫 System busy - Post verschoben");
    return;
  }

  // Setze alle Locks SOFORT
  isPosting = true;
  systemBusy = true;
  logger.info("🔒 Posting-Locks gesetzt - alle anderen Aktivitäten pausiert");
  
  // Unterbreche Kommentar-Loop falls läuft
  if (isCommenting) {
    logger.info("⏸️ Pausiere Kommentieren für Post...");
    isCommenting = false;
    await delay(3000); // Etwas länger warten bis Kommentar-Loop sicher beendet
  }

  try {
    logger.info("🚀 Starte sicheren Post-Prozess...");
    
    // Stelle sicher dass wir auf der Hauptseite sind
    const currentUrl = page.url();
    if (!currentUrl.includes('instagram.com') || currentUrl.includes('/p/') || currentUrl.includes('create')) {
      logger.info("📍 Navigiere zur Instagram-Hauptseite vor Post...");
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await delay(3000);
    }
    
    await postJoke(page);
    
    logger.info("✅ Post erfolgreich - kehre zum Feed zurück");
    
    // Zurück zum Feed für Kommentieren
    await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await delay(5000); // Etwas länger warten damit Feed lädt
    
  } catch (error) {
    logger.error("❌ Post-Fehler:", error);
    
    // Bei Fehler: Versuche zum Feed zurückzukehren
    try {
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await delay(3000);
    } catch (navError) {
      logger.error("❌ Navigation nach Post-Fehler fehlgeschlagen:", navError);
    }
  } finally {
    // Locks freigeben
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
    // Stelle sicher dass wir im Feed sind
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

// Generiere eindeutige Post-ID basierend auf Post-Inhalt und Position
function generatePostId(caption: string, postIndex: number, author: string): string {
  const content = `${caption}_${postIndex}_${author}`.substring(0, 100);
  return crypto.createHash('md5').update(content).digest('hex');
}

// Prüfe ob bereits zu diesem Post kommentiert wurde
async function hasAlreadyCommented(postId: string): Promise<boolean> {
  try {
    const existingComment = await Comment.findOne({ post_id: postId });
    return !!existingComment;
  } catch (error) {
    logger.error("Fehler bei Kommentar-Duplikat-Check:", error);
    return false;
  }
}


// 🎯 ROBUSTE Author-Extraktion ohne spezifische CSS-Klassen
async function getPostAuthor(page: any, postSelector: string): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) {
        console.log(`DEBUG: Post not found with selector: ${selector}`);
        return 'unknown';
      }
      
      // 🔍 HREF-BASIERTE STRATEGIE (viel robuster)
      // Suche nach Links die auf Profile zeigen: /username/
      const profileLinks = post.querySelectorAll('a[href^="/"][href$="/"], a[href^="/"][href*="/?"]');
      
      console.log(`DEBUG: Found ${profileLinks.length} potential profile links`);
      
      for (let i = 0; i < profileLinks.length; i++) {
        const link = profileLinks[i];
        const href = link.getAttribute('href');
        
        if (href) {
          console.log(`DEBUG: Checking link ${i+1}: ${href}`);
          
          // Extrahiere Username aus href
          let username = '';
          
          // Pattern 1: /username/ oder /username/?param=value
          const match = href.match(/^\/([^\/\?]+)(?:\/|\?|$)/);
          if (match && match[1]) {
            username = match[1];
            
            console.log(`DEBUG: Extracted username from href: "${username}"`);
            
            // ✅ VALIDIERUNG: Ist das ein gültiger Instagram-Username?
            if (username && 
                username.length > 0 && 
                username.length <= 30 &&
                username !== 'p' && // Post-Links /p/xyz ausschließen
                username !== 'reel' &&
                username !== 'reels' &&
                username !== 'tv' &&
                username !== 'stories' &&
                username !== 'explore' &&
                username !== 'accounts' &&
                username !== 'direct' &&
                !username.includes('audio') && // /reels/audio/xyz
                !username.includes('hashtag') &&
                !username.match(/^\d+$/) && // Nicht nur Zahlen
                username.match(/^[a-zA-Z0-9._]+$/)) { // Nur gültige Instagram-Zeichen
                
                // ZUSÄTZLICH: Prüfe ob das Link-Element Text enthält (nicht nur Icon)
                const linkText = link.textContent?.trim() || '';
                const hasText = linkText.length > 0 && 
                               linkText !== '•' && 
                               !linkText.includes('Std.') &&
                               !linkText.includes('Tag') &&
                               !linkText.includes('Original-Audio') &&
                               !linkText.match(/^\d+\s+(Std|Tag|Tage)\.?$/);
                
                console.log(`DEBUG: Link text: "${linkText}", hasValidText: ${hasText}`);
                
                if (hasText) {
                  console.log(`DEBUG: ✅ VALID USERNAME FOUND: "${username}" from href: ${href}`);
                  return username;
                }
            } else {
              console.log(`DEBUG: ❌ Invalid username: "${username}" from href: ${href}`);
            }
          }
        }
      }
       // 🔍 FALLBACK: Suche nach span[dir="auto"] mit vernünftigem Text
      const dirAutoSpans = post.querySelectorAll('span[dir="auto"]');
      console.log(`DEBUG: Found ${dirAutoSpans.length} span[dir="auto"] elements`);
      
      for (let i = 0; i < dirAutoSpans.length; i++) {
        const span = dirAutoSpans[i];
        const text = span.textContent?.trim() || '';
        
        console.log(`DEBUG: span[dir="auto"] ${i+1}: "${text}"`);
        
        if (text && 
            text.length > 0 && 
            text.length <= 30 &&
            !text.includes('•') &&
            !text.includes('und') &&
            !text.includes('and') &&
            !text.includes('Std.') &&
            !text.includes('Tag') &&
            !text.includes('Original-Audio') &&
            !text.match(/^\d+\s+(Std|Tag|Tage)\.?$/i) &&
            text.match(/^[a-zA-Z0-9._]+$/)) {
          
          console.log(`DEBUG: ✅ VALID USERNAME from span: "${text}"`);
          return text;
        }
      }
      
      // 🔍 LETZTE CHANCE: Alle <a> Tags mit Text durchsuchen
      const allLinks = post.querySelectorAll('a');
      console.log(`DEBUG: Checking all ${allLinks.length} links for username text`);
      
      for (const link of allLinks) {
        const text = link.textContent?.trim() || '';
        
        if (text && 
            text.length > 0 && 
            text.length <= 30 &&
            !text.includes('•') &&
            !text.includes('und') &&
            !text.includes('and') &&
            !text.includes('Std.') &&
            !text.includes('Tag') &&
            !text.includes('Original-Audio') &&
            !text.match(/^\d+\s+(Std|Tag|Tage)\.?$/i) &&
            text.match(/^[a-zA-Z0-9._]+$/)) {
          
          console.log(`DEBUG: ✅ VALID USERNAME from link text: "${text}"`);
          return text;
        }
      }
      
      console.log('DEBUG: No valid username found, returning unknown');
      return 'unknown';
    }, postSelector);
  } catch (error) {
    logger.error("Fehler beim Extrahieren des Post-Authors:", error);
    return 'unknown';
  }
}

// Vereinfachte Own-Post Erkennung
function isOwnPost(page: any, postSelector: string): Promise<boolean> {
  // ✅ WICHTIG: Hole Username AUSSERHALB des Browser-Contexts
  const ownUsername = process.env.IGclearusername || 'fallback_username';
  
  return page.evaluate((selector: string, ownUsernameParam: string) => {
    console.log(`DEBUG: Own username from param: "${ownUsernameParam}"`);
    
    const post = document.querySelector(selector);
    if (!post) {
      console.log(`DEBUG: Post not found for own-post check: ${selector}`);
      return false;
    }
    
    // 🔍 HREF-BASIERTE STRATEGIE
    const profileLinks = post.querySelectorAll('a[href^="/"][href$="/"], a[href^="/"][href*="/?"]');
    
    for (const link of profileLinks) {
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
              !username.match(/^\d+$/) &&
              username.match(/^[a-zA-Z0-9._]+$/)) {
            
            console.log(`DEBUG: Comparing "${username}" with own "${ownUsernameParam}"`);
            
            if (username === ownUsernameParam) {
              console.log(`DEBUG: ✅ MATCH! This is own post`);
              return true;
            }
          }
        }
      }
    }
    
    // 🔍 FALLBACK: Textbasierte Suche
    const allLinks = post.querySelectorAll('a');
    for (const link of allLinks) {
      const text = link.textContent?.trim() || '';
      
      if (text && 
          text.length > 0 && 
          text.length <= 30 &&
          !text.includes('•') &&
          !text.includes('und') &&
          !text.includes('and') &&
          !text.includes('Std.') &&
          !text.includes('Tag') &&
          !text.includes('Original-Audio') &&
          !text.match(/^\d+\s+(Std|Tag|Tage)\.?$/i) &&
          text.match(/^[a-zA-Z0-9._]+$/)) {
        
        console.log(`DEBUG: Comparing text "${text}" with own "${ownUsernameParam}"`);
        
        if (text === ownUsernameParam) {
          console.log(`DEBUG: ✅ MATCH! This is own post (by text)`);
          return true;
        }
      }
    }
    
    console.log(`DEBUG: ❌ NO MATCH - Not own post`);
    return false;
  }, postSelector, ownUsername); // ✅ Username als Parameter übergeben!
}

function generateEmergencyPost(): string {
  const timestamp = new Date().toISOString().slice(5, 16); // MM-DD HH:MM
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

// 🔧 FIX 2: Robuste parseSimpleResponse mit besserer Fehlerbehandlung
function parseSimpleResponse(response: any): string {
  try {
    // Debug-Log für bessere Analyse
    console.log("AI Response Type:", typeof response);
    console.log("AI Response Value:", JSON.stringify(response));
    
    if (Array.isArray(response)) {
      // ✅ ERWEITERT - alle möglichen Feldnamen:
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
      // ✅ ERWEITERT - alle möglichen Feldnamen:
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
    
    // ✅ BESSERES DEBUGGING:
    console.log("Unerwartetes Datenformat:", JSON.stringify(response));
    
    // ✅ SICHERER ZUGRIFF auf Object.keys - KORRIGIERT
    const responseObj = Array.isArray(response) ? response[0] : response;
    if (responseObj && typeof responseObj === 'object') {
      console.log("Verfügbare Felder:", Object.keys(responseObj));
      
      // ✅ INTELLIGENTER FALLBACK - verwende ersten String-Wert:
      const firstValue = Object.values(responseObj)[0];
      if (typeof firstValue === 'string') {
        console.log("Verwende ersten String-Wert als Fallback:", firstValue.substring(0, 100));
        return firstValue;
      }
    }
    
    // ✅ WENN ALLES FEHLSCHLÄGT: Generiere neuen Post statt Backup
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
    
    // 1. Lade die letzten 50 Posts für umfassende Analyse
    const recentPosts = await Post.find()
      .sort({ posted_at: -1 })
      .limit(50)
      .select('content image_name posted_at post_type');
    
    logger.info(`📊 Gefunden: ${recentPosts.length} Posts für Analyse`);
    
    // 2. Bei wenigen Posts: Vereinfachte Generierung
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
    
    // 3. Bei vielen Posts: Analysiere Patterns
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
    
    // Parse Analysis
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

    // 4. Generiere gezielten Post basierend auf Analyse
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

    // 5. Wähle passendes Bild
    const imagePath = await ensureImageExists(postContent);

    // 6. Final Check - aber nur für exakte Duplikate (nicht AI-Ähnlichkeit)
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
    
    // NOTFALL-GENERIERUNG
    const emergencyContent = generateEmergencyPost();
    const emergencyImagePath = await ensureImageExists(emergencyContent);
    
    return { content: emergencyContent, imagePath: emergencyImagePath };
  }
}


// 🔍 EINFACHE DEBUG-FUNKTION
async function debugPostStructure(page: any, maxPosts: number = 2): Promise<void> {
  logger.info("🔍 DEBUG: Analysiere Post-Struktur...");
  
  for (let i = 1; i <= maxPosts; i++) {
    const postSelector = `article:nth-of-type(${i})`;
    
    if (!(await page.$(postSelector))) {
      logger.info(`DEBUG: Post ${i} nicht gefunden`);
      break;
    }
    
    logger.info(`\n=== POST ${i} DEBUG ===`);
    
    // Analysiere alle Links im Post
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
    
    // Test unsere Funktionen
    const author = await getPostAuthor(page, postSelector);
    const isOwn = await isOwnPost(page, postSelector);
    
    logger.info(`ERGEBNIS Post ${i}:`);
    logger.info(`  - Author: "${author}"`);
    logger.info(`  - Is Own: ${isOwn}`);
    logger.info(`  - Own Username: "${process.env.IGclearusername}"`);
    logger.info("---");
  }
}

// Erweiterte Post-URL Extraktion für bessere Eindeutigkeit
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

// Speichere Kommentar in MongoDB
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
        } else {
            logger.warn("Cookies invalid or expired. Logging in again...");
            await loginWithCredentials(page, browser);
        }
    } else {
        await loginWithCredentials(page, browser);
    }

    await page.screenshot({ path: "logged_in.png" });
    await page.goto("https://www.instagram.com/");

    // ✅ DEBUG: Teste Author-Erkennung sofort nach Login
    logger.info("🔍 Teste Author-Erkennung nach Login...");
    await debugPostStructure(page, 2);
    
    // ✅ DEBUG: Zeige Environment Variable
    logger.info(`🔍 Eigener Username: "${process.env.IGclearusername}"`);

    // 🚀 VERBESSERTER POST-TIMER mit Konflikt-Vermeidung
    setInterval(async () => {
        // Mehrfache Sicherheitschecks
        if (systemBusy || isPosting || isCommenting) {
            logger.info("🚫 Post-Timer: System busy - überspringe diesen Zyklus");
            return;
        }
        
        // Zusätzlicher Check: Ist Kommentar-System gerade aktiv?
        if (isCommenting) {
            logger.info("🚫 Post-Timer: Kommentieren läuft - warte auf nächsten Zyklus");
            return;
        }
        
        logger.info("✅ Post-Timer: System frei - starte Post-Prozess");
        await safePostJoke(page);
    }, 3 * 60 * 1000); // Alle 3 Minuten versuchen

    // Warte 50 Minuten bevor Kommentieren/Liken startet
    logger.info("Warte 50 Minuten bevor Like/Comment-Aktivität startet...");
    await delay(4 * 60 * 1000);
    logger.info("Starte jetzt Like/Comment-Aktivität...");

    // 💬 SICHERE HAUPT-LOOP mit Konflikte-Vermeidung
    while (true) {
        // Sichere Kommentar-Funktion verwenden
        await safeInteractWithPosts(page);

        logger.info("Iteration complete, waiting 30 seconds before refreshing …");
        await delay(30_000);

        // Nur reloaden wenn kein Post läuft
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
            isCommenting = false; // Setz Flag zurück
            return; // Sofort beenden, nicht continue!
        }

        try {
            const postSelector = `article:nth-of-type(${postIndex})`;

            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Ending iteration...");
                return;
            }

            // 🔒 KONTINUIERLICHER CHECK in kürzeren Abständen
            if (isPosting || systemBusy) {
                logger.info("🚫 System wurde während Post-Verarbeitung busy - SOFORTIGER AUSSTIEG");
                isCommenting = false;
                return;
            }

            // 1. Extrahiere Post-Daten (mit Busy-Check)
            const postAuthor = await getPostAuthor(page, postSelector);
            
            // Zwischencheck
            if (isPosting || systemBusy) {
                logger.info("🚫 System busy während Author-Extraktion - AUSSTIEG");
                isCommenting = false;
                return;
            }
            
            const postUrl = await getPostUrl(page, postSelector);
            
            const captionSelector = `${postSelector} span[dir="auto"], ${postSelector} article span`;
            const captionElement = await page.$(captionSelector);

            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
                console.log(`Caption for post ${postIndex}: ${caption}`);
            } else {
                console.log(`No caption found for post ${postIndex}.`);
            }

            // Zwischencheck vor More-Link
            if (isPosting || systemBusy) {
                logger.info("🚫 System busy während Caption-Extraktion - AUSSTIEG");
                isCommenting = false;
                return;
            }

            const moreLinkSelector = `${postSelector} div.x9f619 span._ap3a span div span.x1lliihq`;
            const moreLink = await page.$(moreLinkSelector);
            if (moreLink) {
                console.log(`Expanding caption for post ${postIndex}...`);
                await moreLink.click();
                const expandedCaption = await captionElement.evaluate(
                    (el: HTMLElement) => el.innerText
                );
                console.log(`Expanded Caption for post ${postIndex}: ${expandedCaption}`);
                caption = expandedCaption;
            }

            const postId = generatePostId(caption, postIndex, postAuthor);

            // 3. Prüfe ob es ein eigener Post ist
            const isOwn = await isOwnPost(page, postSelector);
            if (isOwn) {
                logger.info(`⏭️ Überspringe eigenen Post ${postIndex} von ${postAuthor}`);
                
                // Auch bei eigenen Posts: Check vor Like
                if (!isPosting && !systemBusy) {
                    const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
                    const likeButton = await page.$(likeButtonSelector);
                    const ariaLabel = await likeButton?.evaluate((el: Element) =>
                        el.getAttribute("aria-label")
                    );

                    if (ariaLabel === "Like") {
                        console.log(`Liking own post ${postIndex}...`);
                        await likeButton.click();
                        console.log(`Own post ${postIndex} liked.`);
                    }
                }

                postIndex++;
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight);
                });
                continue;
            }

            // 4. Prüfe ob bereits kommentiert
            const alreadyCommented = await hasAlreadyCommented(postId);
            if (alreadyCommented) {
                logger.info(`⏭️ Post ${postIndex} bereits kommentiert (${postAuthor}) - überspringe`);
                
                // Check vor Like
                if (!isPosting && !systemBusy) {
                    const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
                    const likeButton = await page.$(likeButtonSelector);
                    const ariaLabel = await likeButton?.evaluate((el: Element) =>
                        el.getAttribute("aria-label")
                    );

                    if (ariaLabel === "Like") {
                        console.log(`Liking already commented post ${postIndex}...`);
                        await likeButton.click();
                        console.log(`Post ${postIndex} liked.`);
                    }
                }

                postIndex++;
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight);
                });
                continue;
            }

            // 5. LIKE LOGIC mit Busy-Check
            if (!isPosting && !systemBusy) {
                const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
                const likeButton = await page.$(likeButtonSelector);
                const ariaLabel = await likeButton?.evaluate((el: Element) =>
                    el.getAttribute("aria-label")
                );

                if (ariaLabel === "Like") {
                    console.log(`Liking post ${postIndex}...`);
                    await likeButton.click();
                    console.log(`Post ${postIndex} liked.`);
                } else if (ariaLabel === "Unlike") {
                    console.log(`Post ${postIndex} is already liked.`);
                } else {
                    console.log(`Like button not found for post ${postIndex}.`);
                }
            }

            // 6. COMMENT LOGIC (mit mehrfachen Busy-Checks)
            if (!isPosting && !systemBusy) {
                const commentBoxSelector = `${postSelector} textarea`;
                const commentBox = await page.$(commentBoxSelector);
                if (commentBox) {
                    logger.info(`💬 Kommentiere neuen Post ${postIndex} von ${postAuthor}...`);
                    
                    // Check vor AI-Call
                    if (isPosting || systemBusy) {
                        logger.info("🚫 System busy vor AI-Comment - überspringe");
                        postIndex++;
                        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                        continue;
                    }
                    
                    const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". Ensure the reply is relevant, insightful, and adds value to the conversation. It should reflect empathy and professionalism, and avoid sounding too casual or superficial. also it should be 300 characters or less. and it should not go against instagram Community Standards on spam. so you will have to try your best to humanize the reply`;
                    const schema = getInstagramCommentSchema();
                    
                    // Check vor AI-Call
                    if (isPosting || systemBusy) {
                        logger.info("🚫 System busy vor runAgent - überspringe");
                        postIndex++;
                        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
                        continue;
                    }
                    
                    const result = await runAgent(schema, prompt);
                    const comment = result[0]?.comment;

                    // Triple-Check nach AI-Call
                    if (comment && !isPosting && !systemBusy) {
                        await commentBox.type(comment);

                        const postButton = await page.evaluateHandle(() => {
                            const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
                            return buttons.find(button => button.textContent === 'Post' && !button.hasAttribute('disabled'));
                        });

                        // Final Check vor Post-Button
                        if (postButton && !isPosting && !systemBusy) {
                            console.log(`Posting comment on post ${postIndex}...`);
                            await postButton.click();
                            console.log(`Comment posted on post ${postIndex}.`);
                            
                            await saveCommentToDatabase(postId, postUrl, caption, postAuthor, comment, false);
                            
                        } else {
                            console.log("Post button not found or system became busy.");
                        }
                    } else {
                        logger.warn("No comment generated or system became busy, skipping comment.");
                    }
                } else {
                    console.log("Comment box not found.");
                }
            } else {
                logger.info(`⏸️ Überspringe Kommentar für Post ${postIndex} - System busy`);
            }

            // Final Check vor Wait
            if (isPosting || systemBusy) {
                logger.info("🚫 System busy vor Wait - SOFORTIGER AUSSTIEG");
                isCommenting = false;
                return;
            }

            // Wait before moving to the next post (mit Busy-Checks während Wait)
            const baseDelay = 180_000;                     
            const jitter = Math.floor(Math.random() * 30_000); 
            const waitTime = baseDelay + jitter;
            console.log(`Waiting ${waitTime / 1000} seconds before moving to the next post...`);
            
            // Warte in kleineren Chunks um auf Posting zu reagieren
            const chunkSize = 10_000; // 10s Chunks
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

            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            postIndex++;
        } catch (error) {
            console.error(`Error interacting with post ${postIndex}:`, error);
            
            try {
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight);
                });
                postIndex++;
            } catch (scrollError) {
                console.error("Error scrolling to next post:", scrollError);
                break;
            }
        }
    }
}

export { runInstagram };
