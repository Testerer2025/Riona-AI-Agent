import path from "path";
import fs from 'fs';
import logger from "../../config/logger";
import { OpenAIImageService } from "./OpenAIImageService";

export interface ImageCategory {
  name: string;
  keywords: string[];
  folder: string;
}

export class ImageManager {
  private readonly assetsDir = path.resolve("assets");
  private readonly openaiImages: OpenAIImageService;
  
  // COMMENTED OUT: Original static categories - keep as fallback
  /*
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
  */

  private readonly supportedFormats = ['.jpg', '.jpeg', '.png', '.webp'];
  private imageCache: Map<string, string[]> = new Map();
  private lastUsedImages: Map<string, string[]> = new Map();

  constructor() {
    this.openaiImages = new OpenAIImageService();
    this.initializeDirectories();
    this.loadImageCache();
    logger.info("🖼️ ImageManager initialized with AI generation");
  }

  /**
   * Get image for specific category - ENHANCED with AI generation
   */
  public async getImageForCategory(category: string): Promise<string> {
    try {
      logger.info(`🎨 Selecting image for category: ${category}`);
      
      // COMMENTED OUT: Try local images first
      /*
      const localImage = await this.selectBestLocalImage(category);
      if (localImage && fs.existsSync(localImage)) {
        this.trackImageUsage(category, localImage);
        logger.info(`✅ Selected local image: ${path.basename(localImage)} for ${category}`);
        return localImage;
      }
      */
      
      // Generate new image with AI
      logger.info(`🤖 No local image found, generating with AI for category: ${category}`);
      const aiPrompt = this.createCategoryPrompt(category);
      const aiImage = await this.openaiImages.generateImage({
        prompt: aiPrompt,
        category: category,
        filename: `${category}_${Date.now()}`
      });
      
      logger.info(`✅ Generated AI image: ${path.basename(aiImage)} for ${category}`);
      return aiImage;
      
    } catch (error) {
      logger.error("❌ Image selection/generation failed:", error);
      
      // Fallback to creating a simple fallback image
      return await this.createFallbackImage();
    }
  }

  /**
   * Get image for content - ENHANCED with AI
   */
  public async getImageForContent(content: string): Promise<string> {
    try {
      logger.info(`🎨 Generating image for content: "${content.substring(0, 50)}..."`);
      
      const category = this.determineCategoryFromContent(content);
      
      // Generate AI image based on actual content
      const aiImage = await this.openaiImages.generateImageFromContent(content, category);
      
      logger.info(`✅ Generated content-specific AI image: ${path.basename(aiImage)}`);
      return aiImage;
      
    } catch (error) {
      logger.error("❌ Content-based image generation failed:", error);
      
      // Fallback to category-based generation
      const category = this.determineCategoryFromContent(content);
      return await this.getImageForCategory(category);
    }
  }

  /**
   * Create AI prompt for category
   */
  private createCategoryPrompt(category: string): string {
    const categoryPrompts = {
      'business': 'modern business office with professionals working, corporate environment',
      'social-media': 'social media marketing workspace with screens showing analytics',
      'tech': 'modern technology startup office with computers and innovation',
      'marketing': 'creative marketing team brainstorming with colorful ideas',
      'team': 'diverse business team collaborating in modern office space',
      'analytics': 'business analytics dashboard with charts and data visualization',
      'default': 'professional business environment with modern office setup'
    };
    
    return categoryPrompts[category as keyof typeof categoryPrompts] || categoryPrompts.default;
  }

  /**
   * Determine category from content text
   */
  public determineCategoryFromContent(content: string): string {
    const contentLower = content.toLowerCase();
    
    const categories = {
      'business': ['business', 'unternehmen', 'erfolg', 'strategie', 'meeting'],
      'social-media': ['instagram', 'tiktok', 'social media', 'content', 'posting'],
      'tech': ['tool', 'digital', 'tech', 'software', 'innovation', 'ki', 'ai'],
      'team': ['team', 'zusammen', 'kollaboration', 'mitarbeiter'],
      'marketing': ['marketing', 'kampagne', 'werbung', 'brand', 'marke'],
      'analytics': ['analytics', 'daten', 'statistik', 'zahlen', 'performance']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => contentLower.includes(keyword))) {
        return category;
      }
    }
    
    return 'default';
  }

  // COMMENTED OUT: Original local image selection methods - keep as reference
  /*
  private async selectBestLocalImage(category: string): Promise<string> {
    let images = this.imageCache.get(category) || [];
    
    if (images.length === 0) {
      logger.warn(`⚠️ No images in category ${category}, trying default`);
      images = this.imageCache.get('default') || [];
    }
    
    if (images.length === 0) {
      logger.warn("⚠️ No images available in any category");
      return '';
    }

    const recentlyUsed = this.lastUsedImages.get(category) || [];
    const availableImages = images.filter(img => !recentlyUsed.includes(img));
    
    const finalImages = availableImages.length > 0 ? availableImages : images;
    const randomIndex = Math.floor(Math.random() * finalImages.length);
    return finalImages[randomIndex];
  }

  private trackImageUsage(category: string, imagePath: string): void {
    const maxRecentImages = 5;
    
    if (!this.lastUsedImages.has(category)) {
      this.lastUsedImages.set(category, []);
    }
    
    const recent = this.lastUsedImages.get(category)!;
    recent.unshift(imagePath);
    
    if (recent.length > maxRecentImages) {
      recent.splice(maxRecentImages);
    }
    
    this.lastUsedImages.set(category, recent);
  }
  */

  /**
   * Get available images count per category
   */
  public getImageStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    
    // Count AI generated images
    const categories = ['business', 'social-media', 'tech', 'marketing', 'team', 'analytics', 'default'];
    
    for (const category of categories) {
      const images = this.imageCache.get(category) || [];
      stats[category] = images.length;
    }
    
    return stats;
  }

  /**
   * Initialize category directories
   */
  private initializeDirectories(): void {
    if (!fs.existsSync(this.assetsDir)) {
      fs.mkdirSync(this.assetsDir, { recursive: true });
      logger.info(`📁 Created assets directory: ${this.assetsDir}`);
    }

    // Create basic category folders
    const allFolders = ['business', 'social-media', 'tech', 'marketing', 'team', 'analytics', 'default'];
    
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
    const allFolders = ['business', 'social-media', 'tech', 'marketing', 'team', 'analytics', 'default'];
    
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
   * Create fallback image if generation fails
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

}