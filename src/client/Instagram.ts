import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Browser, Page, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import { Server } from "proxy-chain";
import path from "path";
import logger from "../config/logger";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";
import { ConfigManager } from './services/ConfigManager';

// Import our services
import { ActivityManager, ActivityType } from "./services/ActivityManager";
import { ContentService } from "./services/ContentService";
import { ImageManager } from "./services/ImageManager";
import { HistoryService } from "./services/HistoryService";

// Credentials from environment
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
      
      // Start activity manager
      this.activityManager.start();
      
      // Register activity handlers
      this.registerActivityHandlers();
      
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
    logger.info("ℹ️ Stopping Instagram Bot...");
    
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
    
    const cookiesExist = await Instagram_cookiesExist(this.cookiesPath);
    if (cookiesExist) {
      logger.info("🍪 Loading existing cookies.");
      const cookies = await loadCookies(this.cookiesPath);
      if (cookies && cookies.length > 0) {
        await this.page!.setCookie(...cookies);
      }
      await this.page!.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });

      // Check if logged in
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
      await this.page!.goto("https://www.instagram.com/accounts/login/");
      await this.page!.waitForSelector('input[name="username"]', { timeout: 10000 });

      await this.page!.type('input[name="username"]', IGusername);
      await this.page!.type('input[name="password"]', IGpassword);
      await this.page!.click('button[type="submit"]');

      await this.page!.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      // Save cookies
      const cookies = await this.page!.cookies();
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
    logger.info("📋 Activity handlers registered");
  }

  /**
   * Main activity loop
   */
  private async runMainLoop(): Promise<void> {
    logger.info("🔄 Starting main activity loop...");
    
    while (this.isRunning) {
      try {
        const status = this.activityManager.getStatus();
        
        // Handle posting activity
        if (status.currentActivity === ActivityType.POSTING && status.isProcessing) {
          await this.handlePostingActivity();
        }
        
        // Handle commenting and liking when idle (currently disabled)
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
   * Ensure user is logged in before critical actions
   */
  private async ensureLoggedIn(): Promise<void> {
    try {
      // Load existing cookies
      const existing = await loadCookies(this.cookiesPath).catch(() => null);
      if (existing?.length) {
        await this.page!.setCookie(...existing);
      }

      // Check session expiry
      const now = Math.floor(Date.now() / 1000);
      const sess = (existing || []).find((c: any) => c.name === "sessionid");
      const expired = !sess || (typeof sess.expires === "number" && sess.expires > 0 && sess.expires < now);

      if (expired) {
        logger.warn("⚠️ Session expired/missing → Login with credentials.");
        await this.loginWithCredentials();
        return;
      }

      // UI Health Check
      await this.navigateToHome();
      const isLoggedIn = await this.page!.$("a[href='/direct/inbox/']");
      if (!isLoggedIn) {
        logger.warn("⚠️ UI check failed → Login with credentials.");
        await this.loginWithCredentials();
      }
    } catch (e) {
      logger.warn("⚠️ ensureLoggedIn(): Error, trying re-login.", e as any);
      await this.loginWithCredentials();
    }
  }

  /**
   * Navigate to Instagram home (integrated from InstagramAPI)
   */
  private async navigateToHome(): Promise<void> {
    const currentUrl = this.page!.url();
    if (currentUrl === 'https://www.instagram.com/' || currentUrl === 'https://www.instagram.com') {
      logger.info("📍 Already on Instagram home page");
      return;
    }
    
    logger.info("📍 Navigating to Instagram home...");
    await this.page!.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
    await this.delay(3000);
    logger.info("✅ Successfully navigated to home");
  }

  /**
   * Handle posting activity - CLEANED VERSION
   */
  private async handlePostingActivity(): Promise<void> {
    await this.ensureLoggedIn();
    
    try {
      logger.info("📝 Starting intelligent post creation...");
      
      // 1. Generate unique content based on history
      const { content, imagePath } = await this.generateUniqueContent();
      
      logger.info(`📝 Post text (${content.length} chars): "${content.substring(0, 100)}..."`);
      logger.info(`🖼️ Image selected: ${path.basename(imagePath)}`);

      // 2. Navigate to Instagram home
      await this.navigateToHome();

      // 3. Click create button
      await this.clickCreateButton();

      // 4. Upload image
      await this.uploadImage(imagePath);

      // 5. Skip editing steps (2x Next)
      for (let i = 0; i < 2; i++) {
        logger.info(`Clicking Next button ${i + 1}/2`);
        await this.clickNextButton();
        await this.delay(2000);
      }

      // 6. Add caption
      logger.info("Adding caption...");
      await this.addCaption(content);
      await this.delay(5000);

      // 7. Share the post
      await this.sharePost();
      
      logger.info("Waiting 15 seconds for upload completion...");
      await this.delay(15000);
      
      // 8. Verify and save to database
      const success = await this.verifyPostSuccess();
      
      await this.historyService.savePost({
        content,
        contentHash: this.createContentHash(content),
        postType: 'instagram_post',
        imagePath,
        imageCategory: this.imageManager.determineCategoryFromContent(content)
      });
      
      if (success) {
        logger.info("✅ Post created and saved successfully");
      } else {
        logger.warn("⚠️ Post verification unclear, but saved to history");
      }
      
      // Notify ActivityManager
      this.activityManager.completeActivity(ActivityType.POSTING, success);
      
    } catch (error) {
      logger.error("❌ Posting activity failed:", error);
      
      // Screenshot for debugging
      try {
        const errorScreenshot = `debug/error_${Date.now()}.png`;
        await this.page!.screenshot({ path: errorScreenshot });
        logger.info(`Screenshot saved: ${errorScreenshot}`);
      } catch (e) {
        // Ignore screenshot errors
      }
      
      this.activityManager.completeActivity(ActivityType.POSTING, false);
      throw error;
    }
  }

  /**
   * Generate unique content - SIMPLIFIED VERSION
   */
  private async generateUniqueContent(): Promise<{content: string, imagePath: string}> {
    try {
      logger.info("🔍 Analyzing post history for unique content generation...");
      
      // Get history guidelines
      const guidelines = await this.historyService.analyzeRecentPosts();
      
      // Generate content with history awareness
      const generatedContent = await this.contentService.generatePost({
        avoidKeywords: guidelines.avoidKeywords,
        preferredTopics: guidelines.recommendedTopics
      });
      
      // Check for exact duplicates only
      const isDuplicate = await this.historyService.isDuplicate(generatedContent.contentHash);
      
      if (isDuplicate) {
        logger.warn("⚠️ Duplicate detected, using fallback");
        const fallbackContent = this.configManager.getRandomBackupPost();
        const fallbackImage = await this.imageManager.getImageForContent(fallbackContent);
        return { content: fallbackContent, imagePath: fallbackImage };
      }
      
      // Generate AI image based on theme
      const imagePath = await this.imageManager.getImageForContent(
        generatedContent.text,
        generatedContent.theme
      );
      
      return { content: generatedContent.text, imagePath };
      
    } catch (error) {
      logger.error("❌ Content generation failed, using fallback:", error);
      const fallbackContent = this.configManager.getRandomBackupPost();
      const fallbackImage = await this.imageManager.getImageForCategory('default');
      return { content: fallbackContent, imagePath: fallbackImage };
    }
  }

  /**
   * Click create button
   */
  private async clickCreateButton(): Promise<void> {
    const selectors = [
      'svg[aria-label*="New post"]',
      'svg[aria-label*="Create"]',
      'svg[aria-label*="Neuer Beitrag"]',
      'svg[aria-label*="Beitrag erstellen"]',
      'a[href="#"] svg',
      'div[role="menuitem"] svg'
    ];

    for (const selector of selectors) {
      try {
        await this.page!.waitForSelector(selector, { timeout: 3000, visible: true });
        await this.page!.click(selector);
        logger.info(`✅ Create button clicked: ${selector}`);
        await this.delay(2000);
        return;
      } catch (e) {
        continue;
      }
    }
    throw new Error("Create button not found");
  }

  /**
   * Upload image file
   */
  private async uploadImage(imagePath: string): Promise<void> {
    const fileSel = 'input[type="file"][accept*="image"]';
    await this.page!.waitForSelector(fileSel, { timeout: 15000 });
    
    const fileInput = await this.page!.$(fileSel);
    if (!fileInput) throw new Error("File input not found");
    
    await fileInput.uploadFile(imagePath);
    logger.info(`✅ Image uploaded: ${path.basename(imagePath)}`);
    await this.delay(3000);
  }

  /**
   * Click Next button
   */
  private async clickNextButton(): Promise<void> {
    const clicked = await this.page!.evaluate(() => {
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
    
    if (!clicked) {
      // Fallback method
      await this.page!.waitForFunction(
        () => {
          const dialog = document.querySelector('div[role="dialog"]');
          if (!dialog) return false;
          
          const btn = [...dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')]
            .find(b => {
              const text = (b.innerText || "").trim().toLowerCase();
              return (text === 'weiter' || text === 'next' || text === 'continue') && 
                     !b.hasAttribute("disabled");
            });
          
          if (btn) {
            btn.click();
            return true;
          }
          return false;
        },
        { timeout: 20000 }
      );
    }
    
    logger.info("✅ Next button clicked");
  }

  /**
   * Add caption to post
   */
  private async addCaption(text: string): Promise<void> {
    const sel = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
    await this.page!.waitForSelector(sel, { timeout: 10000, visible: true });
    
    const captionBox = await this.page!.$(sel);
    if (!captionBox) throw new Error("Caption box not found");
    
    await captionBox.click({ clickCount: 1 });
    await this.page!.keyboard.down("Control");
    await this.page!.keyboard.press("A");
    await this.page!.keyboard.up("Control");
    await this.page!.keyboard.press("Backspace");
    await this.page!.type(sel, text, { delay: 25 });
    await this.delay(500);
    await this.page!.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await this.delay(300);
    
    const currentText = await this.page!.evaluate(
      s => document.querySelector<HTMLElement>(s)?.innerText || "", 
      sel
    );
    logger.info(`✅ Caption added (${currentText.length} characters)`);
  }

  /**
   * Share the post
   */
  private async sharePost(): Promise<void> {
    logger.info("Waiting for Share button to be ready...");
    
    // Wait for any processing to complete
    try {
      await this.page!.waitForFunction(
        () => !document.querySelector('div[role="progressbar"]'), 
        { timeout: 60000 }
      );
    } catch {
      logger.warn("Progress spinner remained visible - continuing anyway");
    }
    
    // Click share button
    const clicked = await this.page!.waitForFunction(
      () => {
        const dialog = document.querySelector('div[role="dialog"]');
        if (!dialog) return false;
        
        const btn = [...dialog.querySelectorAll<HTMLElement>('button, div[role="button"]')]
          .find(b => {
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
      { timeout: 60000 }
    );
    
    if (!clicked) throw new Error("Share button not clickable");
    logger.info("✅ Share button clicked, waiting for completion...");
    
    // Wait for navigation or success indicator
    await this.page!.waitForFunction(
      () => window.location.pathname === '/' || 
            !!document.querySelector('[data-testid="upload-flow-success-toast"]'),
      { timeout: 60000 }
    );
  }

  /**
   * Verify if post was successful
   */
  private async verifyPostSuccess(): Promise<boolean> {
    try {
      await this.page!.waitForSelector('div[role="dialog"]', { 
        timeout: 3000, 
        hidden: true 
      });
      return true;
    } catch {
      // Check for other success indicators
      const hasSuccessToast = await this.page!.$('[data-testid="upload-flow-success-toast"]');
      const isOnHomePage = this.page!.url() === 'https://www.instagram.com/';
      return !!(hasSuccessToast || isOnHomePage);
    }
  }

  /**
   * Handle engagement activities (commenting, liking) - KEPT BUT DISABLED
   */
  private async handleEngagementActivities(): Promise<void> {
    try {
      logger.info("🔍 Starting engagement activities...");
      
      // Navigate to home feed
      await this.navigateToHome();
      
      // TODO: Implement engagement logic when needed
      logger.info("⏸️ Engagement activities currently disabled");
      
    } catch (error) {
      logger.error("❌ Engagement activities failed:", error);
    }
  }

  /**
   * Create content hash for duplicate detection
   */
  private createContentHash(content: string): string {
    return require('crypto').createHash('md5').update(content).digest('hex');
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
        await this.proxyServer.close(true);
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