import { runAgent } from ".";

export async function generateJoke(): Promise<string> {
  const prompt =
    "Erfinde einen kurzen, deutschsprachigen Witz oder humorvollen Post (max 300 Zeichen) " +
    "mit dem Thema Brokkoli, gesunde Ernährung oder Gemüse. " +
    "Lustig, familienfreundlich und mit 2-3 passenden Hashtags. " +
    "Auf keinen Fall beleidigend oder Plagiat. " +
    "Beispiel: 'Was sagt Brokkoli zum Blumenkohl? Du bist ja total weiß vor Neid! 🥦 #brokkoli #gemüsewitz #gesundlachen'";

  try {
    // 1) Aufruf ohne Schema (wie bisher)
    const data = await runAgent(null as any, prompt);

    // 2) Erweiterte Datenformat-Erkennung - ALLE möglichen Felder
    if (Array.isArray(data)) {
      // Array mit Objekten
      if (data[0]?.instagram_post) return data[0].instagram_post; // Objekt-Format
      if (data[0]?.witz) return data[0].witz;                     // Objekt-Format
      if (data[0]?.joke) return data[0].joke;                     // Objekt-Format
      if (data[0]?.content) return data[0].content;               // Objekt-Format
      if (data[0]?.post) return data[0].post;                     // Objekt-Format
      
      // NEU: Array mit direkten Strings!
      if (typeof data[0] === "string") return data[0];            // String-Array!
    }
    
    if (typeof data === "object" && data !== null) {
      // Einzelnes Objekt
      if (data.instagram_post) return String(data.instagram_post); // NEUES Format!
      if (data.witz) return String(data.witz);
      if (data.joke) return String(data.joke);
      if (data.content) return String(data.content);
      if (data.post) return String(data.post);
    }
    
    // Fallback - direkter String oder JSON parsen
    if (typeof data === "string") {
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed[0]?.instagram_post) {
          return parsed[0].instagram_post;
        }
        if (Array.isArray(parsed) && parsed[0]?.witz) {
          return parsed[0].witz;
        }
        if (parsed?.instagram_post) return parsed.instagram_post;
        if (parsed?.witz) return parsed.witz;
        return data; // Verwende den String direkt
      } catch {
        return data; // Kein JSON, verwende String direkt
      }
    }

    // Letzter Fallback
    console.log("Unerwartetes Datenformat:", JSON.stringify(data));
    return getBackupJoke();
    
  } catch (error) {
    console.error("Fehler bei generateJoke:", error);
    return getBackupJoke();
  }
}

// Backup-Witze falls alles schiefgeht
function getBackupJoke(): string {
  const backupJokes = [
    `Was sagt Brokkoli beim Arzt? "Ich fühle mich heute etwas grün!" 🥦 #brokkoli #gesundheit #witz`,
    
    `Warum ist Brokkoli der beste Freund? Er hört zu und urteilt nie! 💚 #freundschaft #brokkoli #positiv`,
    
    `Fun Fact: Brokkoli ist eigentlich ein kleiner Baum für Ameisen! 🌳 #funfact #brokkoli #natur`,
    
    `Brokkoli-Tipp: Mit Käse schmeckt alles besser - sogar das Leben! 😊 #lebensweisheit #essen #motivation`,
    
    `Was macht Brokkoli glücklich? Wenn er nicht alleine auf dem Teller liegt! 🍽️ #zusammen #brokkoli #freude`
  ];
  
  return backupJokes[Math.floor(Math.random() * backupJokes.length)];
}
