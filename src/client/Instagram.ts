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

let jokeLock = false;

// MongoDB Schema für Kommentare
const CommentSchema = new mongoose.Schema({
  post_id: { type: String, required: true, unique: true }, // Eindeutige Post-ID
  post_url: { type: String, required: true },
  post_caption: { type: String, default: '' },
  post_author: { type: String, default: '' },
  comment_text: { type: String, required: true },
  comment_hash: { type: String, required: true },
  commented_at: { type: Date, default: Date.now },
  success: { type: Boolean, default: true },
  is_own_post: { type: Boolean, default: false }
});

const Comment = mongoose.model('Comment', CommentSchema);

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        // Optionally enable Cooperative Mode for several request interceptors
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
    return false; // Bei Fehler erlaube Kommentar
  }
}

// Prüfe ob es ein eigener Post ist
function isOwnPost(page: any, postSelector: string): Promise<boolean> {
  return page.evaluate((selector: string) => {
    const post = document.querySelector(selector);
    if (!post) return false;
    
    // Suche nach eigenem Username in verschiedenen möglichen Selektoren
    const possibleSelectors = [
      'header a span', // Username im Post-Header
      'header a', // Username-Link
      'div[data-testid="user-avatar"] + div a', // Username neben Avatar
      'article header span a' // Alternativer Username-Selektor
    ];
    
    for (const userSelector of possibleSelectors) {
      const userElement = post.querySelector(userSelector);
      if (userElement && userElement.textContent) {
        const username = userElement.textContent.trim();
        // Username aus Environment Variable laden
        const ownUsername = process.env.IGclearusername || 'fallback_username'; 
        return username === ownUsername;
      }
    }
    
    return false;
  }, postSelector);
}

// Extrahiere Post-Author
async function getPostAuthor(page: any, postSelector: string): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) return 'unknown';
      
      const possibleSelectors = [
        'header a span',
        'header a', 
        'div[data-testid="user-avatar"] + div a',
        'article header span a'
      ];
      
      for (const userSelector of possibleSelectors) {
        const userElement = post.querySelector(userSelector);
        if (userElement && userElement.textContent) {
          return userElement.textContent.trim();
        }
      }
      
      return 'unknown';
    }, postSelector);
  } catch (error) {
    logger.error("Fehler beim Extrahieren des Post-Authors:", error);
    return 'unknown';
  }
}

// Erweiterte Post-URL Extraktion für bessere Eindeutigkeit
async function getPostUrl(page: any, postSelector: string): Promise<string> {
  try {
    return await page.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) return '';
      
      // Suche nach Post-Link (normalerweise Timestamp oder "View Post" Link)
      const linkSelectors = [
        'header a[href*="/p/"]', // Post-Link im Header
        'a[href*="/p/"]', // Beliebiger Post-Link
        'time a', // Timestamp-Link
        'article a[href*="/p/"]' // Post-Link irgendwo im Artikel
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
      post_caption: caption.substring(0, 500), // Begrenzen für DB
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
    // Pfad kommt aus der Render‑Env‑Var
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,                        // strikt headless, Chrome > 118
    args: [
        `--proxy-server=${proxyUrl}`,       // dein Proxy bleibt erhalten
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
    ],
});

    const page = await browser.newPage();
    const cookiesPath = "/persistent/Instagramcookies.json";

    const checkCookies = await Instagram_cookiesExist();   // nutzt Default‑Pfad
    logger.info(`Checking cookies existence: ${checkCookies}`);

    if (checkCookies) {
        const cookies = await loadCookies(cookiesPath);
        await page.setCookie(...cookies);
        logger.info('Cookies loaded and set on the page.');

        // Navigate to Instagram to verify if cookies are valid
        await page.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });

        // Check if login was successful by verifying page content (e.g., user profile or feed)
        const isLoggedIn = await page.$("a[href='/direct/inbox/']");
        if (isLoggedIn) {
            logger.info("Login verified with cookies.");
        } else {
            logger.warn("Cookies invalid or expired. Logging in again...");
            await loginWithCredentials(page, browser);
        }
    } else {
        // If no cookies are available, perform login with credentials
        await loginWithCredentials(page, browser);
    }

    // Optionally take a screenshot after loading the page
    await page.screenshot({ path: "logged_in.png" });

    // Navigate to the Instagram homepage
    await page.goto("https://www.instagram.com/");

    // nach dem Login‑Block, vor der while(true)‑Like‑Schleife
    setInterval(async () => {
      if (jokeLock) return;          // schon in Arbeit
      jokeLock = true;
      try {
        await postJoke(page);
      } catch (e) {
        logger.error("Post‑Fehler: " + e);
      } finally {
        jokeLock = false;
      }
    }, 3 * 60 * 1000);

    // Warte 50 Minuten bevor Kommentieren/Liken startet
    logger.info("Warte 50 Minuten bevor Like/Comment-Aktivität startet...");
    await delay(50 * 60 * 1000); // 50 Minuten warten
    logger.info("Starte jetzt Like/Comment-Aktivität...");

    while (true) {
        // Wenn gerade ein Post läuft, kurz warten und eine Runde überspringen
        if (jokeLock) {
            logger.info("Posting läuft – warte 30 s …");
            await delay(30_000);
            continue;
        }

        // Likes & Kommentare
        await interactWithPosts(page);

        logger.info("Iteration complete, waiting 30 seconds before refreshing …");
        await delay(30_000);

        try {
            await page.reload({ waitUntil: "networkidle2" });
        } catch (e) {
            logger.warn("Error reloading page, continuing iteration: " + e);
        }
    }
}

const loginWithCredentials = async (page: any, browser: Browser) => {
    try {
        await page.goto("https://www.instagram.com/accounts/login/");
        await page.waitForSelector('input[name="username"]');

        // Fill out the login form
        await page.type('input[name="username"]', IGusername); // Replace with your username
        await page.type('input[name="password"]', IGpassword); // Replace with your password
        await page.click('button[type="submit"]');

        // Wait for navigation after login
        await page.waitForNavigation();

        // Save cookies after login
        const cookies = await browser.cookies();
        await saveCookies("/persistent/Instagramcookies.json", cookies);
    } catch (error) {
        logger.error("Error logging in with credentials:");
    }
}

async function interactWithPosts(page: any) {
    let postIndex = 1; // Start with the first post
    const maxPosts = 50; // Limit to prevent infinite scrolling

    while (postIndex <= maxPosts) {
        try {
            const postSelector = `article:nth-of-type(${postIndex})`;

            // Check if the post exists
            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Ending iteration...");
                return;
            }

            // 🔍 ERWEITERTE CHECKS FÜR KOMMENTARE

            // 1. Extrahiere Post-Daten
            const postAuthor = await getPostAuthor(page, postSelector);
            const postUrl = await getPostUrl(page, postSelector);
            
            // Extract and log the post caption
            const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
            const captionElement = await page.$(captionSelector);

            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate((el: HTMLElement) => el.innerText);
                console.log(`Caption for post ${postIndex}: ${caption}`);
            } else {
                console.log(`No caption found for post ${postIndex}.`);
            }

            // Check if there is a '...more' link to expand the caption
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

            // 2. Generiere eindeutige Post-ID
            const postId = generatePostId(caption, postIndex, postAuthor);

            // 3. Prüfe ob es ein eigener Post ist
            const isOwn = await isOwnPost(page, postSelector);
            if (isOwn) {
                logger.info(`⏭️ Überspringe eigenen Post ${postIndex} von ${postAuthor}`);
                
                // Trotzdem liken (eigene Posts liken ist OK)
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

                // Gehe zum nächsten Post
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
                
                // Trotzdem liken
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

                // Gehe zum nächsten Post
                postIndex++;
                await page.evaluate(() => {
                    window.scrollBy(0, window.innerHeight);
                });
                continue;
            }

            // 5. LIKE LOGIC (unverändert für alle Posts)
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

            // 6. COMMENT LOGIC (nur für neue, fremde Posts)
            const commentBoxSelector = `${postSelector} textarea`;
            const commentBox = await page.$(commentBoxSelector);
            if (commentBox) {
                logger.info(`💬 Kommentiere neuen Post ${postIndex} von ${postAuthor}...`);
                
                const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: "${caption}". Ensure the reply is relevant, insightful, and adds value to the conversation. It should reflect empathy and professionalism, and avoid sounding too casual or superficial. also it should be 300 characters or less. and it should not go against instagram Community Standards on spam. so you will have to try your best to humanize the reply`;
                const schema = getInstagramCommentSchema();
                const result = await runAgent(schema, prompt);
                const comment = result[0]?.comment;

                if (comment) {
                    await commentBox.type(comment);

                    // New selector approach for the post button
                    const postButton = await page.evaluateHandle(() => {
                        const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
                        return buttons.find(button => button.textContent === 'Post' && !button.hasAttribute('disabled'));
                    });

                    if (postButton) {
                        console.log(`Posting comment on post ${postIndex}...`);
                        await postButton.click();
                        console.log(`Comment posted on post ${postIndex}.`);
                        
                        // 7. SPEICHERE KOMMENTAR IN DATABASE
                        await saveCommentToDatabase(postId, postUrl, caption, postAuthor, comment, false);
                        
                    } else {
                        console.log("Post button not found.");
                    }
                } else {
                    logger.warn("No comment generated by AI, skipping comment.");
                }
            } else {
                console.log("Comment box not found.");
            }

            // Wait before moving to the next post
            const baseDelay = 180_000;                     // 3 min = 180 000 ms
            const jitter    = Math.floor(Math.random() * 30_000); // 0‑30 s extra
            const waitTime  = baseDelay + jitter;
            console.log(`Waiting ${waitTime / 1000} seconds before moving to the next post...`);
            await delay(waitTime);

            // Scroll to the next post
            await page.evaluate(() => {
                window.scrollBy(0, window.innerHeight);
            });

            postIndex++;
        } catch (error) {
            console.error(`Error interacting with post ${postIndex}:`, error);
            
            // Bei Fehler trotzdem zum nächsten Post
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
