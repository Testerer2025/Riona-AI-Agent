import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import AdblockerPlugin from "puppeteer-extra-plugin-adblocker";
import { Browser, Page, DEFAULT_INTERCEPT_RESOLUTION_PRIORITY } from "puppeteer";
import { Server } from "proxy-chain";
import logger from "../config/logger";
import { IGpassword, IGusername } from "../secret";
import { Instagram_cookiesExist, loadCookies, saveCookies } from "../utils";

// Import our new services
import { ActivityManager, ActivityType } from "./services/ActivityManager";
import { ContentService, GeneratedContent } from "./services/ContentService";
import { ImageManager } from "./services/ImageManager";
import { HistoryService } from "./services/HistoryService";
import { InstagramAPI } from "./services/InstagramAPI";

// Configure Puppeteer plugins
puppeteer.use(StealthPlugin());
puppeteer.use(AdblockerPlugin({
  interceptResolutionPriority: DEFAULT_INTERCEPT_RESOLUTION_PRIORITY,
}));

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
    
    const cookiesExist = await Instagram_cookiesExist();
    
    if (cookiesExist) {
      logger.info("🍪 Loading existing cookies...");
      const cookies = await loadCookies(this.cookiesPath);
      await this.page!.setCookie(...cookies);
      
      await this.page!.goto("https://www.instagram.com/", { waitUntil: 'networkidle2' });
      
      // Verify login
      const isLoggedIn = await this.page!.$("a[href='/direct/inbox/']");
      if (isLoggedIn) {
        logger.info("✅ Authentication successful with cookies");
        return;
      } else {
        logger.warn("⚠️ Cookies invalid, logging in with credentials...");
      }
    }
    
    // Login with credentials
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
      const cookies = await this.browser!.cookies();
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
        
        // Handle posting activity
        if (status.currentActivity === ActivityType.POSTING) {
          await this.handlePostingActivity();
        }
        
        // Handle commenting and liking when idle
        if (status.currentActivity === ActivityType.IDLE && !status.isProcessing) {
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
   * Handle posting activity
   */
  private async handlePostingActivity(): Promise<void> {
    try {
      logger.info("📝 Executing posting activity...");
      
      // Navigate to home page
      await this.instagramAPI.navigateToHome();
      
      // Check for duplicate content using history service
      const historyGuidelines = await this.historyService.analyzeRecentPosts();
      
      // Generate content with history awareness
      const content = await this.contentService.generatePost({
        avoidKeywords: historyGuidelines.avoidKeywords || [],
        preferredTopics: historyGuidelines.recommendedTopics || []
      });
      
      // Validate content isn't duplicate
      const isDuplicate = await this.historyService.isDuplicate(content.contentHash);
      if (isDuplicate) {
        logger.warn("⚠️ Generated content is duplicate, regenerating...");
        const newContent = await this.contentService.generatePost();
        await this.executePost(newContent);
      } else {
        await this.executePost(content);
      }
      
    } catch (error) {
      logger.error("❌ Posting activity failed:", error);
      // Activity manager will handle cleanup
    }
  }

  /**
   * Execute actual posting
   */
  private async executePost(content: GeneratedContent): Promise<void> {
    try {
      logger.info(`📤 Posting content: "${content.text.substring(0, 100)}..."`);
      
      // Get appropriate image
      const imagePath = await this.imageManager.getImageForCategory(content.imageCategory);
      
      // Upload and post via Instagram API
      await this.instagramAPI.createPost(content.text, imagePath);
      
      // Save to history
      await this.historyService.savePost({
        content: content.text,
        contentHash: content.contentHash,
        postType: content.postType,
        imagePath,
        imageCategory: content.imageCategory
      });
      
      logger.info("✅ Post created successfully");
      
    } catch (error) {
      logger.error("❌ Post execution failed:", error);
      throw error;
    }
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