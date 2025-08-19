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
    await this.page!.goto("https://www.instagram.com/", { waitUntil: "networkidle2" });
    await this.delay(2000);

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
    
    if (success) {
      await this.historyService.savePost({
        content,
        contentHash: this.createContentHash(content),
        postType: 'instagram_post',
        imagePath,
        imageCategory: this.imageManager.determineCategoryFromContent(content)
      });
      
      logger.info("✅ Post created and saved successfully");
    } else {
      logger.warn("⚠️ Post may have failed, but saving anyway");
      await this.historyService.savePost({
        content,
        contentHash: this.createContentHash(content),
        postType: 'instagram_post',
        imagePath,
        imageCategory: this.imageManager.determineCategoryFromContent(content)
      });
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
 * Simplified helper methods - keep only essentials
 */
private async clickCreateButton(): Promise<void> {
  const selectors = [
    'svg[aria-label*="New post"]',
    'svg[aria-label*="Create"]',
    'svg[aria-label*="Neuer Beitrag"]',
    'a[href="#"] svg'
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

private async uploadImage(imagePath: string): Promise<void> {
  const fileInput = await this.page!.waitForSelector(
    'input[type="file"][accept*="image"]',
    { timeout: 15000 }
  );
  
  if (!fileInput) throw new Error("File input not found");
  
  await fileInput.uploadFile(imagePath);
  logger.info(`✅ Image uploaded: ${path.basename(imagePath)}`);
  await this.delay(3000);
}

private async clickNextButton(): Promise<void> {
  const clicked = await this.page!.evaluate(() => {
    const buttons = document.querySelectorAll('button, div[role="button"]');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase();
      if (text === 'weiter' || text === 'next') {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  });
  
  if (!clicked) throw new Error("Next button not found");
  logger.info("✅ Next button clicked");
}

private async addCaption(text: string): Promise<void> {
  const selector = 'div[role="textbox"][contenteditable="true"]';
  const captionBox = await this.page!.waitForSelector(selector, { timeout: 10000 });
  
  if (!captionBox) throw new Error("Caption box not found");
  
  await captionBox.click();
  await this.page!.keyboard.down("Control");
  await this.page!.keyboard.press("A");
  await this.page!.keyboard.up("Control");
  await this.page!.keyboard.press("Backspace");
  await this.page!.type(selector, text, { delay: 25 });
  
  logger.info(`✅ Caption added (${text.length} characters)`);
}

private async sharePost(): Promise<void> {
  // Wait for processing
  await this.page!.waitForFunction(
    () => !document.querySelector('div[role="progressbar"]'),
    { timeout: 60000 }
  ).catch(() => logger.warn("Progress bar still visible"));
  
  // Click share
  const clicked = await this.page!.evaluate(() => {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return false;
    
    const btn = Array.from(dialog.querySelectorAll('button, div[role="button"]'))
      .find(b => {
        const text = (b.textContent || "").trim();
        return text === "Teilen" || text === "Share";
      });
    
    if (btn) {
      (btn as HTMLElement).click();
      return true;
    }
    return false;
  });
  
  if (!clicked) throw new Error("Share button not found");
  logger.info("✅ Share button clicked");
}

private async verifyPostSuccess(): Promise<boolean> {
  try {
    await this.page!.waitForSelector('div[role="dialog"]', { 
      timeout: 3000, 
      hidden: true 
    });
    return true;
  } catch {
    return false;
  }
}

private createContentHash(content: string): string {
  return require('crypto').createHash('md5').update(content).digest('hex');
}