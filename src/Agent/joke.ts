import { runAgent } from ".";
import axios from 'axios';

// Variation-Systeme für unterschiedliche Posts
const TIP_VARIATIONS = [
  {
    format: "💡 Profi-Tipp: {tip}\n\n✨ Das bringt dir: {benefit}\n\nSchon ausprobiert? Erzählt in den Kommentaren! 👇",
    topics: ['Stories optimieren', 'Engagement steigern', 'Content planen', 'Hashtag-Strategie', 'Reichweite erhöhen'],
    style: 'praktisch und direkt'
  },
  {
    format: "🎯 Marketing-Hack: {tip}\n\n📊 Ergebnis: {result}\n\nWer testet es diese Woche? 🚀",
    topics: ['A/B Testing', 'Conversion optimieren', 'Zielgruppe finden', 'Content-Timing', 'Influencer Marketing'],
    style: 'datenorientiert'
  },
  {
    format: "🔥 Geheimtipp aus 5 Jahren Agentur-Erfahrung:\n\n{tip}\n\n💪 Warum das funktioniert: {reason}\n\nFragen? Immer her damit! 💬",
    topics: ['Client Management', 'Kampagnen-Optimierung', 'Budget-Verteilung', 'Team-Workflows', 'Tool-Empfehlungen'],
    style: 'erfahrungsbasiert'
  },
  {
    format: "⚡ Quick-Win für heute: {tip}\n\n⏰ Aufwand: {time}\n📈 Impact: {impact}\n\nWer macht mit? 👥",
    topics: ['Profile optimieren', 'Bio verbessern', 'Story-Highlights', 'Posting-Zeiten', 'Community-Building'],
    style: 'actionable und zeiteffizient'
  }
];

const AGENCY_VARIATIONS = [
  {
    angle: 'Behind-the-Scenes',
    topics: ['Wie wir Strategien entwickeln', 'Ein Tag in der Agentur', 'Client-Meetings', 'Kreativprozess', 'Team-Dynamics']
  },
  {
    angle: 'Industry Insights',
    topics: ['Was wir täglich sehen', 'Häufige Fehler', 'Erfolgs-Pattern', 'Markt-Trends', 'Tool-Updates']
  },
  {
    angle: 'Client Success',
    topics: ['Erfolgsgeschichten', 'Vor-Nachher Vergleiche', 'Learnings', 'Challenges gemeistert', 'Wachstums-Stories']
  },
  {
    angle: 'Educational',
    topics: ['Strategie-Basics', 'Tool-Vergleiche', 'Best Practices', 'Fehler vermeiden', 'Schritt-für-Schritt Guides']
  }
];

const MOTIVATIONAL_STYLES = [
  'Unternehmer-Mindset', 'Team-Spirit', 'Innovation-Focus', 'Durchhaltevermögen', 
  'Kundenzentrierung', 'Kreativität', 'Authentizität', 'Wachstums-Mentalität'
];

// Post-Counter für Variation (einfache Lösung)
let postCounter = 0;

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
  const variation = AGENCY_VARIATIONS[postCounter % AGENCY_VARIATIONS.length];
  const topic = variation.topics[Math.floor(Math.random() * variation.topics.length)];
  
  const prompt = `
    Erstelle einen "${variation.angle}" Social Media Post zum Thema: "${topic}"
    
    Anforderungen:
    - Persönliche Agentur-Perspektive
    - 350-450 Zeichen (ausführlicher!)
    - Authentisch und nahbar
    - Zeige Expertise ohne zu prahlen
    - Lade zur Diskussion ein
    
    Stil-Variationen (wähle zufällig):
    - Mal mit konkretem Beispiel
    - Mal mit Statistik/Zahl
    - Mal mit persönlicher Erfahrung
    - Mal mit Frage an Community
    
    Vermeide diese Phrasen (schon zu oft verwendet):
    - "Erfolgreiche Social Media Strategie"
    - "Was denkt ihr?"
    - "Schreibt uns!"
    
    Beispiel-Output:
    "👥 Gestern im Client-Call: 'Warum performen unsere Posts plötzlich schlechter?'
    
    🔍 Die Analyse zeigte: Algorithmus-Update vor 2 Wochen.
    
    💡 Unsere Lösung: Content-Format gewechselt → +65% Reichweite in 5 Tagen
    
    Erlebt ihr auch Schwankungen? Wie geht ihr damit um? 💬
    
    #agenturleben #algorithmus #contentmarketing #problemlösung"
  `;
  
  const result = await runAgent(null as any, prompt);
  postCounter++;
  return parseSimpleResponse(result);
}

async function generateTipsPost(): Promise<string> {
  const variation = TIP_VARIATIONS[postCounter % TIP_VARIATIONS.length];
  const topic = variation.topics[Math.floor(Math.random() * variation.topics.length)];
  
  const prompt = `
    Erstelle einen ${variation.style}en Marketing-Tipp Post zum Thema: "${topic}"
    
    Format-Vorgabe: "${variation.format}"
    (Ersetze {tip}, {benefit}, {result}, {reason}, {time}, {impact} mit konkreten Inhalten)
    
    Anforderungen:
    - Deutsch, professionell aber persönlich
    - Konkret und umsetzbar
    - 300-400 Zeichen (länger als bisher!)
    - Unterschiedlich zu vorherigen Posts
    - Regt zur Interaktion an
    
    Variiere diese Elemente:
    - Emoji-Auswahl
    - Fragestellung
    - Call-to-Action
    - Tonalität (mal direkter, mal sanfter)
    
    Beispiel-Output:
    "🎯 Marketing-Hack: Teste deine Posts zu verschiedenen Uhrzeiten!
    
    📊 Ergebnis: 40% mehr Engagement zur optimalen Zeit
    
    🕐 Beste Zeiten: 8-9 Uhr, 12-13 Uhr, 19-20 Uhr
    
    Wer testet es diese Woche? 🚀
    
    #socialmediatips #engagement #timing #marketinghack"
  `;
  
  const result = await runAgent(null as any, prompt);
  postCounter++;
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
  const style = MOTIVATIONAL_STYLES[Math.floor(Math.random() * MOTIVATIONAL_STYLES.length)];
  const dayOfWeek = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
  
  const prompt = `
    Erstelle einen motivierenden ${dayOfWeek}-Post mit Fokus auf: "${style}"
    
    Anforderungen:
    - 300-400 Zeichen
    - Business-relevant für Unternehmer/Marketing-Manager
    - Inspirierend aber nicht kitschig
    - Regt zum Nachdenken an
    - Bezug zu aktueller Jahreszeit/Datum
    
    Stil-Optionen (wähle eine):
    1. Persönliche Reflektion + Business-Lesson
    2. Herausforderung + Lösungsansatz
    3. Erfolgs-Mindset + praktischer Rat
    4. Team-Gedanke + Umsetzungs-Tipp
    
    Unterschiedliche Emojis verwenden:
    - 💪🚀🎯⚡🌟💫🔥✨🎪🎭
    
    Beispiel-Output:
    "⚡ ${dayOfWeek}-Gedanke: Die besten Marketing-Ideen entstehen oft in den ruhigen Momenten.
    
    🤔 Letzte Woche beim Kaffee: Plötzlich die Lösung für ein 3-Monate-altes Client-Problem.
    
    💡 Mein Learning: Bewusst Pausen einbauen. Das Gehirn braucht Leerlauf für Kreativität.
    
    Wann hattet ihr eure beste Idee? ☕
    
    #kreativität #pausenpower #marketingmindset #ideenfindung"
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
