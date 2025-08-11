import fs from 'fs';
import path from 'path';
import logger from '../../config/logger';

export interface ImageGenerationRequest {
  prompt: string;
  category: string;
  filename?: string;
}

export class StableDiffusionService {
  private readonly huggingFaceToken: string;
  private readonly apiUrl = 'https://api-inference.huggingface.co/models/runwayml/stable-diffusion-v1-5';
  private readonly maxRetries = 3;
  private readonly retryDelay = 10000; // 10 seconds

  constructor() {
    // Optional: Hugging Face Token für bessere Rate Limits
    this.huggingFaceToken = process.env.HUGGINGFACE_TOKEN || '';
    logger.info("🎨 StableDiffusionService initialized");
  }

  /**
   * Generate image from text prompt
   */
  public async generateImage(request: ImageGenerationRequest): Promise<string> {
    try {
      logger.info(`🎨 Generating image for: "${request.prompt}"`);
      
      // Create optimized prompt for business/professional content
      const optimizedPrompt = this.optimizePrompt(request.prompt, request.category);
      
      // Generate image via Hugging Face API
      const imageBuffer = await this.callStableDiffusionAPI(optimizedPrompt);
      
      // Save image to assets folder
      const imagePath = await this.saveGeneratedImage(imageBuffer, request.category, request.filename);
      
      logger.info(`✅ Image generated and saved: ${path.basename(imagePath)}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Image generation failed:", error);
      throw error;
    }
  }

  /**
   * Generate image based on post content
   */
  public async generateImageFromContent(content: string, category: string = 'default'): Promise<string> {
    try {
      // Extract keywords from content
      const keywords = this.extractKeywordsFromContent(content);
      
      // Create prompt based on content and category
      const prompt = this.createPromptFromKeywords(keywords, category);
      
      return await this.generateImage({
        prompt,
        category,
        filename: `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
      
    } catch (error) {
      logger.error("❌ Content-based image generation failed:", error);
      throw error;
    }
  }

  /**
   * Call Stable Diffusion API with retry logic
   */
  private async callStableDiffusionAPI(prompt: string): Promise<Buffer> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add auth header if token is available
    if (this.huggingFaceToken) {
      headers['Authorization'] = `Bearer ${this.huggingFaceToken}`;
    }

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        logger.info(`🔄 API call attempt ${attempt}/${this.maxRetries}`);
        
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            inputs: prompt,
            parameters: {
              num_inference_steps: 20,
              guidance_scale: 7.5,
              width: 1024,
              height: 1024
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          
          // Handle "model loading" error - wait and retry
          if (response.status === 503 && errorText.includes('loading')) {
            logger.warn(`⏳ Model loading, waiting ${this.retryDelay/1000}s before retry...`);
            await this.delay(this.retryDelay);
            continue;
          }
          
          throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        logger.info("✅ Image generated successfully");
        return buffer;

      } catch (error) {
        logger.warn(`❌ Attempt ${attempt} failed:`, error);
        
        if (attempt === this.maxRetries) {
          throw new Error(`Failed after ${this.maxRetries} attempts: ${error}`);
        }
        
        // Wait before retry
        await this.delay(this.retryDelay);
      }
    }

    throw new Error("Should not reach here");
  }

  /**
   * Optimize prompt for professional/business content
   */
  private optimizePrompt(basePrompt: string, category: string): string {
    const professionalStyle = "professional, clean, modern, high quality, business style, 4k";
    const negativePrompts = "blurry, low quality, distorted, nsfw, text, watermark, signature";
    
    const categoryStyles = {
      'business': 'office environment, corporate, professional meeting',
      'social-media': 'digital marketing, social networks, online content',
      'tech': 'technology, digital, innovation, computers',
      'team': 'teamwork, collaboration, people working together',
      'marketing': 'advertising, campaigns, creative marketing',
      'analytics': 'data visualization, charts, business analytics',
      'default': 'business professional'
    };

    const categoryStyle = categoryStyles[category as keyof typeof categoryStyles] || categoryStyles.default;
    
    return `${basePrompt}, ${categoryStyle}, ${professionalStyle}, --neg ${negativePrompts}`;
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
  private createPromptFromKeywords(keywords: string[], category: string): string {
    const scenes = {
      'team': 'diverse business team in modern office',
      'meeting': 'professional business meeting',
      'analytics': 'business analytics dashboard and charts',
      'social media': 'social media marketing workspace',
      'marketing': 'creative marketing team brainstorming',
      'business': 'modern business office environment',
      'technology': 'modern tech startup office'
    };

    // Pick the most relevant scene
    const primaryKeyword = keywords[0] || 'business';
    const scene = scenes[primaryKeyword as keyof typeof scenes] || scenes.business;
    
    return `${scene} with ${keywords.join(', ')} theme`;
  }

  /**
   * Save generated image to file system
   */
  private async saveGeneratedImage(buffer: Buffer, category: string, filename?: string): Promise<string> {
    try {
      // Create category directory if it doesn't exist
      const categoryDir = path.resolve('assets', category);
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // Generate filename if not provided
      const imageFilename = filename 
        ? `${filename}.png`
        : `ai_generated_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      
      const imagePath = path.join(categoryDir, imageFilename);
      
      // Save image
      fs.writeFileSync(imagePath, buffer);
      
      logger.info(`💾 Image saved: ${imagePath}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Failed to save generated image:", error);
      throw error;
    }
  }

  /**
   * Check if service is available
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const testPrompt = "simple business office";
      await this.callStableDiffusionAPI(testPrompt);
      return true;
    } catch (error) {
      logger.error("❌ StableDiffusion health check failed:", error);
      return false;
    }
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}