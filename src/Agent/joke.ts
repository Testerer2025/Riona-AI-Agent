import { runAgent } from ".";
import axios from 'axios';

// Post-Typen definieren
export enum PostType {
  AGENCY_SHOWCASE = 'agency_showcase',
  INDUSTRY_NEWS = 'industry_news',
  TIPS_TRICKS = 'tips_tricks',
  CASE_STUDY = 'case_study',
  TREND_ANALYSIS = 'trend_analysis',
  MOTIVATIONAL = 'motivational'
}

interface PostContent {
  text: string;
  hashtags: string[];
  imagePrompt?: string;
  link?: string;
  type: PostType;
}

// Umbenennung für Klarheit
async function generateResearchBasedPost(): Promise<string> {
  return await generateNewsBasedPost();
}

// Recherche-Themen für AI-basierte News-Suche
const RESEARCH_TOPICS = [
  'neueste Social Media Marketing Trends 2025',
  'Instagram Marketing Updates',
  'TikTok Marketing Strategien',
  'LinkedIn Business Updates',
  'Content Marketing Trends',
  'Influencer Marketing News',
  'Digital Marketing Tools',
  'Social Media Algorithm Updates',
  'Performance Marketing Trends',
  'Brand Marketing Innovationen'
];

// Agentur-spezifische Inhalte
const AGENCY_TOPICS = [
  'Social Media Strategien',
  'Content Marketing',
  'Influencer Marketing',
  'Performance Marketing',
  'Brand Building',
  'Customer Engagement',
  'ROI Optimierung',
  'Multi-Channel Kampagnen',
  'Community Management',
  'Crisis Communication'
];

// HAUPT-FUNKTION: Ersetzt deine alte generateJoke() - behält aber den Namen!
export async function generateJoke(): Promise<string> {
  try {
    // Prüfe Environment Variable für Post-Typ
    const forcePostType = process.env.POST_TYPE as PostType;
    
    // Zufälligen Post-Typ wählen falls nicht forciert
    const selectedType = forcePostType || getRandomPostType();
    
    console.log(`Generiere ${selectedType} Post...`);
    
    switch (selectedType) {
      case PostType.INDUSTRY_NEWS:
        return await generateResearchBasedPost();
      case PostType.AGENCY_SHOWCASE:
        return await generateAgencyPost();
      case PostType.TIPS_TRICKS:
        return await generateTipsPost();
      case PostType.CASE_STUDY:
        return await generateCaseStudyPost();
      case PostType.TREND_ANALYSIS:
        return await generateTrendPost();
      default:
        return await generateMotivationalPost();
    }
    
  } catch (error) {
    console.error("Fehler bei Post-Generierung:", error);
    return getBackupPost();
  }
}

async function generateNewsBasedPost(): Promise<string> {
  try {
    // 1. AI-basierte Recherche zu aktuellen Marketing Trends
    const researchResult = await conductAIResearch();
    
    if (!researchResult) {
      console.log("Recherche fehlgeschlagen, wechsle zu Agentur-Post");
      return await generateAgencyPost();
    }
    
    // 2. AI-Post basierend auf Recherche generieren
    const prompt = `
      Basierend auf dieser aktuellen Information aus dem Marketing-Bereich, erstelle einen professionellen Social Media Post für eine Digital Marketing Agentur:
      
      Information: "${researchResult.info}"
      
      Anforderungen:
      - Deutsch, professionell aber zugänglich
      - Max 250 Zeichen für den Haupttext
      - Füge deine eigene Agentur-Expertise hinzu
      - Erkläre warum das für Unternehmen relevant ist
      - 3-4 relevante Hashtags
      - Rege zur Diskussion an
      - Für Instagram/LinkedIn geeignet
      
      Format als einfacher String (ohne Links):
      "📱 [Trend/News]: [Deine Erklärung]
      
      Was bedeutet das für euer Business? 🤔
      
      #hashtag1 #hashtag2 #hashtag3"
    `;
    
    const result = await runAgent(null as any, prompt);
    return parseSimpleResponse(result);
    
  } catch (error) {
    console.error("Research-Post Fehler:", error);
    return await generateAgencyPost();
  }
}

async function generateAgencyPost(): Promise<string> {
  const agencyTopic = AGENCY_TOPICS[Math.floor(Math.random() * AGENCY_TOPICS.length)];
  
  const prompt = `
    Erstelle einen professionellen Instagram Post für eine Social Media & Digital Marketing Agentur zum Thema: "${agencyTopic}"
    
    Stil:
    - Professionell aber persönlich
    - Zeige Expertise ohne zu prahlen
    - Deutsch, max 250 Zeichen
    - Biete Mehrwert für Follower
    - Subtile Call-to-Action
    - Mit passenden Hashtags am Ende
    
    Beispiel-Format:
    "🚀 Erfolgreiche Social Media Strategie beginnt mit klaren Zielen. Was möchtet ihr erreichen?
    
    #digitalmarketing #socialmedia #strategie #agentur"
    
    Erstelle ähnlichen Content, aber mit anderem Thema.
  `;
  
  const result = await runAgent(null as any, prompt);
  return parseSimpleResponse(result);
}

async function generateTipsPost(): Promise<string> {
  const prompt = `
    Erstelle einen "Tipp des Tages" Post für eine Social Media Agentur.
    
    Anforderungen:
    - 1 konkreter, umsetzbarer Marketing-Tipp
    - Deutsch, max 250 Zeichen
    - Begründung warum der Tipp funktioniert
    - Call-to-Action für Engagement
    - Mit passenden Hashtags
    
    Format:
    "💡 Tipp: [Konkreter Tipp hier]
    
    Warum? [Kurze Begründung]
    
    Probiert es aus! 👇
    
    #marketingtipp #socialmediatips #digitalmarketing"
  `;
  
  const result = await runAgent(null as any, prompt);
  return parseSimpleResponse(result);
}

async function generateCaseStudyPost(): Promise<string> {
  const prompt = `
    Erstelle einen Case Study Teaser-Post (ohne echte Kundendaten zu nennen).
    
    Struktur:
    - Problem: Häufige Marketing-Herausforderung
    - Lösung: Strategischer Ansatz (generisch)
    - Ergebnis: Realistische Verbesserung in %
    - CTA: "Ähnliche Herausforderung? Schreibt uns!"
    
    Max 250 Zeichen, Deutsch, professionell.
    
    Format:
    "📊 Case Study:
    
    Problem: [Herausforderung]
    Lösung: [Ansatz]
    Ergebnis: +[X]% [Metrik]
    
    Ähnliche Herausforderung? 💬
    
    #casestudy #erfolg #digitalmarketing"
  `;
  
  const result = await runAgent(null as any, prompt);
  return parseSimpleResponse(result);
}

async function generateTrendPost(): Promise<string> {
  const currentYear = new Date().getFullYear();
  
  const prompt = `
    Analysiere einen aktuellen Digital Marketing Trend für ${currentYear} und erstelle einen informativen Post.
    
    Inhalt:
    - Trend identifizieren (AI, Video, Personalisierung, etc.)
    - Warum er wichtig ist
    - Praktischer Rat für Unternehmen
    - Zukunftsausblick
    
    Deutsch, max 250 Zeichen, für Entscheider geeignet.
    
    Format:
    "🔮 Trend ${currentYear}: [Trend-Name]
    
    [Warum wichtig + praktischer Tipp]
    
    Was denkt ihr? 🤔
    
    #trends${currentYear} #digitalmarketing #zukunft"
  `;
  
  const result = await runAgent(null as any, prompt);
  return parseSimpleResponse(result);
}

async function generateMotivationalPost(): Promise<string> {
  const prompt = `
    Erstelle einen motivierenden Post für Unternehmer/Marketing-Manager.
    
    Themen: Durchhaltevermögen, Innovation, Kundenzentrierung, Team-Building
    
    Stil:
    - Inspirierend aber nicht kitschig
    - Business-relevant
    - Deutsch, max 250 Zeichen
    - Regt zum Nachdenken an
    - Mit Hashtags
    
    Format:
    "💪 [Motivierende Botschaft]
    
    [Praktischer Bezug zum Business]
    
    Wie seht ihr das? 💭
    
    #motivation #unternehmer #mindset"
  `;
  
  const result = await runAgent(null as any, prompt);
  return parseSimpleResponse(result);
}

// AI-basierte Recherche zu Marketing Trends
async function conductAIResearch(): Promise<{info: string} | null> {
  try {
    // Prüfe ob AI-Recherche aktiviert ist
    if (process.env.ENABLE_AI_RESEARCH !== 'true') {
      console.log("AI-Recherche deaktiviert");
      return null;
    }
    
    // Wähle zufälliges Recherche-Thema
    const randomTopic = RESEARCH_TOPICS[Math.floor(Math.random() * RESEARCH_TOPICS.length)];
    console.log(`Recherchiere zu: ${randomTopic}`);
    
    // AI-Recherche Prompt
    const researchPrompt = `
      Du bist ein Marketing-Experte. Recherchiere und analysiere aktuelle Entwicklungen zu folgendem Thema:
      
      Thema: "${randomTopic}"
      
      Finde eine interessante, aktuelle Information die für Digital Marketing Agenturen und ihre Kunden relevant ist.
      
      Anforderungen:
      - Fokus auf Deutschland/DACH-Region
      - Praktisch umsetzbare Insights
      - Keine veralteten Informationen
      - Konkrete Zahlen/Trends wenn möglich
      
      Antwort-Format:
      "Eine interessante aktuelle Entwicklung: [Deine Recherche hier - 2-3 Sätze mit konkreten Fakten]"
      
      Beispiel: "Instagram testet neue Shopping-Features, die bis zu 40% höhere Conversion-Raten ermöglichen. Unternehmen können jetzt direkt im Reel-Format verkaufen."
    `;
    
    const researchResult = await runAgent(null as any, researchPrompt);
    const info = parseSimpleResponse(researchResult);
    
    if (info && info.length > 50) {
      console.log(`Recherche erfolgreich: ${info.substring(0, 100)}...`);
      return { info };
    }
    
    return null;
    
  } catch (error) {
    console.error("AI-Recherche Fehler:", error);
    return null;
  }
}

// Vereinfachter Response Parser - kompatibel mit deiner bestehenden Struktur
function parseSimpleResponse(response: any): string {
  try {
    // Handhabe verschiedene Response-Formate wie in deiner ursprünglichen Funktion
    if (Array.isArray(response)) {
      // Array mit Objekten
      if (response[0]?.instagram_post) return response[0].instagram_post;
      if (response[0]?.witz) return response[0].witz;
      if (response[0]?.joke) return response[0].joke;
      if (response[0]?.content) return response[0].content;
      if (response[0]?.post) return response[0].post;
      
      // Array mit direkten Strings
      if (typeof response[0] === "string") return response[0];
    }
    
    if (typeof response === "object" && response !== null) {
      // Einzelnes Objekt
      if (response.instagram_post) return String(response.instagram_post);
      if (response.witz) return String(response.witz);
      if (response.Witz) return String(response.Witz);
      if (response.joke) return String(response.joke);
      if (response.Joke) return String(response.Joke);
      if (response.content) return String(response.content);
      if (response.post) return String(response.post);
    }
    
    // Fallback - direkter String oder JSON parsen
    if (typeof response === "string") {
      try {
        const parsed = JSON.parse(response);
        if (Array.isArray(parsed) && parsed[0]?.instagram_post) {
          return parsed[0].instagram_post;
        }
        if (Array.isArray(parsed) && parsed[0]?.witz) {
          return parsed[0].witz;
        }
        if (parsed?.instagram_post) return parsed.instagram_post;
        if (parsed?.witz) return parsed.witz;
        return response; // Verwende den String direkt
      } catch {
        return response; // Kein JSON, verwende String direkt
      }
    }
    
    // Letzter Fallback
    console.log("Unerwartetes Datenformat:", JSON.stringify(response));
    return getBackupPost();
    
  } catch (error) {
    console.error("Parse Error:", error);
    return getBackupPost();
  }
}

// Utility Functions
function getRandomPostType(): PostType {
  const types = Object.values(PostType);
  const weights = {
    [PostType.AGENCY_SHOWCASE]: 3,  // Häufigste Posts
    [PostType.TIPS_TRICKS]: 3,      // Häufigste Posts
    [PostType.INDUSTRY_NEWS]: 2,    // Wenn News verfügbar
    [PostType.CASE_STUDY]: 1,       // Seltener
    [PostType.TREND_ANALYSIS]: 1,   // Seltener
    [PostType.MOTIVATIONAL]: 2      // Regelmäßig
  };
  
  const weightedTypes: PostType[] = [];
  for (const [type, weight] of Object.entries(weights)) {
    for (let i = 0; i < weight; i++) {
      weightedTypes.push(type as PostType);
    }
  }
  
  return weightedTypes[Math.floor(Math.random() * weightedTypes.length)];
}

// Backup-Posts (ersetzt deine alten Brokkoli-Witze)
function getBackupPost(): string {
  const backupPosts = [
    `🚀 Erfolgreiche Social Media Strategie beginnt mit authentischem Storytelling. Was ist eure Geschichte?

#storytelling #digitalmarketing #authentizität #socialmedia`,

    `📊 Daten ohne Strategie sind wie ein Auto ohne Ziel. Wohin soll die Reise gehen?

#datadriven #marketingstrategie #analyse #performance`,

    `💡 Tipp: Die besten Posts entstehen durch Zuhören. Was beschäftigt eure Community wirklich?

#communityfirst #engagement #socialmedia #kundenverständnis`,

    `🎯 Content ist King, aber Distribution ist Queen. Beide müssen zusammenarbeiten!

#contentmarketing #distribution #reichweite #socialmedia`,

    `📱 Mobile First ist kein Trend mehr - es ist Standard. Ist euer Content bereit?

#mobilefirst #responsive #userexperience #digitalmarketing`
  ];
  
  return backupPosts[Math.floor(Math.random() * backupPosts.length)];
}
