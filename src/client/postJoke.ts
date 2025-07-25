import { Page } from "puppeteer";          // bleibt so – Typen nur für TS
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
              (b.innerText || "").trim().toLowerCase() === t ||
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

export async function postJoke(page: Page) {
  /* ░░ 0) Witz holen ░░ */
  const joke = await generateJoke();
  logger.info(`Neuer Witz: ${JSON.stringify(joke)}`);

  /* ░░ 1) Instagram‑Startseite ░░ */
  await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });

  /* ░░ 2) „+“‑Icon ░░ */
  const plusSel =
    'svg[aria-label*="New post"],svg[aria-label*="Create"],svg[aria-label*="Neuer Beitrag"],svg[aria-label*="Beitrag erstellen"]';
  await page.waitForSelector(plusSel, { timeout: 20_000, visible: true });
  await page.click(plusSel);

  /* ░░ 3) Datei‑Input ░░ */
  const fileSel = 'input[type="file"][accept*="image"]';
  await page.waitForSelector(fileSel, { timeout: 20_000 });
  const fileInput = await page.$(fileSel);
  if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
  await fileInput.uploadFile(path.resolve("assets/brokkoli.jpg"));

  /* ░░ 4) Zweimal „Weiter/Next“ ░░ */
  for (let i = 0; i < 2; i++) {
    await clickDialogButton(page, ["next", "weiter"]);
    await delay(1_000);
  }

  /* ░░ 5) Caption ░░ */
  const captionSel =
    'textarea[aria-label*="caption"],textarea[placeholder*="Schreibe"]';
  await page.waitForSelector(captionSel, { timeout: 20_000, visible: true });
  await page.type(
    captionSel,
    Array.isArray(joke) ? joke[0]?.witz ?? "" : (joke as string)
  );

  /* ░░ 6) „Teilen/Share“ ░░ */
  await clickDialogButton(page, ["share", "teilen"]);

  logger.info("Witz gepostet! 🎉");
}
