import path from "path";
import fs from 'fs';
import logger from "../../config/logger";

export interface ImageCategory {
  name: string;
  keywords: string[];
  folder: string;
}

export class ImageManager {
  private readonly assetsDir = path.resolve("assets");
  private readonly categories: ImageCategory[] = [
    {
      name: 'Business',
      keywords: ['business', 'büro', 'meeting', 'arbeit', 'job', 'karriere', 'unternehmen', 'strategie', 'planung'],
      folder: 'business'
    },
    {
      name: 'Social Media',
      keywords: ['social media', 'instagram', 'tiktok', 'facebook', 'linkedin', 'content', 'posting', 'community'],
      folder: 'social-media'
    },
    {
      name: 'Technology',
      keywords: ['technologie', 'tools', 'digital', 'innovation', 'ki', 'software', 'app', 'tech', 'computer'],
      folder: 'tech'
    },
    {
      name: 'Marketing',
      keywords: ['marketing', 'werbung', 'kampagne', 'brand', 'marke', 'advertising', 'promotion'],
      folder: 'marketing'
    },
    {
      name: 'Team',
      keywords: ['team', 'agentur', 'zusammenarbeit', 'mitarbeiter', 'kollaboration', 'gruppe', 'workshop'],
      folder: 'team'
    },
    {
      name: 'Analytics',
      keywords: ['analytics', 'daten', 'statistik', 'performance', 'roi', 'zahlen', 'auswertung', 'messung'],
      folder: 'analytics'
    }
  ];

  private readonly supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
  private imageCache: Map<string, string[]> = new Map();
  private lastUsedImages: Map<string, string[]> = new Map();

  constructor() {
    this.initializeDirectories();
    this.loadImageCache();
    logger.info("🖼️ ImageManager initialized");
  }

  /**
   * Get image for specific category
   */
  public async getImageForCategory(category: string): Promise<string> {
    try {
      logger.info(`🎨 Selecting image for category: ${category}`);
      
      const imagePath = await this.selectBestImage(category);
      
      if (!imagePath || !fs.existsSync(imagePath)) {
        logger.warn(`⚠️ Image not found for category ${category}, using fallback`);
        return await this.createFallbackImage();
      }
      
      // Track usage to avoid repetition
      this.trackImageUsage(category, imagePath);
      
      logger.info(`✅ Selected image: ${path.basename(imagePath)} for ${category}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Image selection failed:", error);
      return await this.createFallbackImage();
    }
  }

  /**
   * Determine category from content text
   */
  public determineCategoryFromContent(content: string): string {
    const contentLower = content.toLowerCase();
    let bestMatch = { category: 'default', score: 0 };
    
    for (const category of this.categories) {
      let score = 0;
      const foundKeywords: string[] = [];
      
      for (const keyword of category.keywords) {
        if (contentLower.includes(keyword.toLowerCase())) {
          score++;
          foundKeywords.push(keyword);
        }
      }
      
      if (score > bestMatch.score) {
        bestMatch = { category: category.folder, score };
        if (foundKeywords.length > 0) {
          logger.info(`📍 Category "${category.name}" matched with keywords: ${foundKeywords.join(', ')}`);
        }
      }
    }
    
    if (bestMatch.score === 0) {
      logger.info("📍 No specific category matched, using default");
      return 'default';
    }
    
    logger.info(`✅ Best category match: ${bestMatch.category} (score: ${bestMatch.score})`);
    return bestMatch.category;
  }

  /**
   * Get available images count per category
   */
  public getImageStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    
    for (const category of this.categories) {
      const images = this.imageCache.get(category.folder) || [];
      stats[category.folder] = images.length;
    }
    
    const defaultImages = this.imageCache.get('default') || [];
    stats['default'] = defaultImages.length;
    
    return stats;
  }

  /**
   * Refresh image cache
   */
  public refreshImageCache(): void {
    logger.info("🔄 Refreshing image cache...");
    this.imageCache.clear();
    this.loadImageCache();
    logger.info("✅ Image cache refreshed");
  }

  /**
   * Initialize category directories
   */
  private initializeDirectories(): void {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
      logger.info(`📁 Created assets directory: ${this.assetsDir}`);
    }

    // Create category folders
    const allFolders = [...this.categories.map(cat => cat.folder), 'default'];
    
    for (const folder of allFolders) {
      const folderPath = path.join(this.assetsDir, folder);
      if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
        logger.info(`📁 Created category folder: ${folder}`);
      }
    }
  }

  /**
   * Load all images into cache
   */
  private loadImageCache(): void {
    const allFolders = [...this.categories.map(cat => cat.folder), 'default'];
    
    for (const folder of allFolders) {
      const folderPath = path.join(this.assetsDir, folder);
      
      if (fs.existsSync(folderPath)) {
        const images = fs.readdirSync(folderPath)
          .filter(file => this.supportedFormats.includes(path.extname(file).toLowerCase()))
          .map(file => path.join(folderPath, file));
        
        this.imageCache.set(folder, images);
        logger.info(`📷 Loaded ${images.length} images for category: ${folder}`);
      }
    }
  }

  /**
   * Select best image avoiding recent duplicates
   */
  private async selectBestImage(category: string): Promise<string> {
    let images = this.imageCache.get(category) || [];
    
    // If category has no images, try default
    if (images.length === 0) {
      logger.warn(`⚠️ No images in category ${category}, trying default`);
      images = this.imageCache.get('default') || [];
    }
    
    if (images.length === 0) {
      logger.warn("⚠️ No images available in any category");
      return '';
    }

    // Filter out recently used images if we have enough
    const recentlyUsed = this.lastUsedImages.get(category) || [];
    const availableImages = images.filter(img => !recentlyUsed.includes(img));
    
    const finalImages = availableImages.length > 0 ? availableImages : images;
    
    // Select random image
    const randomIndex = Math.floor(Math.random() * finalImages.length);
    return finalImages[randomIndex];
  }

  /**
   * Track image usage to avoid immediate repetition
   */
  private trackImageUsage(category: string, imagePath: string): void {
    const maxRecentImages = 5; // Remember last 5 used images per category
    
    if (!this.lastUsedImages.has(category)) {
      this.lastUsedImages.set(category, []);
    }
    
    const recent = this.lastUsedImages.get(category)!;
    recent.unshift(imagePath);
    
    // Keep only the last N images
    if (recent.length > maxRecentImages) {
      recent.splice(maxRecentImages);
    }
    
    this.lastUsedImages.set(category, recent);
  }

  /**
   * Create fallback image if none available
   */
  private async createFallbackImage(): Promise<string> {
    const fallbackPath = path.join(this.assetsDir, 'default', 'fallback.png');
    
    if (fs.existsSync(fallbackPath)) {
      return fallbackPath;
    }
    
    logger.warn("🛠️ Creating emergency fallback image...");
    
    // Create a simple 1x1 transparent PNG as emergency fallback
    const base64PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const buffer = Buffer.from(base64PNG, 'base64');
    
    try {
      fs.writeFileSync(fallbackPath, buffer);
      logger.info("✅ Emergency fallback image created");
      return fallbackPath;
    } catch (error) {
      logger.error("❌ Failed to create fallback image:", error);
      throw new Error("No images available and cannot create fallback");
    }
  }

  /**
   * Validate image file
   */
  private isValidImageFile(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }

      const stats = fs.statSync(filePath);
      if (stats.size === 0) {
        return false;
      }

      const ext = path.extname(filePath).toLowerCase();
      return this.supportedFormats.includes(ext);

    } catch (error) {
      return false;
    }
  }
}