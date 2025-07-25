import dotenv from "dotenv";
dotenv.config();          // lokal nützlich; auf Render einfach drinlassen

export const IGusername  = process.env.IG_USERNAME  ?? "";
export const IGpassword  = process.env.IG_PASSWORD  ?? "";
export const Xusername   = process.env.X_USERNAME   ?? "";
export const Xpassword   = process.env.X_PASSWORD   ?? "";

export const TWITTER_API_CREDENTIALS = {
  appKey:            process.env.TWITTER_API_KEY        ?? "",
  appSecret:         process.env.TWITTER_API_SECRET     ?? "",
  accessToken:       process.env.TWITTER_ACCESS_TOKEN   ?? "",
  accessTokenSecret: process.env.TWITTER_ACCESS_SECRET  ?? "",
  bearerToken:       process.env.TWITTER_BEARER_TOKEN   ?? "",
};

// mehrere Keys möglich – hier nur einer
export const geminiApiKeys = [
  process.env.GEMINI_API_KEY_1 ?? "",
];
