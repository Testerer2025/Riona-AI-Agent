// src/secret.ts
// Liest Credentials aus Render-Env (und optional lokale .env für Dev)
const _u = process.env.IGusername || process.env.IG_USERNAME || process.env.IG_USER || "";
const _p = process.env.IGpassword || process.env.IG_PASSWORD || process.env.IG_PASS || "";

/**
 * Exportierte, bereinigte Credentials.
 * NIE im Code loggen!
 */
export const IGusername: string = (_u || "").trim();
export const IGpassword: string = (_p || "").trim();

/**
 * Optional: Validierung beim Start, damit du sofort siehst, wenn Vars fehlen.
 * In Prod lieber nur warnen statt throw, wenn du Graceful Degradation willst.
 */
export function assertInstagramCreds(): void {
  if (!IGusername || !IGpassword) {
    const hint = [
      "Erwartete Env-Variablen bei Render:",
      "- IGusername oder IG_USERNAME",
      "- IGpassword oder IG_PASSWORD",
      "Tipp: In Render Dashboard → Environment → Environment Variables setzen.",
    ].join("\n");
    throw new Error("Instagram-Credentials fehlen.\n" + hint);
  }
}
