import fs from 'fs';
import path from 'path';
import logger from '../../config/logger';
import Replicate from 'replicate';

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
    const prompt = this.createPromptFromPostContent(content, category);
    return await this.generateImage({
      prompt,
      category,
      filename: `openai_${Date.now()}`
    });
  } catch (error) {
    logger.error("❌ Content-based generation failed, trying simple prompt...");
    
    // Fallback zu einfacherem Prompt
    const simplePrompt = `Professional ${category} business photo for social media`;
    return await this.generateImage({
      prompt: simplePrompt,
      category,
      filename: `fallback_${Date.now()}`
    });
  }
}


/**
 * Generate image with Replicate using reference images
 */
private async generateWithReplicate(prompt: string, referenceImagePath: string, strength: number = 0.7): Promise<string> {
  try {
    logger.info(`🎨 Generating with Replicate, reference strength: ${strength}`);
    
    // Initialize Replicate
    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });
    
    // Read reference image as base64
    const imageBuffer = fs.readFileSync(referenceImagePath);
    const base64Image = `data:image/jpeg;base64,${imageBuffer.toString('base64')}`;
    
    // Use SDXL img2img
    const output = await replicate.run(
      "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b",
      {
        input: {
          prompt: prompt,
          negative_prompt: "ugly, distorted, blurry, low quality",
          image: base64Image,
          strength: strength,  // 0.1 = sehr nah am Original, 0.9 = sehr kreativ
          num_inference_steps: 30,
          guidance_scale: 7.5,
          scheduler: "K_EULER",
          num_outputs: 1,
          width: 1024,
          height: 1024
        }
      }
    ) as string[];
    
    if (!output || output.length === 0) {
      throw new Error('No output from Replicate');
    }
    
    // Download and save the generated image
    const imageUrl = output[0];
    const timestamp = Date.now();
    const filename = `replicate_${timestamp}_${Math.random().toString(36).substr(2, 9)}`;
    const imagePath = await this.downloadAndSaveImage(imageUrl, 'replicate', filename);
    
    return imagePath;
    
  } catch (error) {
    logger.error("❌ Replicate generation failed:", error);
    throw error;
  }
}




/**
 * Generate image for a specific theme with custom settings
 * NEW METHOD - Add after generateImageFromContent
 */
public async generateImageForTheme(theme: any, postContent: string): Promise<string> {
  try {
    logger.info(`🎨 Generating theme-based image for: ${theme.name}`);
    
    // Check for reference images and Replicate token
    if (theme.image?.referenceImages && 
        theme.image.referenceImages.length > 0 && 
        process.env.REPLICATE_API_TOKEN) {
      
      // Build path to reference image
      const refImagePath = path.join(
        path.resolve('assets', 'references'), 
        theme.image.referenceImages[0]
      );
      
      // Check if reference image exists
      if (fs.existsSync(refImagePath)) {
        logger.info(`📸 Found reference image: ${theme.image.referenceImages[0]}`);
        
        try {
          // Try Replicate with reference image
          const prompt = this.createThemeImagePrompt(theme, postContent);
          const strength = theme.image.referenceStrength || 0.7;
          
          const replicateImage = await this.generateWithReplicate(
            prompt,
            refImagePath,
            strength
          );
          
          logger.info(`✅ Successfully generated with Replicate using reference`);
          return replicateImage;
          
        } catch (replicateError) {
          logger.error("❌ Replicate failed, falling back to DALL-E:", replicateError);
          // Fall through to DALL-E
        }
      } else {
        logger.warn(`⚠️ Reference image not found: ${refImagePath}`);
      }
    }
    
    // Default to DALL-E generation (no reference images or Replicate failed)
    logger.info(`🎨 Using DALL-E 3 (no reference images or fallback)`);
    
    const imagePrompt = this.createThemeImagePrompt(theme, postContent);
    const apiStyle = theme.image?.apiStyle || 'natural';
    const size = theme.image?.size || '1024x1024';
    const quality = theme.image?.quality || 'standard';
    
    const imageUrl = await this.callOpenAIImagesAPIWithSettings(
      imagePrompt,
      apiStyle,
      size,
      quality
    );
    
    const filename = `${theme.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const category = theme.id.replace('_', '-');
    const imagePath = await this.downloadAndSaveImage(imageUrl, category, filename);
    
    return imagePath;
    
  } catch (error) {
    logger.error(`❌ Theme-based image generation failed for ${theme.id}:`, error);
    return this.generateImageFromContent(postContent, 'default');
  }
}

/**
 * Create image prompt from theme configuration
 * NEW METHOD - Add after generateImageForTheme
 */
private createThemeImagePrompt(theme: any, postContent: string): string {
  if (theme.image?.prompt) {
    // Clean post content for context
    const cleanContent = postContent
      .replace(/#\w+/g, '')
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 200);
    
    // Build complete prompt
    let fullPrompt = theme.image.prompt;
    
    if (theme.image.details) {
      fullPrompt += `. ${theme.image.details}`;
    }
    
    if (cleanContent) {
      fullPrompt += `. Context: ${cleanContent}`;
    }
    
    logger.info(`📝 Theme image prompt (${fullPrompt.length} chars): "${fullPrompt.substring(0, 100)}..."`);
    return fullPrompt;
  }
  
  // Fallback to old system
  logger.info('📝 No theme image config, using content-based prompt');
  return this.createPromptFromPostContent(postContent, theme.id || 'default');
}

  /**
   * Create prompt directly from post content - NEW METHOD
   */
  private createPromptFromPostContent(postContent: string, category: string): string {
    // Minimale Bearbeitung - nur das Nötigste!
    const cleanContent = postContent
      .replace(/#\w+/g, '')  // Hashtags entfernen
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // Emojis entfernen
      .replace(/\s+/g, ' ')  // Mehrfache Spaces zu einem
      .trim()
      .substring(0, 600);  // Länge begrenzen

    // Rest bleibt original - keine aggressive Filterung!
    
    const basePrompt = `Create a highly realistic, professional stock photo that visually represents the following social media tip or advice. Focus on the concept, not the literal words. Avoid showing any readable or legible text in the image. Use realistic lighting, natural colors, high detail, and a clean modern setting.

  Theme: ${cleanContent}

  Context: ${category} environment

  Style: ultra realistic, 35mm lens, shallow depth of field, professional stock photography`;
    
    logger.info(`🎨 DALL-E prompt length: ${basePrompt.length} chars`);
    
    return basePrompt;
  }

  /**
   * Call OpenAI Images API
   */
  /**
 * Call OpenAI Images API - REPLACE the existing method
 */
private async callOpenAIImagesAPI(prompt: string): Promise<string> {
  // Redirect to new method with default settings
  return this.callOpenAIImagesAPIWithSettings(prompt, 'natural', '1024x1024', 'standard');
}

/**
 * Call OpenAI Images API with custom settings
 * NEW METHOD - Add right after callOpenAIImagesAPI
 */
private async callOpenAIImagesAPIWithSettings(
  prompt: string,
  style: string = 'natural',
  size: string = '1024x1024', 
  quality: string = 'standard'
): Promise<string> {
  try {
    logger.info(`🔄 Calling OpenAI Images API with settings...`);
    logger.info(`📐 Size: ${size}, 🎨 Style: ${style}, 💎 Quality: ${quality}`);
    
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
        size: size,
        quality: quality,
        style: style
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