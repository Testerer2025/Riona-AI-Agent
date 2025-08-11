import fs from 'fs';
import path from 'path';
import logger from '../../config/logger';

export interface OpenAIImageRequest {
  prompt: string;
  category: string;
  filename?: string;
}

export class OpenAIImageService {
  private readonly apiKey: string;
  private readonly apiUrl = 'https://api.openai.com/v1/images/generations';

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    logger.info("🎨 OpenAI Image Service initialized");
  }

  /**
   * Generate image using DALL-E 3
   */
  public async generateImage(request: OpenAIImageRequest): Promise<string> {
    try {
      logger.info(`🎨 Generating DALL-E 3 image for: "${request.prompt}"`);
      
      // Optimize prompt for business/professional content
      const optimizedPrompt = this.optimizePrompt(request.prompt, request.category);
      
      // Call OpenAI Images API
      const imageUrl = await this.callOpenAIImagesAPI(optimizedPrompt);
      
      // Download and save image
      const imagePath = await this.downloadAndSaveImage(imageUrl, request.category, request.filename);
      
      logger.info(`✅ DALL-E 3 image generated and saved: ${path.basename(imagePath)}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ DALL-E 3 image generation failed:", error);
      throw error;
    }
  }

  /**
   * Generate image based on post content
   */
  public async generateImageFromContent(content: string, category: string = 'default'): Promise<string> {
    try {
      // Create direct prompt from post content - IMPROVED
      const prompt = this.createPromptFromPostContent(content, category);
      
      return await this.generateImage({
        prompt,
        category,
        filename: `openai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
      
    } catch (error) {
      logger.error("❌ Content-based DALL-E generation failed:", error);
      throw error;
    }
  }

  /**
   * Create prompt directly from post content - NEW METHOD
   */
  private createPromptFromPostContent(postContent: string, category: string): string {
    // Clean the post content (remove hashtags, emojis for prompt)
    const cleanContent = postContent
      .replace(/#\w+/g, '') // Remove hashtags
      .replace(/[^\w\s\u00C0-\u017F]/g, ' ') // Remove emojis/special chars, keep umlauts
      .replace(/\s+/g, ' ') // Multiple spaces to single
      .trim()
      .substring(0, 300); // INCREASED: 150 → 300 characters

    const basePrompt = `Generiere ein passendes professionelles Bild für diesen Instagram-Post: "${cleanContent}"`;
    
    // Add category-specific style
    const categoryStyles = {
      'business': 'Corporate office environment, business professionals',
      'social-media': 'Modern digital marketing workspace, social media content',
      'tech': 'Technology office, computers and innovation, modern startup',
      'team': 'Business team collaboration, diverse professionals working together',
      'marketing': 'Creative marketing environment, brainstorming and campaigns',
      'analytics': 'Business analytics dashboard, data visualization, charts',
      'default': 'Professional business environment'
    };

    const categoryStyle = categoryStyles[category as keyof typeof categoryStyles] || categoryStyles.default;
    
    const fullPrompt = `${basePrompt}. Style: ${categoryStyle}, professional photography, high quality, business appropriate.`;
    
    // DEBUG: Log the full prompt length
    logger.info(`📝 Full DALL-E prompt (${fullPrompt.length} chars): "${fullPrompt}"`);
    
    return fullPrompt;
  }

  /**
   * Call OpenAI Images API
   */
  private async callOpenAIImagesAPI(prompt: string): Promise<string> {
    try {
      logger.info("🔄 Calling OpenAI Images API...");
      
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: "dall-e-3",
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          quality: "standard",
          style: "natural" // or "vivid" for more dramatic images
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API Error ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      
      if (!data.data || !data.data[0] || !data.data[0].url) {
        throw new Error('Invalid response format from OpenAI Images API');
      }

      const imageUrl = data.data[0].url;
      logger.info("✅ DALL-E 3 image URL received");
      
      return imageUrl;

    } catch (error) {
      logger.error("❌ OpenAI Images API call failed:", error);
      throw error;
    }
  }

  /**
   * Download image from URL and save to file system
   */
  private async downloadAndSaveImage(imageUrl: string, category: string, filename?: string): Promise<string> {
    try {
      logger.info("📥 Downloading image from OpenAI...");
      
      // Create category directory if it doesn't exist
      const categoryDir = path.resolve('assets', category);
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // Generate filename if not provided
      const imageFilename = filename 
        ? `${filename}.png`
        : `dalle3_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      
      const imagePath = path.join(categoryDir, imageFilename);
      
      // Download image
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`);
      }
      
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      
      // Save image
      fs.writeFileSync(imagePath, buffer);
      
      logger.info(`💾 Image downloaded and saved: ${imagePath}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Failed to download and save image:", error);
      throw error;
    }
  }

  /**
   * Optimize prompt for professional/business content
   */
  private optimizePrompt(basePrompt: string, category: string): string {
    const professionalStyle = "professional, clean, modern, high quality, business photography style";
    
    const categoryStyles = {
      'business': 'corporate office environment, business professionals',
      'social-media': 'digital marketing workspace, social media content creation',
      'tech': 'modern technology office, innovation and computers',
      'team': 'diverse business team collaboration, teamwork',
      'marketing': 'creative marketing campaign, advertising materials',
      'analytics': 'business data visualization, charts and analytics dashboard',
      'default': 'professional business environment'
    };

    const categoryStyle = categoryStyles[category as keyof typeof categoryStyles] || categoryStyles.default;
    
    return `${basePrompt}, ${categoryStyle}, ${professionalStyle}`;
  }

  /**
   * Extract keywords from post content
   */
  private extractKeywordsFromContent(content: string): string[] {
    const text = content.toLowerCase();
    
    const keywordMap = {
      'team': ['team', 'mitarbeiter', 'kollaboration', 'zusammenarbeit', 'gruppe'],
      'meeting': ['meeting', 'besprechung', 'konferenz', 'präsentation'],
      'analytics': ['analytics', 'daten', 'statistik', 'zahlen', 'performance'],
      'social media': ['social media', 'instagram', 'facebook', 'linkedin', 'posting'],
      'marketing': ['marketing', 'kampagne', 'werbung', 'brand', 'marke'],
      'business': ['business', 'unternehmen', 'erfolg', 'strategie', 'kunde'],
      'technology': ['technologie', 'digital', 'innovation', 'software', 'tool']
    };

    const foundKeywords: string[] = [];
    
    for (const [keyword, alternatives] of Object.entries(keywordMap)) {
      if (alternatives.some(alt => text.includes(alt))) {
        foundKeywords.push(keyword);
      }
    }

    return foundKeywords.length > 0 ? foundKeywords : ['business', 'professional'];
  }

  /**
   * Create prompt from extracted keywords
   */
  private createPromptFromKeywords(keywords: string[], _category: string): string {
    const scenes = {
      'team': 'diverse business team working together in modern office',
      'meeting': 'professional business meeting in conference room',
      'analytics': 'business analytics dashboard with charts and data',
      'social media': 'social media marketing team creating content',
      'marketing': 'creative marketing team brainstorming campaign ideas',
      'business': 'modern professional business office environment',
      'technology': 'innovative technology startup office with computers'
    };

    // Pick the most relevant scene
    const primaryKeyword = keywords[0] || 'business';
    const scene = scenes[primaryKeyword as keyof typeof scenes] || scenes.business;
    
    return `${scene} representing ${keywords.join(', ')} concepts`;
  }

  /**
   * Test DALL-E 3 generation
   */
  public async testGeneration(): Promise<string> {
    try {
      logger.info("🧪 Testing DALL-E 3 generation...");
      
      const testImage = await this.generateImage({
        prompt: "professional business meeting",
        category: "test",
        filename: `dalle3_test_${Date.now()}`
      });
      
      logger.info(`✅ DALL-E 3 test successful: ${testImage}`);
      return testImage;
      
    } catch (error) {
      logger.error("❌ DALL-E 3 test failed:", error);
      throw error;
    }
  }

  /**
   * Get API usage info
   */
  public getApiInfo(): { provider: string; model: string; costPerImage: string } {
    return {
      provider: "OpenAI",
      model: "DALL-E 3",
      costPerImage: "$0.040 (1024x1024)"
    };
  }
}