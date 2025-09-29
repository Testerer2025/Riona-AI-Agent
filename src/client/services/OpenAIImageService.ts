import fs from 'fs';
import path from 'path';
import logger from '../../config/logger';
import Replicate from 'replicate';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { geminiApiKeys } from '../../secret';

export interface OpenAIImageRequest {
  prompt: string;
  category: string;
  filename?: string;
}

export class OpenAIImageService {
  private googleAI: GoogleGenerativeAI;
  private model: any;
  private currentApiKeyIndex: number = 0;

  constructor() {
    if (!geminiApiKeys || geminiApiKeys.length === 0) {
      throw new Error('No Gemini API keys available in secret.ts');
    }
    
    const apiKey = geminiApiKeys[this.currentApiKeyIndex];
    this.googleAI = new GoogleGenerativeAI(apiKey);
    this.model = this.googleAI.getGenerativeModel({ 
      model: "imagen-3.0-generate-001" 
    });
    
    logger.info("🎨 Google Imagen 3 Service initialized");
  }

  /**
   * Generate image using Imagen 3
   */
  public async generateImage(request: OpenAIImageRequest): Promise<string> {
    try {
      logger.info(`🎨 Generating Imagen 3 image for: "${request.prompt}"`);
      
      // Optimize prompt for business/professional content
      const optimizedPrompt = this.optimizePrompt(request.prompt, request.category);
      
      // Call Google Imagen 3 API
      const imageData = await this.callImagenAPI(optimizedPrompt);
      
      // Save image
      const imagePath = await this.saveImage(imageData, request.category, request.filename);
      
      logger.info(`✅ Imagen 3 image generated and saved: ${path.basename(imagePath)}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Imagen 3 image generation failed:", error);
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
        filename: `imagen3_${Date.now()}`
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
            prompt_strength: 1 - strength,  
            num_inference_steps: 40,
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
            logger.error("❌ Replicate failed, falling back to Imagen 3:", replicateError);
            // Fall through to Imagen 3
          }
        } else {
          logger.warn(`⚠️ Reference image not found: ${refImagePath}`);
        }
      }
      
      // Default to Imagen 3 generation (no reference images or Replicate failed)
      logger.info(`🎨 Using Imagen 3 (no reference images or fallback)`);
      
      const imagePrompt = this.createThemeImagePrompt(theme, postContent);
      
      const imageData = await this.callImagenAPI(imagePrompt);
      
      const filename = `${theme.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const category = theme.id.replace('_', '-');
      const imagePath = await this.saveImage(imageData, category, filename);
      
      return imagePath;
      
    } catch (error) {
      logger.error(`❌ Theme-based image generation failed for ${theme.id}:`, error);
      return this.generateImageFromContent(postContent, 'default');
    }
  }

  /**
   * Create image prompt from theme configuration
   */
  private createThemeImagePrompt(theme: any, postContent: string): string {
    const allowContext = theme.image?.usePostingText !== false;
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
      
      if (cleanContent && allowContext) {
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
   * Create prompt directly from post content
   */
  private createPromptFromPostContent(postContent: string, category: string): string {
    // Minimale Bearbeitung - nur das Nötigste!
    const cleanContent = postContent
      .replace(/#\w+/g, '')  // Hashtags entfernen
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')  // Emojis entfernen
      .replace(/\s+/g, ' ')  // Mehrfache Spaces zu einem
      .trim()
      .substring(0, 600);  // Länge begrenzen

    const basePrompt = `Create a highly realistic, professional stock photo that visually represents the following social media tip or advice. Focus on the concept, not the literal words. Avoid showing any readable or legible text in the image. Use realistic lighting, natural colors, high detail, and a clean modern setting.

Theme: ${cleanContent}

Context: ${category} environment

Style: ultra realistic, 35mm lens, shallow depth of field, professional stock photography`;
    
    logger.info(`🎨 Imagen 3 prompt length: ${basePrompt.length} chars`);
    
    return basePrompt;
  }

  /**
   * Call Google Imagen 3 API
   */
  private async callImagenAPI(prompt: string): Promise<Buffer> {
    try {
      logger.info(`🔄 Calling Google Imagen 3 API...`);
      
      const result = await this.model.generateContent({
        contents: [{
          role: "user",
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          responseModalities: ["image"],
        }
      });

      if (!result || !result.response) {
        throw new Error('No response from Imagen 3');
      }

      const response = result.response;
      
      // Extract image data from response
      if (!response.candidates || response.candidates.length === 0) {
        throw new Error('No image candidates in response');
      }

      const candidate = response.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        throw new Error('No content parts in candidate');
      }

      const imagePart = candidate.content.parts.find((part: any) => part.inlineData);
      if (!imagePart || !imagePart.inlineData || !imagePart.inlineData.data) {
        throw new Error('No image data found in response');
      }

      // Convert base64 to Buffer
      const base64Data = imagePart.inlineData.data;
      const buffer = Buffer.from(base64Data, 'base64');
      
      logger.info("✅ Imagen 3 image data received");
      return buffer;

    } catch (error) {
      logger.error("❌ Imagen 3 API call failed:", error);
      throw error;
    }
  }

  /**
   * Save image buffer to file system
   */
  private async saveImage(imageBuffer: Buffer, category: string, filename?: string): Promise<string> {
    try {
      logger.info("💾 Saving Imagen 3 image...");
      
      // Create category directory if it doesn't exist
      const categoryDir = path.resolve('assets', category);
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // Generate filename if not provided
      const imageFilename = filename 
        ? `${filename}.png`
        : `imagen3_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      
      const imagePath = path.join(categoryDir, imageFilename);
      
      // Save image
      fs.writeFileSync(imagePath, imageBuffer);
      
      logger.info(`💾 Image saved: ${imagePath}`);
      return imagePath;
      
    } catch (error) {
      logger.error("❌ Failed to save image:", error);
      throw error;
    }
  }

  /**
   * Download image from URL and save to file system (used by Replicate)
   */
  private async downloadAndSaveImage(imageUrl: string, category: string, filename?: string): Promise<string> {
    try {
      logger.info("📥 Downloading image...");
      
      // Create category directory if it doesn't exist
      const categoryDir = path.resolve('assets', category);
      if (!fs.existsSync(categoryDir)) {
        fs.mkdirSync(categoryDir, { recursive: true });
      }

      // Generate filename if not provided
      const imageFilename = filename 
        ? `${filename}.png`
        : `download_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.png`;
      
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
   * Test Imagen 3 generation
   */
  public async testGeneration(): Promise<string> {
    try {
      logger.info("🧪 Testing Imagen 3 generation...");
      
      const testImage = await this.generateImage({
        prompt: "professional business meeting",
        category: "test",
        filename: `imagen3_test_${Date.now()}`
      });
      
      logger.info(`✅ Imagen 3 test successful: ${testImage}`);
      return testImage;
      
    } catch (error) {
      logger.error("❌ Imagen 3 test failed:", error);
      throw error;
    }
  }

  /**
   * Get API usage info
   */
  public getApiInfo(): { provider: string; model: string; costPerImage: string } {
    return {
      provider: "Google",
      model: "Imagen 3",
      costPerImage: "Variable pricing"
    };
  }
}