import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Browser, Page, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import { Server } from "proxy-chain";
import path from "path";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { ConfigManager } from './services/ConfigManager';

// Import our new services
import { ActivityManager, ActivityType } from "./services/ActivityManager";
import { ContentService, GeneratedContent } from "./services/ContentService";
import { ImageManager } from "./services/ImageManager";
import { HistoryService } from "./services/HistoryService";
import { InstagramAPI } from "./services/InstagramAPI";

// FEHLENDE IMPORTS - basierend auf anderen Dateien im Projekt
import { Post } from "../models"; // MongoDB Model (eine Ebene hoch zu src/, dann models/)
import { runAgent } from "../Agent"; // AI Agent function (eine Ebene hoch zu src/, dann Agent.ts)

// ✅ Credentials direkt aus Render-Env lesen
const IGusername = (process.env.IGusername ?? process.env.IG_USERNAME ?? "").trim();
const IGpassword = (process.env.IGpassword ?? process.env.IG_PASSWORD ?? "").trim();

function assertInstagramCreds() {
  if (!IGusername || !IGpassword) {
    throw new Error("Instagram-Credentials fehlen. Bitte IGusername/IGpassword in Render → Environment Variables setzen.");
  }
}


// Configure Puppeteer plugins
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({
  interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
}));

assertInstagramCreds();

export class InstagramBot {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private proxyServer: Server | null = null;
  private isRunning: boolean = false;

  // Core Services
  private activityManager: ActivityManager;
  private contentService: ContentService;
  private imageManager: ImageManager;
  private historyService: HistoryService;
  private instagramAPI: InstagramAPI;
  private configManager: ConfigManager;

  // Configuration
  private readonly isTestMode: boolean;
  private readonly cookiesPath = "/persistent/Instagramcookies.json";

  constructor(testMode: boolean = false) {
    this.isTestMode = testMode || process.env.TEST_MODE === 'true';
    
    // Initialize services
    this.activityManager = new ActivityManager(this.isTestMode);
    this.contentService = new ContentService();
    this.imageManager = new ImageManager();
    this.historyService = new HistoryService();
    this.instagramAPI = new InstagramAPI();
    this.configManager = new ConfigManager();

    logger.info(`🤖 InstagramBot initialized (${this.isTestMode ? 'TEST' : 'PRODUCTION'} mode)`);
  }

  /**
   * Start the Instagram bot
   */
  public async start(): Promise<void> {
    try {
      logger.info("🚀 Starting Instagram Bot...");
      
      // Setup browser and authentication
      await this.initializeBrowser();
      await this.authenticateUser();
      
      // Setup services with page reference
      this.instagramAPI.setPage(this.page!);
      
      // Start activity manager
      this.activityManager.start();
      
      // Register activity handlers
      this.registerActivityHandlers();
      
      // TODO: Health check endpoint setup (disabled for now)
      // this.setupHealthCheck();
      
      this.isRunning = true;
      logger.info("✅ Instagram Bot started successfully!");
      
      // Start main loop
      await this.runMainLoop();
      
    } catch (error) {
      logger.error("❌ Failed to start Instagram Bot:", error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * Stop the bot gracefully
   */
  public async stop(): Promise<void> {
    logger.info("⏹️ Stopping Instagram Bot...");
    
    this.isRunning = false;
    
    if (this.activityManager) {
      this.activityManager.stop();
    }
    
    await this.cleanup();
    
    logger.info("✅ Instagram Bot stopped");
  }

  /**
   * Initialize browser with proxy and stealth settings
   */
  private async initializeBrowser(): Promise<void> {
    logger.info("🌐 Initializing browser...");
    
    // Setup proxy server
    this.proxyServer = new Server({ port: 8000 });
    await this.proxyServer.listen();
    const proxyUrl = `http://localhost:8000`;
    
    // Launch browser
    this.browser = await puppeteer.launch({
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      headless: true,
      args: [
        `--proxy-server=${proxyUrl}`,
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor"
      ],
    });

    this.page = await this.browser.newPage();
    
    // Set realistic viewport and user agent
    await this.page.setViewport({ width: 1366, height: 768 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    logger.info("✅ Browser initialized");
  }

  /**
   * Authenticate user with cookies or credentials
   */
  private async authenticateUser(): Promise<void> {
    logger.info("🔐 Authenticating user...");
    
    // in authenticateUser()
  const cookiesExist = await Instagram_cookiesExist(this.cookiesPath);
  if (cookiesExist) {
    logger.info("🍪 Loading existing cookies.");
    const cookies = await loadCookies(this.cookiesPath);
    if (cookies && cookies.length > 0) {
      await this.page!.setCookie(...cookies); // <-- WICHTIG: Spread
    }
    await this.page!.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });

    // Health-Check: eingeloggte UI?
    const isLoggedIn = await this.page!.$("a[href='/direct/inbox/']");
    if (isLoggedIn) {
      logger.info("✅ Authentication successful with cookies");
      return;
    }
    logger.warn("⚠️ Cookies invalid, logging in with credentials.");
  }

  // Fallback: Login via Credentials
  await this.loginWithCredentials();
  logger.info("✅ Authentication successful");
  }

  /**
   * Login with username and password
   */
  private async loginWithCredentials(): Promise<void> {
    try {
      // in loginWithCredentials()
      await this.page!.goto("https://www.instagram.com/accounts/login/");
      await this.page!.waitForSelector('input[name="username"]', { timeout: 10000 });

      await this.page!.type('input[name="username"]', IGusername);
      await this.page!.type('input[name="password"]', IGpassword);
      await this.page!.click('button[type="submit"]');

      await this.page!.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      // Cookies korrekt lesen und speichern
      const cookies = await this.page!.cookies(); // <-- statt this.browser!.cookies()
      await saveCookies(this.cookiesPath, cookies);

      logger.info("✅ Login successful, cookies saved");

      
    } catch (error) {
      logger.error("❌ Login failed:", error);
      throw new Error("Authentication failed");
    }
  }

  /**
   * Register handlers for different activity types
   */
  private registerActivityHandlers(): void {
    // Note: In a more advanced implementation, we could use an event system
    // For now, we'll handle activities directly in the main loop
    logger.info("📋 Activity handlers registered");
  }

  /**
   * Setup health check for Render.com
   */
  private setupHealthCheck(): void {
    // Simple HTTP server for health checks
    const http = require('http');
    const port = process.env.PORT || 10000; // Use Render's PORT or high fallback
    
    const server = http.createServer((req: any, res: any) => {
      if (req.url === '/health') {
        const status = this.activityManager.getStatus();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          uptime: process.uptime(),
          bot: {
            running: this.isRunning,
            ...status
          }
        }));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });
    
    server.listen(port, () => {
      logger.info(`🏥 Health check server running on port ${port}`);
    }).on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        logger.warn(`⚠️ Port ${port} in use, health check disabled`);
      } else {
        logger.error('Health check server error:', err);
      }
    });
  }

  /**
   * Main activity loop
   */
  private async runMainLoop(): Promise<void> {
    logger.info("🔄 Starting main activity loop...");
    
    while (this.isRunning) {
      try {
        const status = this.activityManager.getStatus();
        
        // Handle posting activity - REAL IMPLEMENTATION
        if (status.currentActivity === ActivityType.POSTING && status.isProcessing) {
          await this.handlePostingActivity();
        }
        
        // Handle commenting and liking when idle - TEMPORARILY DISABLED FOR TESTING
        if (false && status.currentActivity === ActivityType.IDLE && !status.isProcessing) {
          await this.handleEngagementActivities();
        }
        
        // Wait before next iteration
        await this.delay(30000); // 30 seconds
        
      } catch (error) {
        logger.error("❌ Error in main loop:", error);
        await this.delay(60000); // Wait 1 minute on error
      }
    }
  }

  /**
 * Prüft vor kritischen Aktionen, ob Session/Cookies gültig sind,
 * und führt bei Bedarf einen Re-Login durch.
 */
private async ensureLoggedIn(): Promise<void> {
  try {
    // 1) vorhandene Cookies injizieren
    const existing = await loadCookies(this.cookiesPath).catch(() => null);
    if (existing?.length) {
      await this.page!.setCookie(...existing);
    }

    // 2) Expiry-Check (sessionid)
    const now = Math.floor(Date.now() / 1000);
    const sess = (existing || []).find((c: any) => c.name === "sessionid");
    const expired = !sess || (typeof sess.expires === "number" && sess.expires > 0 && sess.expires < now);

    if (expired) {
      logger.warn("⚠️ Session abgelaufen/fehlend → Login mit Credentials.");
      await this.loginWithCredentials();
      return;
    }

    // 3) UI-Health-Check
    await this.page!.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    const isLoggedIn = await this.page!.$("a[href='/direct/inbox/']");
    if (!isLoggedIn) {
      logger.warn("⚠️ UI-Check fehlgeschlagen → Login mit Credentials.");
      await this.loginWithCredentials();
    }
  } catch (e) {
    logger.warn("⚠️ ensureLoggedIn(): Fehler, versuche Re-Login.", e as any);
    await this.loginWithCredentials();
  }
}



  /**
   * Handle posting activity - REAL IMPLEMENTATION with original postJoke
   */
  private async handlePostingActivity(): Promise<void> {
    await this.ensureLoggedIn();
    try {
      logger.info("📝 Executing posting activity...");
      
      // Navigate to home page
      await this.instagramAPI.navigateToHome();
      
      // Use original postJoke function (integrated)
      await this.postJoke(this.page!);
      
      // FIXED: Notify ActivityManager that posting is complete
      this.activityManager.completeActivity(ActivityType.POSTING, true);
      
    } catch (error) {
      logger.error("❌ Posting activity failed:", error);
      
      // FIXED: Notify ActivityManager that posting failed
      this.activityManager.completeActivity(ActivityType.POSTING, false);
      throw error;
    }
  }

  /**
   * Original postJoke function - integrated into new architecture
   */
  private async postJoke(page: Page): Promise<void> {
    try {
      logger.info("🚀 Starte intelligente Post-Erstellung mit Historie-Analyse...");

      // Generate post based on history analysis
      const { content: jokeContent, imagePath } = await this.generateUniquePostBasedOnHistory();
      
      // Basic duplicate check
      const validation = await this.checkBasicDuplicates(jokeContent, imagePath);
      let finalImagePath = imagePath;
      
      if (!validation.isValid && validation.reason === 'recent_duplicate_image') {
        logger.info("🔄 Wähle anderes Bild wegen Recent-Duplikat...");
        finalImagePath = await this.imageManager.getImageForCategory(this.imageManager.determineCategoryFromContent(jokeContent));
        logger.info(`📷 Neues Bild gewählt: ${path.basename(finalImagePath)}`);
      }
      
      logger.info(`📝 Finaler Post-Text: "${jokeContent.substring(0, 100)}..."`);
      logger.info(`🖼️ Gewähltes Bild: ${path.basename(finalImagePath)}`);

      // Navigate to Instagram home
      await page.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
      await this.delay(2000);

      // Find and click "+" icon
      await this.clickCreateButton(page);

      // Upload image
      await this.uploadImage(page, finalImagePath);

      // Skip editing steps (2x Next)
      for (let i = 0; i < 2; i++) {
        logger.info(`Klicke Weiter-Button ${i + 1}/2`);
        await this.clickNextButton(page);
        await this.delay(2000);
      }

      // Add caption
      logger.info("Beginne Caption-Eingabe...");
      await this.findAndFillCaption(page, jokeContent);

      logger.info("Warte 5 Sekunden damit Instagram Text verarbeitet...");
      await this.delay(5000);

      // Share the post
      await this.clickShareButton(page);
      
      logger.info("Warte 15 Sekunden auf Upload-Completion...");
      await this.delay(15000);
      
      // Check if post was successful
      try {
        await page.waitForSelector('div[role="dialog"]', { timeout: 3000, hidden: true });
        logger.info("✅ Post erfolgreich geteilt - Dialog verschwunden!");
        
        // Save to database AFTER successful posting
        await this.savePostToDatabase(jokeContent, finalImagePath);
        
      } catch (e) {
        logger.warn("⚠️ Dialog noch sichtbar - Post möglicherweise nicht erfolgreich");
        // Save anyway - might have been successful
        await this.savePostToDatabase(jokeContent, finalImagePath);
      }

      // FIXED: Success logging moved to end of actual posting process
      logger.info("✅ Post created successfully");
      
    } catch (error) {
      logger.error("Gesamter Post-Prozess fehlgeschlagen:", error);
      throw error;
    }
  }

  /**
   * Generate unique post based on history analysis - RESTORED ORIGINAL INTELLIGENCE
   */
private async generateUniquePostBasedOnHistory(): Promise<{content: string, imagePath: string}> {
  try {
    logger.info("🔍 Analysiere Post-Historie für intelligente Content-Generierung...");
    
    // 1. ERST Theme wählen
    const selectedTheme = this.configManager.selectWeightedTheme();
    logger.info(`📋 Theme gewählt: ${selectedTheme.name} (${selectedTheme.id})`);
    
    // 2. Lade die letzten Posts für Analyse
    const recentPosts = await Post.find()
      .sort({ posted_at: -1 })
      .limit(25)
      .select('content posted_at');
    
    logger.info(`📊 Gefunden: ${recentPosts.length} Posts für Analyse`);
    
    if (recentPosts.length < 3) {
      logger.info("📝 Wenige Posts vorhanden - verwende vereinfachte Generierung");
      return await this.generateSimplePost();
    }
    
    // 3. Analysiere was zu VERMEIDEN ist (aus ALLEN Posts)
    const analysisPrompt = `
    Analysiere diese ${recentPosts.length} letzten Posts und identifiziere was NICHT wiederholt werden soll:

    BISHERIGE POSTS:
    ${recentPosts.map((post: any, index: number) => `${index + 1}. ${post.content}`).join('\n\n')}

    AUFGABE:
    Identifiziere KONKRETE Themen/Inhalte die in den Posts vorkommen und NICHT wiederholt werden sollten.
    
    Gib eine JSON-Antwort:
    {
      "avoid_topics": ["Konkrete Themen die vorkamen", "z.B. Kampagnen-Fails", "Teammeeting-Stories"],
      "avoid_keywords": ["Spezifische Begriffe", "Die zu oft verwendet wurden"],
      "content_patterns": ["Inhaltsmuster die sich wiederholen", "z.B. Umfrage-Ergebnisse"]
    }
    `;

    logger.info("🤖 Analysiere was vermieden werden soll...");
    const analysisResponse = await runAgent(null as any, analysisPrompt);
    
    let avoidanceList: any;
    try {
      const responseText = typeof analysisResponse === 'string' ? analysisResponse : JSON.stringify(analysisResponse);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        avoidanceList = JSON.parse(jsonMatch[0]);
        logger.info("✅ Analyse erfolgreich");
        logger.info(`🚫 Zu vermeiden: ${avoidanceList.avoid_topics?.slice(0, 3).join(', ')}...`);
      }
    } catch (parseError) {
      logger.warn("⚠️ Analyse-Parsing fehlgeschlagen, verwende Defaults");
      avoidanceList = { avoid_topics: [], avoid_keywords: [] };
    }

    // 4. Generiere Post mit Theme + Ausschlüssen
    const themePrompt = this.configManager.loadPromptFromFile(selectedTheme) || selectedTheme.prompt;
    
    const finalPrompt = `
    ${this.configManager.buildCharacterContext()}
    
    THEME: ${selectedTheme.name}
    ${themePrompt}
    
    WICHTIG - Diese Inhalte NICHT verwenden (wurden kürzlich gepostet):
    - Vermeide diese Themen: ${avoidanceList.avoid_topics?.join(', ') || 'keine'}
    - Vermeide diese Wörter: ${avoidanceList.avoid_keywords?.join(', ') || 'keine'}
    - Vermeide diese Muster: ${avoidanceList.content_patterns?.join(', ') || 'keine'}
    
    Erstelle einen FRISCHEN ${selectedTheme.name} Post der diese Inhalte NICHT wiederholt.
    
    Gib NUR den Post-Text zurück.
    `;

    logger.info(`🎨 Generiere ${selectedTheme.name} mit Ausschluss bisheriger Inhalte...`);
    const postResponse = await runAgent(null as any, finalPrompt);
    const postContent = this.parseAIResponse(postResponse);

    // 5. Generate image based on theme config
    logger.info("🤖 Generating AI image based on theme configuration...");
    const imagePath = await this.imageManager.getImageForContent(postContent, selectedTheme);

    // 6. Final duplicate check
    const contentHash = require('crypto').createHash('md5').update(postContent).digest('hex');
    const exactDuplicate = await Post.findOne({ content_hash: contentHash });
    
    if (exactDuplicate) {
      logger.warn("❌ Exakter Duplikat trotz Analyse - verwende Fallback");
      return await this.generateSimplePost();
    }

    logger.info("✅ Intelligenter Post mit Historie-Ausschlüssen generiert");
    logger.info(`📝 Theme: ${selectedTheme.name}`);
    logger.info(`📝 Post (${postContent.length} Zeichen): "${postContent.substring(0, 100)}..."`);
    
    return { content: postContent, imagePath };

  } catch (error) {
    logger.error("❌ Intelligente Post-Generierung fehlgeschlagen:", error);
    return await this.generateSimplePost();
  }
}

  /**
   * Generate simple post as fallback
   */
  private async generateSimplePost(): Promise<{content: string, imagePath: string}> {
    logger.info("🔄 Fallback zu einfacher Post-Generierung...");
    
    const content = await this.contentService.generatePost();
    const imagePath = await this.imageManager.getImageForContent(content.text, content.theme);
    
    return { content: content.text, imagePath };
  }

  /**
   * Parse AI response - RESTORED ORIGINAL METHOD
   */
  private parseAIResponse(response: any): string {
    try {
      if (Array.isArray(response)) {
        if (response[0]?.instagram_post) return response[0].instagram_post;
        if (response[0]?.friday_post) return response[0].friday_post;        
        if (response[0]?.motivational_post) return response[0].motivational_post; 
        if (response[0]?.agency_post) return response[0].agency_post;        
        if (response[0]?.tip_post) return response[0].tip_post;              
        if (response[0]?.witz) return response[0].witz;
        if (response[0]?.joke) return response[0].joke;
        if (response[0]?.content) return response[0].content;
        if (response[0]?.post) return response[0].post;
        if (typeof response[0] === "string") return response[0];
      }
      
      if (typeof response === "object" && response !== null) {
        if (response.instagram_post) return String(response.instagram_post);
        if (response.friday_post) return String(response.friday_post);        
        if (response.motivational_post) return String(response.motivational_post); 
        if (response.agency_post) return String(response.agency_post);        
        if (response.tip_post) return String(response.tip_post);              
        if (response.witz) return String(response.witz);
        if (response.Witz) return String(response.Witz);
        if (response.joke) return String(response.joke);
        if (response.Joke) return String(response.Joke);
        if (response.content) return String(response.content);
        if (response.post) return String(response.post);
      }
      
      if (typeof response === "string") {
        try {
          const parsed = JSON.parse(response);
          if (Array.isArray(parsed) && parsed[0]?.instagram_post) {
            return parsed[0].instagram_post;
          }
          if (Array.isArray(parsed) && parsed[0]?.friday_post) {          
            return parsed[0].friday_post;
          }
          if (Array.isArray(parsed) && parsed[0]?.witz) {
            return parsed[0].witz;
          }
          if (parsed?.instagram_post) return parsed.instagram_post;
          if (parsed?.friday_post) return parsed.friday_post;            
          if (parsed?.witz) return parsed.witz;
          return response;
        } catch {
          return response;
        }
      }
      
      // Fallback
      console.log("Unerwartetes Datenformat:", JSON.stringify(response));
      const responseObj = Array.isArray(response) ? response[0] : response;
      if (responseObj && typeof responseObj === 'object') {
        const firstValue = Object.values(responseObj)[0];
        if (typeof firstValue === 'string') {
          return firstValue;
        }
      }
      
      return this.configManager.getRandomBackupPost();
      
    } catch (error) {
      console.error("Parse Error:", error);
      return this.configManager.getRandomBackupPost();
    }
  }


  /**
   * Check for basic duplicates
   */
  private async checkBasicDuplicates(content: string, _imagePath: string): Promise<{isValid: boolean, reason?: string}> {
    const contentHash = require('crypto').createHash('md5').update(content).digest('hex');
    
    // KORRIGIERT: nur einen Parameter an isDuplicate übergeben
    const isDuplicate = await this.historyService.isDuplicate(contentHash);
    
    if (isDuplicate) {
      return { isValid: false, reason: 'duplicate_or_similar_content' };
    }
    
    return { isValid: true };
  }

  /**
   * Save post to database
   */
  private async savePostToDatabase(content: string, imagePath: string): Promise<void> {
    const contentHash = require('crypto').createHash('md5').update(content).digest('hex');
    
    await this.historyService.savePost({
      content,
      contentHash,
      postType: 'instagram_post',
      imagePath,
      imageCategory: this.imageManager.determineCategoryFromContent(content)
    });
    
    logger.info(`✅ Post in MongoDB gespeichert:`);
    logger.info(`📝 Content (${content.length} Zeichen): "${content}"`);
    logger.info(`🖼️ Image: ${path.basename(imagePath)}`);
    logger.info(`🔗 Hash: ${contentHash.substring(0, 12)}...`);
  }

  /**
   * Click create button (+ icon)
   */
private async clickCreateButton(page: Page): Promise<void> {
  // --- dein vorhandener Teil: Plus/Erstellen klicken ---
  const plusSelectors = [
    'svg[aria-label*="New post"]',
    'svg[aria-label*="Create"]',
    'svg[aria-label*="Neuer Beitrag"]',
    'svg[aria-label*="Beitrag"]',
    'a[role="link"]:has(svg[aria-label*="Neuer Beitrag"])',
    'a[role="link"]:has(svg[aria-label*="Create"])'
  ];

  let plusFound = false;
  for (const selector of plusSelectors) {
    try {
      await page.waitForSelector(selector, { timeout: 7000, visible: true });
      await page.click(selector);
      plusFound = true;
      logger.info(`PLUS geklickt: ${selector}`);
      break;
    } catch { /* try next */ }
  }
  if (!plusFound) {
    throw new Error('Plus-Icon/Erstellen nicht gefunden');
  }

  // --- 1) warte auf geöffnetes Dropdown neben "Erstellen" ---
  logger.info('Warte auf Dropdown (role=menu/Portal)…');
  await page.waitForFunction(() => {
    // Dropdown kommt als Portal/Popover; oft role="menu" oder aria-hidden=false
    return !!(document.querySelector('[role="menu"]') ||
              document.querySelector('div[aria-hidden="false"]'));
  }, { timeout: 10000 });

  // --- 2) im Dropdown den Punkt "Beitrag" anklicken ---
  logger.info('Suche im Dropdown nach "Beitrag"…');
  const clickedBeitrag = await page.evaluate(() => {
    const roots: Element[] = [];
    const menu = document.querySelector('[role="menu"]');
    if (menu) roots.push(menu);
    document.querySelectorAll<HTMLElement>('div[aria-hidden="false"]').forEach(d => roots.push(d));

    const matchText = (el: Element, needle: string) =>
      (el.textContent || '').trim().toLowerCase().includes(needle);

    for (const root of roots) {
      // mögliche Klickziele: a, div[role=menuitem], button
      const candidates = Array.from(root.querySelectorAll<HTMLElement>(
        'a, button, div[role="menuitem"], div[role="button"], span, div'
      ));
      const item = candidates.find(el => matchText(el, 'beitrag'));
      if (item) {
        (item as HTMLElement).click();
        return true;
      }
    }
    return false;
  });

  logger.info(`"Beitrag" im Dropdown geklickt: ${clickedBeitrag}`);
  if (!clickedBeitrag) {
    // Debug: einmal alle Texte loggen
    const txt = await page.evaluate(() => {
      const roots: Element[] = [];
      const menu = document.querySelector('[role="menu"]');
      if (menu) roots.push(menu);
      document.querySelectorAll<HTMLElement>('div[aria-hidden="false"]').forEach(d => roots.push(d));
      const texts: string[] = [];
      for (const r of roots) {
        r.querySelectorAll('*').forEach(n => {
          const t = (n.textContent || '').trim();
          if (t) texts.push(t.slice(0, 80));
        });
      }
      return texts.slice(0, 60);
    });
    logger.info('DEBUG Dropdown-Texte:', txt);
    throw new Error('Beitrag im Dropdown nicht gefunden/geklickt');
  }

  // --- 3) warte auf das Overlay "Neuen Beitrag erstellen" ---
  logger.info('Warte auf Overlay "Neuen Beitrag erstellen"…');
  await page.waitForSelector('div[role="dialog"]', { timeout: 15000, visible: true });
  // Überschrift ist manchmal [role=heading], manchmal <h1>
  await page.waitForFunction(() => {
    const dlg = document.querySelector('div[role="dialog"]');
    if (!dlg) return false;
    const heading = dlg.querySelector('[role="heading"], h1, h2');
    return heading && /neuen beitrag erstellen/i.test(heading.textContent || '');
  }, { timeout: 15000 });

  // --- 4) Button "Vom Computer auswählen" klicken ---
  logger.info('Klicke "Vom Computer auswählen"…');
  const chooseClicked = await page.evaluate(() => {
    const dlg = document.querySelector('div[role="dialog"]');
    if (!dlg) return false;

    const btns = Array.from(dlg.querySelectorAll<HTMLElement>('button, a[role="button"]'));
    const btn =
      btns.find(b => (b.textContent || '').toLowerCase().includes('vom computer auswählen')) ||
      btns.find(b => (b.textContent || '').toLowerCase().includes('vom computer')) ||
      btns.find(b => (b.textContent || '').toLowerCase().includes('auswählen'));

    if (btn) {
      (btn as HTMLElement).click();
      return true;
    }
    return false;
  });
  logger.info(`"Vom Computer auswählen" geklickt: ${chooseClicked}`);
  if (!chooseClicked) {
    // Fallback: manchmal ist der Button im Dialogbody nur 1 Button
    await page.click('div[role="dialog"] button');
  }

  // --- 5) jetzt erst kommt der file-input ins DOM → darauf warten ---
  logger.info('Warte auf file input…');
  await page.waitForFunction(() => {
    const sel = 'input[type="file"]';
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(sel));
    // Instagram setzt accept dynamisch; wir akzeptieren jedes file input im Dialog
    return inputs.some(i => i.isConnected && i.offsetParent !== null);
  }, { timeout: 20000 });

  // Optionales Debug: wie viele Inputs?
  const count = await page.evaluate(() => document.querySelectorAll('input[type="file"]').length);
  logger.info(`file inputs gefunden: ${count}`);
}



  /**
   * Upload image file
   */
  private async uploadImage(page: Page, imagePath: string): Promise<void> {
    try {
      const fileSel = 'input[type="file"][accept*="image"]';
      await page.waitForSelector(fileSel, { timeout: 15_000 });
      const fileInput = await page.$(fileSel);
      if (!fileInput) throw new Error("Kein Datei‑Input gefunden!");
      
      await fileInput.uploadFile(imagePath);
      logger.info("Bild erfolgreich hochgeladen");
      await this.delay(3000);
      
    } catch (error) {
      logger.error("Fehler beim Datei-Upload:", error);
      throw error;
    }
  }

  /**
   * Click Next button
   */
  private async clickNextButton(page: Page, timeout = 20_000): Promise<void> {
    try {
      logger.info(`Suche nach WEITER-Button...`);
      
      const nextButtonClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, div[role="button"]');
        for (const btn of buttons) {
          const text = btn.textContent?.trim().toLowerCase();
          if (text === 'weiter' || text === 'next' || text === 'continue') {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      });
      
      if (nextButtonClicked) {
        logger.info("✅ WEITER-Button gefunden und geklickt");
        return;
      }
      
      // Fallback
      const ok = await page.waitForFunction(
        () => {
          const dialog = document.querySelector<HTMLElement>('div[role="dialog"]');
          if (!dialog) return false;
          const btn = [...dialog.querySelectorAll<HTMLElement>('button,div[role="button"]')]
            .find(b => {
              const text = (b.innerText || "").trim().toLowerCase();
              return (text === 'weiter' || text === 'next' || text === 'continue') && 
                     !b.hasAttribute("disabled");
            });
          if (btn) {
            (btn as HTMLElement).click();
            return true;
          }
          return false;
        },
        { timeout }
      );

      if (!ok) throw new Error(`WEITER-Button nicht gefunden`);
      logger.info("✅ WEITER-Button über Fallback gefunden");
      
    } catch (error) {
      logger.error(`Fehler beim Klicken des WEITER-Buttons: ${error}`);
      throw error;
    }
  }

  /**
   * Click Share button
   */
  private async clickShareButton(page: Page): Promise<void> {
    logger.info("Warte auf aktivierten SHARE‑Button…");

    try {
      await page.waitForFunction(() => !document.querySelector('div[role="progressbar"]'), { timeout: 60_000 });
    } catch {
      logger.warn("Progress‑Spinner blieb sichtbar – fahre trotzdem fort");
    }

    const clicked = await page.waitForFunction(
      () => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;

        const btn = [...dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')].find(b => {
          const txt = (b.textContent || "").trim();
          const visible = b.offsetParent !== null;
          const enabled = !b.hasAttribute("disabled") &&
                          !(b as HTMLButtonElement).disabled &&
                          b.getAttribute("aria-disabled") !== "true";
          return visible && enabled && (txt === "Teilen" || txt === "Share");
        });

        if (btn) {
          btn.click();
          return true;
        }
        return false;
      },
      { timeout: 60_000 }
    );

    if (!clicked) throw new Error("Share‑Button nicht klickbar");
    logger.info("✅ Share‑Button geklickt, warte auf Dialog‑Verschwinden…");

    await page.waitForFunction(
      () => window.location.pathname === '/' ||
            !!document.querySelector('[data-testid="upload-flow-success-toast"]'),
      { timeout: 60_000 }
    );
  }

  /**
   * Find and fill caption
   */
  private async findAndFillCaption(page: Page, text: string): Promise<void> {
    logger.info(`Versuche Caption einzugeben: "${text.slice(0, 100)}…"`);
    
    const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
    await page.waitForSelector(sel, { timeout: 10_000, visible: true });
    const handle = await page.$(sel);
    if (!handle) throw new Error("Caption‑Feld nicht gefunden");

    await handle.click({ clickCount: 1 });
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.type(sel, text, { delay: 25 });
    await this.delay(500);
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    await this.delay(300);

    const current = await page.evaluate(s => document.querySelector<HTMLElement>(s)?.innerText || "", sel);
    logger.info(`Caption‑Länge nach Eingabe: ${current.length}`);
  }

  /**
   * Handle engagement activities (commenting, liking)
   */
  private async handleEngagementActivities(): Promise<void> {
    try {
      // Navigate to home feed
      await this.instagramAPI.navigateToHome();
      
      // Find posts to engage with
      const posts = await this.instagramAPI.getVisiblePosts(5);
      
      for (const post of posts) {
        // Skip own posts
        if (post.isOwnPost) {
          logger.info(`⏭️ Skipping own post by ${post.author}`);
          continue;
        }
        
        // Check if already interacted with this post
        const alreadyCommented = await this.historyService.hasCommentedOnPost(post.id);
        if (alreadyCommented) {
          logger.info(`⏭️ Already commented on post ${post.id}`);
          continue;
        }
        
        // Like the post
        await this.instagramAPI.likePost(post.selector);
        await this.delay(2000);
        
        // Generate and post comment
        const comment = await this.contentService.generateComment(post.caption);
        const success = await this.instagramAPI.commentOnPost(post.selector, comment);
        
        if (success) {
          // Save comment to history
          await this.historyService.saveComment({
            postId: post.id,
            postUrl: post.url,
            postAuthor: post.author,
            commentText: comment
          });
          
          logger.info(`✅ Commented on post by ${post.author}`);
        }
        
        // Wait between posts to avoid spam detection
        await this.delay(180000 + Math.random() * 60000); // 3-4 minutes
        
        // Break if we should stop
        if (!this.isRunning || this.activityManager.getStatus().currentActivity !== ActivityType.IDLE) {
          break;
        }
      }
      
    } catch (error) {
      logger.error("❌ Engagement activities failed:", error);
    }
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    try {
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      if (this.proxyServer) {
        await this.proxyServer.close(true); // Force close
        this.proxyServer = null;
      }
      
      this.page = null;
      
    } catch (error) {
      logger.error("❌ Cleanup error:", error);
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get bot status for monitoring
   */
  public getStatus(): any {
    return {
      running: this.isRunning,
      browser: !!this.browser,
      page: !!this.page,
      testMode: this.isTestMode,
      activities: this.activityManager.getStatus()
    };
  }
}

// Export the main function that starts everything
export async function runInstagram(): Promise<void> {
  const bot = new InstagramBot(process.env.TEST_MODE === 'true');
  
  // Handle graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('🛑 SIGTERM received, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });
  
  process.on('SIGINT', async () => {
    logger.info('🛑 SIGINT received, shutting down gracefully...');
    await bot.stop();
    process.exit(0);
  });
  
  // Start the bot
  await bot.start();
}