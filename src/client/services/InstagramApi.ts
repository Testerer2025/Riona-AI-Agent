import { Page } from "puppeteer";
import logger from "../../config/logger";
import path from "path";

export interface PostInfo {
  id: string;
  author: string;
  caption: string;
  url: string;
  selector: string;
  isOwnPost: boolean;
}

export class InstagramAPI {
  private page: Page | null = null;
  private readonly ownUsername = process.env.IGclearusername || '';

  constructor() {
    logger.info("🔗 InstagramAPI initialized");
  }

  /**
   * Set the page instance
   */
  public setPage(page: Page): void {
    this.page = page;
    logger.info("📄 Page instance set for InstagramAPI");
  }

  /**
   * Navigate to Instagram home
   */
  public async navigateToHome(): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");
    
    try {
      const currentUrl = this.page.url();
      if (currentUrl === 'https://www.instagram.com/' || currentUrl === 'https://www.instagram.com') {
        logger.info("📍 Already on Instagram home page");
        return;
      }
      
      logger.info("📍 Navigating to Instagram home...");
      await this.page.goto("https://www.instagram.com/", { waitUntil: "networkidle2", timeout: 30000 });
      await this.delay(3000);
      
      logger.info("✅ Successfully navigated to home");
      
    } catch (error) {
      logger.error("❌ Failed to navigate to home:", error);
      throw error;
    }
  }

  /**
   * Create a new Instagram post
   */
  public async createPost(content: string, imagePath: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized");
    
    try {
      logger.info("📝 Starting post creation process...");
      
      // Navigate to home first
      await this.navigateToHome();
      
      // Find and click the "+" create button
      await this.clickCreateButton();
      
      // Upload image
      await this.uploadImage(imagePath);
      
      // Skip through editing steps
      await this.skipEditingSteps();
      
      // Add caption
      await this.addCaption(content);
      
      // Share the post
      await this.sharePost();
      
      logger.info("✅ Post created successfully");
      
    } catch (error) {
      logger.error("❌ Post creation failed:", error);
      throw error;
    }
  }

  /**
   * Get visible posts from the feed
   */
  public async getVisiblePosts(maxPosts: number = 10): Promise<PostInfo[]> {
    if (!this.page) throw new Error("Page not initialized");
    
    try {
      logger.info(`🔍 Getting ${maxPosts} visible posts...`);
      
      const posts: PostInfo[] = [];
      let postIndex = 1;
      
      while (posts.length < maxPosts && postIndex <= maxPosts * 2) {
        const postSelector = `article:nth-of-type(${postIndex})`;
        
        if (!(await this.page.$(postSelector))) {
          logger.info(`No more posts found at index ${postIndex}`);
          break;
        }
        
        try {
          const postInfo = await this.extractPostInfo(postSelector, postIndex);
          if (postInfo) {
            posts.push(postInfo);
          }
        } catch (error) {
          logger.warn(`Failed to extract info for post ${postIndex}:`, error);
        }
        
        postIndex++;
        
        // Scroll to load more posts if needed
        if (postIndex % 3 === 0) {
          await this.page.evaluate(() => window.scrollBy(0, window.innerHeight));
          await this.delay(2000);
        }
      }
      
      logger.info(`✅ Found ${posts.length} posts`);
      return posts;
      
    } catch (error) {
      logger.error("❌ Failed to get visible posts:", error);
      return [];
    }
  }

  /**
   * Like a post
   */
  public async likePost(postSelector: string): Promise<boolean> {
    if (!this.page) throw new Error("Page not initialized");
    
    try {
      const likeSelectors = [
        `${postSelector} svg[aria-label="Like"]`,
        `${postSelector} svg[aria-label="Gefällt mir"]`,
        `${postSelector} button[data-testid="like-button"]`,
        `${postSelector} div[role="button"] svg[aria-label*="Like"]`
      ];
      
      for (const selector of likeSelectors) {
        const likeButton = await this.page.$(selector);
        if (likeButton) {
          const ariaLabel = await likeButton.evaluate(el => el.getAttribute("aria-label"));
          
          if (ariaLabel === "Like" || ariaLabel === "Gefällt mir") {
            await likeButton.click();
            logger.info("✅ Post liked");
            return true;
          } else if (ariaLabel?.includes("Unlike") || ariaLabel?.includes("Gefällt mir nicht mehr")) {
            logger.info("ℹ️ Post already liked");
            return true;
          }
        }
      }
      
      logger.warn("⚠️ Like button not found");
      return false;
      
    } catch (error) {
      logger.error("❌ Failed to like post:", error);
      return false;
    }
  }

  /**
   * Comment on a post
   */
  public async commentOnPost(postSelector: string, comment: string): Promise<boolean> {
    if (!this.page) throw new Error("Page not initialized");
    
    try {
      logger.info(`💬 Commenting: "${comment.substring(0, 50)}..."`);
      
      // Find comment box
      const commentBoxSelector = `${postSelector} textarea`;
      const commentBox = await this.page.$(commentBoxSelector);
      
      if (!commentBox) {
        logger.warn("⚠️ Comment box not found");
        return false;
      }
      
      // Click and type comment
      await commentBox.click();
      await this.delay(1000);
      await commentBox.type(comment);
      await this.delay(2000);
      
      // Find and click post button
      const postButtonClicked = await this.page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"]'));
        const postButton = buttons.find(button => 
          (button.textContent === 'Post' || button.textContent === 'Posten') && 
          !button.hasAttribute('disabled')
        );
        
        if (postButton) {
          (postButton as HTMLElement).click();
          return true;
        }
        return false;
      });
      
      if (postButtonClicked) {
        logger.info("✅ Comment posted");
        await this.delay(3000);
        return true;
      } else {
        logger.warn("⚠️ Post button not found or disabled");
        return false;
      }
      
    } catch (error) {
      logger.error("❌ Failed to comment:", error);
      return false;
    }
  }

  /**
   * Click the create button
   */
  private async clickCreateButton(): Promise<void> {
    const createSelectors = [
      'svg[aria-label*="New post"]',
      'svg[aria-label*="Create"]', 
      'svg[aria-label*="Neuer Beitrag"]',
      'svg[aria-label*="Beitrag erstellen"]',
      'a[href="#"] svg',
      'div[role="menuitem"] svg'
    ];

    let buttonFound = false;
    for (const selector of createSelectors) {
      try {
        await this.page!.waitForSelector(selector, { timeout: 5000, visible: true });
        await this.page!.click(selector);
        buttonFound = true;
        logger.info(`✅ Create button clicked: ${selector}`);
        break;
      } catch (e) {
        continue;
      }
    }

    if (!buttonFound) {
      throw new Error("Create button not found");
    }

    await this.delay(2000);
  }

  /**
   * Upload image file
   */
  private async uploadImage(imagePath: string): Promise<void> {
    try {
      const fileSel = 'input[type="file"][accept*="image"]';
      await this.page!.waitForSelector(fileSel, { timeout: 15000 });
      
      const fileInput = await this.page!.$(fileSel);
      if (!fileInput) throw new Error("File input not found");
      
      await fileInput.uploadFile(imagePath);
      logger.info(`✅ Image uploaded: ${path.basename(imagePath)}`);
      
      await this.delay(3000);
      
    } catch (error) {
      logger.error("❌ Image upload failed:", error);
      throw error;
    }
  }

  /**
   * Skip through editing steps (crop, filter, etc.)
   */
  private async skipEditingSteps(): Promise<void> {
    try {
      // Click "Next" twice to skip cropping and filters
      for (let i = 0; i < 2; i++) {
        logger.info(`⏭️ Clicking Next button ${i + 1}/2`);
        await this.clickNextButton();
        await this.delay(2000);
      }
    } catch (error) {
      logger.error("❌ Failed to skip editing steps:", error);
      throw error;
    }
  }

  /**
   * Click Next button
   */
  private async clickNextButton(): Promise<void> {
    const nextButtonClicked = await this.page!.evaluate(() => {
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
    
    if (!nextButtonClicked) {
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
  private async addCaption(caption: string): Promise<void> {
    try {
      logger.info(`📝 Adding caption: "${caption.substring(0, 50)}..."`);
      
      const captionSelector = 'div[role="textbox"][contenteditable="true"][data-lexical-editor="true"]';
      await this.page!.waitForSelector(captionSelector, { timeout: 10000, visible: true });
      
      const captionBox = await this.page!.$(captionSelector);
      if (!captionBox) throw new Error("Caption box not found");

      // Clear and type caption
      await captionBox.click({ clickCount: 1 });
      await this.page!.keyboard.down("Control");
      await this.page!.keyboard.press("A");
      await this.page!.keyboard.up("Control");
      await this.page!.keyboard.press("Backspace");
      
      await this.page!.type(captionSelector, caption, { delay: 25 });
      await this.delay(500);
      
      // Blur the field
      await this.page!.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await this.delay(300);
      
      // Verify caption was added
      const currentText = await this.page!.evaluate(sel => 
        document.querySelector<HTMLElement>(sel)?.innerText || "", captionSelector
      );
      
      logger.info(`✅ Caption added (${currentText.length} characters)`);
      
    } catch (error) {
      logger.error("❌ Failed to add caption:", error);
      throw error;
    }
  }

  /**
   * Share the post
   */
  private async sharePost(): Promise<void> {
    try {
      logger.info("📤 Sharing post...");
      
      // Wait for any processing to complete
      await this.page!.waitForFunction(
        () => !document.querySelector('div[role="progressbar"]'), 
        { timeout: 60000 }
      ).catch(() => logger.warn("Progress bar still visible"));
      
      // Click share button
      const shareClicked = await this.page!.waitForFunction(
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
      
      if (!shareClicked) throw new Error("Share button not found");
      
      logger.info("✅ Share button clicked, waiting for completion...");
      
      // Wait for post completion
      await this.page!.waitForFunction(
        () => window.location.pathname === '/' || 
              !!document.querySelector('[data-testid="upload-flow-success-toast"]'),
        { timeout: 60000 }
      );
      
      logger.info("✅ Post shared successfully");
      await this.delay(5000);
      
    } catch (error) {
      logger.error("❌ Failed to share post:", error);
      throw error;
    }
  }

  /**
   * Extract post information from DOM
   */
  private async extractPostInfo(postSelector: string, index: number): Promise<PostInfo | null> {
    try {
      const author = await this.extractPostAuthor(postSelector);
      const caption = await this.extractPostCaption(postSelector, index);
      const url = await this.extractPostUrl(postSelector, index);
      const isOwnPost = author === this.ownUsername;
      
      const postId = this.generatePostId(caption, index, author);
      
      return {
        id: postId,
        author,
        caption,
        url,
        selector: postSelector,
        isOwnPost
      };
      
    } catch (error) {
      logger.warn(`Failed to extract post info for ${postSelector}:`, error);
      return null;
    }
  }

  /**
   * Extract post author
   */
  private async extractPostAuthor(postSelector: string): Promise<string> {
    return await this.page!.evaluate((selector: string) => {
      const post = document.querySelector(selector);
      if (!post) return 'unknown';
      
      const headerSelectors = [
        'header a[role="link"]',
        'article header a',
        'header div a',
        'h2 a'
      ];
      
      for (const headerSel of headerSelectors) {
        const headerLinks = post.querySelectorAll(headerSel);
        
        for (const link of headerLinks) {
          const href = link.getAttribute('href');
          const text = link.textContent?.trim() || '';
          
          if (href) {
            const match = href.match(/^\/([^\/\?]+)(?:\/|\?|$)/);
            if (match && match[1]) {
              const username = match[1];
              
              if (username && 
                  username.length > 0 && 
                  username.length <= 30 &&
                  username !== 'p' && 
                  username !== 'reel' && 
                  username !== 'reels' &&
                  username !== 'stories' &&
                  username !== 'explore' &&
                  username !== 'accounts' &&
                  !username.includes('audio') &&
                  username.match(/^[a-zA-Z0-9._]+$/)) {
                
                return username;
              }
            }
          }
        }
      }
      
      return 'unknown';
    }, postSelector);
  }

  /**
   * Extract post caption
   */
  private async extractPostCaption(postSelector: string, index: number): Promise<string> {
    try {
      const captionSelectors = [
        `${postSelector} span[dir="auto"]`,
        `${postSelector} article span`,
        `${postSelector} div[data-testid="post-text"]`
      ];
      
      let caption = "";
      
      for (const captionSel of captionSelectors) {
        const captionElements = await this.page!.$(captionSel);
        
        if (captionElements && captionElements.length > 0) {
          for (const element of captionElements) {
            if (!element) continue;
            
            try {
              const text = await element.evaluate((el: HTMLElement) => {
                if (!el || !el.innerText) return '';
                
                const innerText = el.innerText.trim();
                
                // Filter UI elements
                if (innerText.includes('Für dich vorgeschlagen') ||
                    innerText.includes('Gefällt') ||
                    innerText.includes('Kommentare') ||
                    innerText.includes('Teilen') ||
                    innerText === '•' ||
                    innerText.match(/^\d+\s+(Std|Tag|Tage|h|m)/) ||
                    innerText.length < 15) {
                  return '';
                }
                
                return innerText;
              });
              
              if (text && text.length > 15 && text.length > caption.length) {
                caption = text;
              }
            } catch (evalError) {
              continue;
            }
          }
          
          if (caption && caption.length > 15) break;
        }
      }
      
      // Fallback if no caption found
      if (!caption || caption.length < 15) {
        caption = `Post ${index} - content analysis`;
      }
      
      return caption;
      
    } catch (error) {
      logger.warn(`Caption extraction failed for post ${index}:`, error);
      return `Post ${index} - extraction failed`;
    }
  }

  /**
   * Extract post URL
   */
  private async extractPostUrl(postSelector: string, index: number): Promise<string> {
    try {
      return await this.page!.evaluate((selector: string) => {
        const post = document.querySelector(selector);
        if (!post) return '';
        
        const linkSelectors = [
          'header a[href*="/p/"]',
          'a[href*="/p/"]',
          'time a',
          'article a[href*="/p/"]'
        ];
        
        for (const linkSelector of linkSelectors) {
          const linkElement = post.querySelector(linkSelector);
          if (linkElement && linkElement.getAttribute('href')) {
            const href = linkElement.getAttribute('href');
            if (href && href.includes('/p/')) {
              return `https://www.instagram.com${href}`;
            }
          }
        }
        
        return `https://www.instagram.com/p/unknown_${Date.now()}`;
      }, postSelector);
    } catch (error) {
      logger.warn(`URL extraction failed for post ${index}:`, error);
      return `https://www.instagram.com/p/error_${Date.now()}`;
    }
  }

  /**
   * Generate unique post ID
   */
  private generatePostId(caption: string, index: number, author: string): string {
    const crypto = require('crypto');
    const content = `${caption}_${index}_${author}`.substring(0, 100);
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}