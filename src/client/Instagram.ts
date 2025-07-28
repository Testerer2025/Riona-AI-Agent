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
puppeteer.use(StealthPlugin());
puppeteer.use(
    AdblockerPlugin({
        interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
    })
);

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    await scheduleNextJoke(page);

    while (true) {
        await interactWithPosts(page);
        const delayMs = Math.floor(Math.random() * (90000 - 30000 + 1)) + 30000;
        logger.info(`Iteration complete, waiting ${Math.floor(delayMs / 1000)} seconds before refreshing...`);
        await delay(delayMs);
        try {
            await page.reload({ waitUntil: "networkidle2" });
        } catch (e) {
            logger.warn("Error reloading page, continuing iteration: " + e);
        }
    }
}

const loginWithCredentials = async (page, browser) => {
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

async function scheduleNextJoke(page) {
    const min = 180000;
    const max = 480000;
    const delayTime = Math.floor(Math.random() * (max - min + 1)) + min;

    setTimeout(async () => {
        if (!isNightTime()) {
            if (!jokeLock) {
                jokeLock = true;
                try {
                    await postJoke(page);
                } catch (e) {
                    logger.error("Post‑Fehler: " + e);
                } finally {
                    jokeLock = false;
                }
            }
        } else {
            logger.info("Nachtpause – keine Posts zwischen 22:00 und 07:00");
        }
        scheduleNextJoke(page);
    }, delayTime);
}

function isNightTime() {
    const hour = new Date().getHours();
    return hour >= 22 || hour < 7;
}

async function interactWithPosts(page) {
    let postIndex = 1;
    const maxPosts = 50;
    while (postIndex <= maxPosts) {
        try {
            const postSelector = `article:nth-of-type(${postIndex})`;
            if (!(await page.$(postSelector))) {
                console.log("No more posts found. Ending iteration...");
                return;
            }

            const likeButtonSelector = `${postSelector} svg[aria-label="Like"]`;
            const likeButton = await page.$(likeButtonSelector);
            const ariaLabel = await likeButton?.evaluate(el => el.getAttribute("aria-label"));

            if (ariaLabel === "Like") {
                console.log(`Liking post ${postIndex}...`);
                await likeButton.click();
                await page.keyboard.press("Enter");
                console.log(`Post ${postIndex} liked.`);
            } else {
                console.log(`Post ${postIndex} is already liked or like button not found.`);
            }

            const captionSelector = `${postSelector} div.x9f619 span._ap3a div span._ap3a`;
            const captionElement = await page.$(captionSelector);

            let caption = "";
            if (captionElement) {
                caption = await captionElement.evaluate(el => el.innerText);
                console.log(`Caption for post ${postIndex}: ${caption}`);
            }

            const commentBoxSelector = `${postSelector} textarea`;
            const commentBox = await page.$(commentBoxSelector);
            if (commentBox) {
                console.log(`Commenting on post ${postIndex}...`);
                const prompt = `Craft a thoughtful, engaging, and mature reply to the following post: \"${caption}\". Ensure the reply is relevant, insightful, and adds value to the conversation. It should reflect empathy and professionalism, and avoid sounding too casual or superficial. Keep it under 300 characters.`;
                const schema = getInstagramCommentSchema();
                const result = await runAgent(schema, prompt);
                const comment = result[0]?.comment;
                await commentBox.type(comment);

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

            const baseDelay = 180000;
            const jitter = Math.floor(Math.random() * 30000);
            const waitTime = baseDelay + jitter;
            console.log(`Waiting ${waitTime / 1000} seconds before moving to the next post...`);
            await delay(waitTime);

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
