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

let jokeLock = false;

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        // Optionally enable Cooperative Mode for several request interceptors
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function runInstagram() {
    const server = new Server({ port: 8000 });
    await server.listen();
    const proxyUrl = `http://localhost:8000`;
    const browser = await puppeteer.launch({
    // Pfad kommt aus der Render‑Env‑Var
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    headless: true,                        // strikt headless, Chrome > 118
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





    
    
    // Continuously interact with posts without closing the browser
  /*  while (true) {
         await interactWithPosts(page);
         logger.info("Iteration complete, waiting 30 seconds before refreshing...");
         await delay(30000);
         try {
             await page.reload({ waitUntil: "networkidle2" });
         } catch (e) {
             logger.warn("Error reloading page, continuing iteration: " + e);
         }
    } */


    // Warte 50 Minuten bevor Kommentieren/Liken startet
       logger.info("Warte 50 Minuten bevor Like/Comment-Aktivität startet...");
        await delay(50 * 60 * 1000); // 50 Minuten warten
        logger.info("Starte jetzt Like/Comment-Aktivität...");
        
        // Continuously interact with posts without closing the browser
      /*   while (true) {
             await interactWithPosts(page);
             logger.info("Iteration complete, waiting 30 seconds before refreshing...");
             await delay(30000);
             try {
                 await page.reload({ waitUntil: "networkidle2" });
             } catch (e) {
                 logger.warn("Error reloading page, continuing iteration: " + e);
             }
        } */

    while (true) {

  // Wenn gerade ein Post läuft, kurz warten und eine Runde überspringen
  if (jokeLock) {
    logger.info("Posting läuft – warte 30 s …");
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

    // 
    

    
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
        // logger.info("Saving cookies after login...",cookies);
        await saveCookies("/persistent/Instagramcookies.json", cookies);
    } catch (error) {
        // logger.error("Error logging in with credentials:", error);
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

            const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
            const likeButton = await page.$(likeButtonSelector);
            const ariaLabel = await likeButton?.evaluate((el: Element) =>
                el.getAttribute("aria-label")
            );

            if (ariaLabel === "Like") {
                console.log(`Liking post ${postIndex}...`);
                await likeButton.click();
                // await page.keyboard.press("Enter");
                console.log(`Post ${postIndex} liked.`);
            } else if (ariaLabel === "Unlike") {
                console.log(`Post ${postIndex} is already liked.`);
            } else {
                console.log(`Like button not found for post ${postIndex}.`);
            }

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

            // Comment on the post
            const commentBoxSelector = `${postSelector} textarea`;
            const commentBox = await page.$(commentBoxSelector);
            if (commentBox) {
                console.log(`Commenting on post ${postIndex}...`);
                const prompt = `Formuliere einen kurzen, sympathischen Kommentar auf **Deutsch** zum folgenden Instagram-Post: "${caption}". Sprich die Person direkt mit „du“ an, bleib freundlich, locker und humorvoll. Wenn es natürlich passt, darf Brokkoli erwähnt werden. Vermeide alles, was wie Spam aussieht. Es ist sehr wichtig, dass die Antwort relevant, durchdacht und inhaltlich wertvoll ist. Sie sollte Empathie und Professionalität vermitteln und dabei nicht zu oberflächlich wirken. Erwähne nicht, dass du dem Kanal gefolgt bist. Maximal 300 Zeichen.`;
                const schema = getInstagramCommentSchema();
                const result = await runAgent(schema, prompt);
                const comment = result[0]?.comment;
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
                } else {
                    console.log("Post button not found.");
                }
            } else {
                console.log("Comment box not found.");
            }


            // Wait before moving to the next post
            const baseDelay = 180_000;                     // 3 min = 180 000 ms
            const jitter    = Math.floor(Math.random() * 30_000); // 0‑30 s extra
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
            break;
        }
    }
}

export { runInstagram };
