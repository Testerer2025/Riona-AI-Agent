import { runAgent } from ".";

export async function generateJoke(): Promise<string> {
  const prompt =
    "Erstelle einen ansprechenden Instagram-Post auf Deutsch (max. 300 Zeichen) " +
    "zum Thema Brokkoli, Ernährung, Motivation oder Alltag. " +
    "Familienfreundlich, lustig oder inspirierend. " +
    "Inklusive 2-3 passende Hashtags am Ende. " +
    "Auf keinen Fall beleidigend oder Plagiat.";

  try {
    // 1) Aufruf ohne Schema (wie bisher)
    const data = await runAgent(null as any, prompt);

    // 2) Erweiterte Datenformat-Erkennung
    // Suche nach verschiedenen möglichen Feldern
    if (Array.isArray(data)) {
      // Array mit Objekten
      if (data[0]?.witz) return data[0].witz;      // Dein aktuelles Format
      if (data[0]?.joke) return data[0].joke;      // Ursprüngliches Format
      if (data[0]?.content) return data[0].content; // Alternative
      if (data[0]?.post) return data[0].post;      // Alternative
    }
    
    if (typeof data === "object" && data !== null) {
      // Einzelnes Objekt
      if (data.witz) return String(data.witz);
      if (data.joke) return String(data.joke);
      if (data.content) return String(data.content);
      if (data.post) return String(data.post);
    }
    
    // Fallback - direkter String oder JSON parsen
    if (typeof data === "string") {
      // Versuche JSON zu parsen falls es ein String-JSON ist
      try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed[0]?.witz) {
          return parsed[0].witz;
        }
        if (parsed?.witz) return parsed.witz;
        return data; // Verwende den String direkt
      } catch {
        return data; // Kein JSON, verwende String direkt
      }
    }

    // Letzter Fallback
    const stringified = JSON.stringify(data);
    console.log("Unerwartetes Datenformat:", stringified);
    
    // Versuche trotzdem etwas Sinnvolles zu extrahieren
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
