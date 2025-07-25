import { runAgent } from ".";

export async function generateJoke(): Promise<string> {
  const prompt =
    "Erfinde einen kurzen, deutschsprachigen Witz (max 300 Zeichen) " +
    "mit dem Thema Brokkoli. Auf keinen Fall beleidigend oder plagiat.";

  // 1) Aufruf **ohne** Schema
  const data = await runAgent(null as any, prompt);   // Schema entfällt

  // 2) Datenformat absichern
  if (Array.isArray(data) && data[0]?.joke) return data[0].joke;
  if (typeof data === "object" && data?.joke) return String(data.joke);

  // Fallback – falls das Modell einfach nur Text liefert
  return typeof data === "string" ? data : JSON.stringify(data);
}
