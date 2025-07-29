import { runAgent } from ".";
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
        // Zufälligen Prompt auswählen
        const randomPrompt = postPrompts[Math.floor(Math.random() * postPrompts.length)];
        
        const fullPrompt = `${randomPrompt}

Erstelle einen ansprechenden Instagram-Post mit:
- Einem fesselnden Haupttext (max. 150 Wörter) 
- Authentischem, menschlichem Ton
- Auf Deutsch
- Familienfreundlich
- Ohne Emojis im Haupttext (nur am Ende erlaubt)
- Mit 3-5 relevanten Hashtags am Ende

Format: 
[Haupttext]

[Hashtags]

Wichtig: Antworte nur mit dem Post-Text, keine zusätzlichen Erklärungen.`;

        // Verwende runAgent ohne Schema (wie ursprünglich)
        const data = await runAgent(null as any, fullPrompt);
        
        // Erweiterte Datenformat-Erkennung
        if (Array.isArray(data)) {
            if (data[0]?.witz) return data[0].witz;
            if (data[0]?.instagram_post) return data[0].instagram_post;
            if (data[0]?.joke) return data[0].joke;
            if (data[0]?.content) return data[0].content;
            if (data[0]?.post) return data[0].post;
        }
        
        if (typeof data === "object" && data !== null) {
            if (data.witz) return String(data.witz);
            if (data.instagram_post) return String(data.instagram_post);
            if (data.joke) return String(data.joke);
            if (data.content) return String(data.content);
            if (data.post) return String(data.post);
        }
        
        // Fallback - direkter String oder JSON parsen
        if (typeof data === "string") {
            try {
                const parsed = JSON.parse(data);
                if (Array.isArray(parsed) && parsed[0]?.witz) {
                    return parsed[0].witz;
                }
                if (Array.isArray(parsed) && parsed[0]?.instagram_post) {
                    return parsed[0].instagram_post;
                }
                if (parsed?.witz) return parsed.witz;
                if (parsed?.instagram_post) return parsed.instagram_post;
                return data;
            } catch {
                return data;
            }
        }

        // Letzter Fallback
        logger.warn("Unerwartetes Datenformat:", JSON.stringify(data));
        return getFallbackPost();
        
    } catch (error) {
        logger.error("Fehler bei generateJoke:", error);
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
