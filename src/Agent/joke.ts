import { GoogleGenerativeAI } from "@google/generative-ai";
import { getJokeSchema } from "./schema";
import logger from "../config/logger";

// Initialisiere Google AI
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || "");

// Post-Prompts für verschiedene Inhalte
const postPrompts = [
    "Erstelle einen lustigen, familienfreundlichen Witz über den Alltag auf Deutsch.",
    "Schreibe einen motivierenden Post über persönliches Wachstum auf Deutsch.",
    "Erstelle einen humorvollen Post über gesunde Ernährung und Brokkoli auf Deutsch.",
    "Schreibe einen witzigen Post über Work-Life-Balance auf Deutsch.",
    "Erstelle einen Post über Dankbarkeit und positive Gedanken auf Deutsch.",
    "Schreibe einen lustigen Post über Technologie im Alltag auf Deutsch.",
    "Erstelle einen inspirierenden Post über Freundschaft auf Deutsch.",
    "Schreibe einen humorvollen Post über kleine Freuden des Lebens auf Deutsch."
];

export async function generateJoke(): Promise<string> {
    try {
        // Prüfe API Key
        if (!process.env.GOOGLE_AI_API_KEY) {
            logger.warn("Kein Google AI API Key gefunden, verwende Fallback");
            return getFallbackPost();
        }

        // Zufälligen Prompt auswählen
        const randomPrompt = postPrompts[Math.floor(Math.random() * postPrompts.length)];
        
        const fullPrompt = `${randomPrompt}

Erstelle einen ansprechenden Instagram-Post mit folgenden Anforderungen:
- Haupttext auf Deutsch (maximal 150 Wörter)
- Authentischer, menschlicher Ton
- Familienfreundlich und positiv
- Am Ende 3-5 relevante deutsche Hashtags
- Keine Emojis im Haupttext (nur am Ende erlaubt)

Format:
[Haupttext]

[Hashtags mit #]

Beispiel:
Das Leben ist wie ein guter Kaffee - manchmal bitter, aber immer besser mit Freunden!

Mit wem trinkt ihr heute euren Kaffee?

#freundschaft #kaffee #lebensweisheit #positiv #zusammen

Wichtig: Antworte nur mit dem Post-Inhalt, keine zusätzlichen Erklärungen.`;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-pro",
            generationConfig: {
                maxOutputTokens: 500,
                temperature: 0.9,
            }
        });

        const result = await model.generateContent(fullPrompt);
        const response = await result.response;
        const text = response.text();
        
        if (text && text.trim().length > 10) {
            logger.info("Post erfolgreich generiert:", text.substring(0, 50) + "...");
            return text.trim();
        } else {
            logger.warn("Unzureichende AI-Antwort, verwende Fallback");
            return getFallbackPost();
        }
        
    } catch (error) {
        logger.error("Fehler bei AI Post-Generierung:", error);
        return getFallbackPost();
    }
}

// Alternative: Verwende runAgent falls vorhanden
export async function generateJokeWithSchema(): Promise<string> {
    try {
        // Importiere runAgent dynamisch
        const { runAgent } = await import("./index");
        
        const prompt = `Erstelle einen ansprechenden Instagram-Post auf Deutsch:
        - Lustig, inspirierend oder motivierend
        - Familienfreundlich und authentisch
        - Maximal 150 Wörter Haupttext
        - 3-5 deutsche Hashtags am Ende
        - Kein Spam oder oberflächlicher Inhalt`;

        const schema = getJokeSchema();
        const result = await runAgent(schema, prompt);
        
        if (result && result[0] && result[0].witz) {
            logger.info("Post mit Schema erfolgreich generiert");
            return result[0].witz;
        } else {
            logger.warn("Schema-basierte Generierung fehlgeschlagen");
            return getFallbackPost();
        }
        
    } catch (error) {
        logger.error("Fehler bei Schema-basierter Generierung:", error);
        // Fallback zur direkten Google AI Methode
        return generateJoke();
    }
}

// Fallback Posts
function getFallbackPost(): string {
    const fallbackPosts = [
        `Heute ist ein guter Tag, um dankbar zu sein! 🌟

Was hat euch heute zum Lächeln gebracht?

#dankbarkeit #positivevibes #gutestimmung #achtsamkeit #lebensfreude`,

        `Kleine Erinnerung: Du machst das großartig! 💪

Manchmal vergessen wir, wie weit wir schon gekommen sind. Seid stolz auf euch!

#motivation #selbstliebe #persönlichkesentwicklung #stärke #weitermachen`,

        `Fun Fact: Brokkoli ist eigentlich ein Superheld in Gemüse-Form! 🥦

Wer hätte gedacht, dass etwas so Gesundes auch so lecker sein kann?

#gesundessen #brokkoli #superheld #ernährung #gesundleben`,

        `Das Leben ist wie ein guter Kaffee - manchmal bitter, aber immer besser mit Freunden! ☕

Mit wem trinkt ihr heute euren Kaffee?

#freundschaft #kaffee #zusammen #lebensweisheit #gemeinsam`,

        `Lächeln ist ansteckend - verbreitet heute ein bisschen Freude! 😊

Habt ihr heute schon jemandem ein Lächeln geschenkt?

#lächeln #freude #positivity #menschlichkeit #gutfühlen`,

        `Neue Woche, neue Möglichkeiten! 🚀

Was ist euer Ziel für diese Woche?

#montagsmotivation #neuewoche #ziele #chancen #positiv`
    ];
    
    const selectedPost = fallbackPosts[Math.floor(Math.random() * fallbackPosts.length)];
    logger.info("Fallback-Post ausgewählt");
    return selectedPost;
}
