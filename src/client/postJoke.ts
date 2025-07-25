import { Page } from "puppeteer";
import path from "path";
import { generateJoke } from "../Agent/joke";
import logger from "../config/logger";

/* kleine Sleep‑Helferfunktion, falls wir später warten wollen */
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/** Button anhand seines sichtbaren Texts anklicken (de / en) */
async function clickBtn(page: Page, texts: string[], timeout = 15_000) {
  const xp = `//button[${texts
    .map(t => `contains(normalize-space(.), "${t}")`)
    .join(" or ")}]`;
  const btn = await page.waitForXPath(xp, { timeout });
  await (btn as any).click();
}

export async function postJoke(page: Page) {
  const joke = await generateJoke();
  logger.info("Neuer Witz: " + joke);

  /* 1. Instagram‑Home öffnen */
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  /* 2. „+“‑Icon klicken */
  const plus =
    'svg[aria-label*="New post"], svg[aria-label*="Create"], svg[aria-label*="Neuer Beitrag"]';
  await page.waitForSelector(plus, { timeout: 10_000 });
  await page.click(plus);

  /* 3. Hidden‑File‑Input befüllen */
  const fileInputSel = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileInputSel, { timeout: 10_000 });
  const fileInput = await page.$(fileInputSel);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden");
  await fileInput.uploadFile(path.resolve("assets/brokkoli.jpg"));

  /* 4. Zweimal „Weiter / Next“ */
  await clickBtn(page, ["Weiter", "Next"]);
  await sleep(600);                       // kurzes UI‑Delay
  await clickBtn(page, ["Weiter", "Next"]);

  /* 5. Caption‑Feld suchen (textarea **oder** div[role=textbox]) */
  const captionSel =
    'div[role="dialog"] textarea[aria-label*="caption"],' +
    'div[role="dialog"] textarea[placeholder*="Schreibe"],' +
    'div[role="dialog"] div[role="textbox"]';
  await page.waitForSelector(captionSel, { timeout: 15_000 });
  await page.type(captionSel, joke);

  /* 6. „Teilen / Share“ */
  await clickBtn(page, ["Teilen", "Share"]);

  logger.info("Witz gepostet! 🎉");
}
