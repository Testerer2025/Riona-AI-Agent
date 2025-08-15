import { runAgent } from "../../Agent";
import logger from "../../config/logger";
import crypto from 'crypto';
import { ConfigManager, ThemeConfig } from './ConfigManager';

// Keep PostType enum for backward compatibility
export enum PostType {
  AGENCY_SHOWCASE = 'agency_showcase',
  TIPS_TRICKS = 'tips_tricks', 
  MOTIVATIONAL = 'motivational',
  INDUSTRY_NEWS = 'industry_news',
  BEHIND_SCENES = 'behind_scenes'
}

export interface GeneratedContent {
  text: string;
  postType: string;  // Changed from PostType enum to string
  contentHash: string;
  imageCategory: string;
}

export interface ContentConfig {
  maxLength: number;
  includeHashtags: boolean;
  includeCallToAction: boolean;
  avoidKeywords: string[];
  preferredTopics: string[];
}

export class ContentService {
  private configManager: ConfigManager;
  private defaultConfig: ContentConfig;

  constructor() {
    this.configManager = new ConfigManager();
    
    // Initialize default config from ConfigManager
    const defaults = this.configManager.getDefaults();
    this.defaultConfig = {
      maxLength: defaults.maxLength,
      includeHashtags: defaults.includeHashtags,
      includeCallToAction: true,
      avoidKeywords: [],
      preferredTopics: []
    };
    
    logger.info("📝 ContentService initialized with ConfigManager");
  }

  /**
   * Generate new post content
   */
public async generatePost(config?: Partial<ContentConfig>): Promise<GeneratedContent> {
  const finalConfig = { ...this.defaultConfig, ...config };  // ← WICHTIG!
  
  try {
    logger.info("🎨 Starting post generation...");
    
    const theme = this.configManager.selectWeightedTheme();
    logger.info(`📋 Theme selected: "${theme.name}" (ID: ${theme.id}, Weight: ${theme.weight})`);
    
    const content = await this.generateContentForTheme(theme, finalConfig);
    logger.info(`✅ Post generated successfully: ${content.length} characters`);
    
    const contentHash = this.createContentHash(content);
    const imageCategory = this.determineImageCategoryFromTheme(theme);
    
    const result: GeneratedContent = {
      text: content,
      postType: theme.id,
      contentHash,
      imageCategory
    };
    
    return result;
    
  } catch (error) {
    logger.error("❌ Content generation failed:", error);
    return this.getEmergencyContent();
  }
}

/**
 * Generate post with history context
 */
public async generatePostWithHistory(historyContext: any): Promise<GeneratedContent> {
  const finalConfig = { ...this.defaultConfig };
  
  // Add history context to config
  if (historyContext) {
    finalConfig.avoidKeywords = historyContext.avoid_words || [];
    finalConfig.preferredTopics = historyContext.fresh_elements || [];
  }
  
  try {
    logger.info("🎨 Starting post generation with history context...");
    
    // Select theme as usual
    const theme = this.configManager.selectWeightedTheme();
    logger.info(`📋 Theme selected: "${theme.name}" (ID: ${theme.id})`);
    
    // Generate with history context
    const content = await this.generateContentForTheme(theme, finalConfig);
    logger.info(`✅ Post generated with history awareness: ${content.length} characters`);
    
    const contentHash = this.createContentHash(content);
    const imageCategory = this.determineImageCategoryFromTheme(theme);
    
    return {
      text: content,
      postType: theme.id,
      contentHash,
      imageCategory
    };
    
  } catch (error) {
    logger.error("❌ Content generation with history failed:", error);
    return this.getEmergencyContent();
  }
}

/**
 * Select theme avoiding recent history
 */
public selectWeightedThemeWithHistory(recentThemes: string[]): ThemeConfig {
  const enabledThemes = this.getEnabledThemes();
  
  // Filter out recently used themes if possible
  const availableThemes = enabledThemes.filter(
    theme => !recentThemes.includes(theme.id)
  );
  
  // Use available themes or fall back to all if none left
  const themesToUse = availableThemes.length > 0 ? availableThemes : enabledThemes;
  
  // Continue with weighted selection
  const weightedThemes: ThemeConfig[] = [];
  for (const theme of themesToUse) {
    for (let i = 0; i < theme.weight; i++) {
      weightedThemes.push(theme);
    }
  }
  
  const randomIndex = Math.floor(Math.random() * weightedThemes.length);
  const selectedTheme = weightedThemes[randomIndex];
  
  logger.info(`🎲 Selected theme (history-aware): ${selectedTheme.name}`);
  return selectedTheme;
}

  /**
   * Generate content for specific theme
   */
private async generateContentForTheme(theme: ThemeConfig, config: ContentConfig): Promise<string> {
  try {
    // Get character context
    const characterContext = this.configManager.buildCharacterContext();
    
    // Load prompt from file or use inline
    let themePrompt = theme.promptFile 
      ? this.configManager.loadPromptFromFile(theme)
      : theme.prompt || "";
    
    // Replace variables
    themePrompt = themePrompt.replace(/{{maxLength}}/g, config.maxLength.toString());
    themePrompt = themePrompt.replace(/{{dayOfWeek}}/g, this.getCurrentDayOfWeek());
    
    // Build full prompt with character + history context
    let fullPrompt = characterContext + "\n" + themePrompt;
    
    // Add history context if available
    if (config.avoidKeywords && config.avoidKeywords.length > 0) {
      fullPrompt += `\n\nBASIEREND AUF HISTORIE-ANALYSE:`;
      fullPrompt += `\nVermeide diese überstrapazierten Wörter: ${config.avoidKeywords.join(', ')}`;
    }
    
    if (config.preferredTopics && config.preferredTopics.length > 0) {
      fullPrompt += `\nBevorzuge diese frischen Elemente: ${config.preferredTopics.join(', ')}`;
    }
    
    logger.info(`🤖 Generating content with theme: ${theme.name} + history context`);
    
    const result = await runAgent(null as any, fullPrompt);
    return this.parseAIResponse(result);
    
  } catch (error) {
    logger.error(`❌ Failed to generate content for theme ${theme.id}:`, error);
    throw error;
  }
}

  /**
   * Generate content for comments
   */
  public async generateComment(postCaption: string): Promise<string> {
    try {
      const prompt = `
        Create a thoughtful, professional comment for this Instagram post:
        
        "${postCaption}"
        
        Requirements:
        - Max 280 characters
        - Professional but friendly tone
        - Adds value to the conversation
        - Avoids generic responses
        - German language
        - Shows expertise without being pushy
        
        Examples of good comments:
        "Genau das erleben wir auch bei unseren Kunden! Besonders Punkt 2 macht oft den Unterschied. Danke für den Einblick! 💡"
        "Interessanter Ansatz! Wir haben ähnliche Erfahrungen gemacht und können das nur bestätigen. 🎯"
        
        Return only the comment text, no explanations.
      `;
      
      const result = await runAgent(null as any, prompt);
      const comment = this.parseAIResponse(result);
      
      // Ensure reasonable length
      if (comment.length > 300) {
        return comment.substring(0, 297) + "...";
      }
      
      return comment;
      
    } catch (error) {
      logger.error("❌ Comment generation failed:", error);
      return this.getEmergencyComment();
    }
  }

  /**
   * Parse AI response to extract clean text
   */
  private parseAIResponse(response: any): string {
    try {
      if (typeof response === 'string') {
        return response.trim();
      }
      
      if (Array.isArray(response) && response[0]) {
        const first = response[0];
        if (typeof first === 'string') {
          return first.trim();
        }
        if (first.content || first.text || first.post) {
          return String(first.content || first.text || first.post).trim();
        }
      }
      
      if (typeof response === 'object' && response !== null) {
        if (response.content) return String(response.content).trim();
        if (response.text) return String(response.text).trim();
        if (response.post) return String(response.post).trim();
      }
      
      // Fallback
      return String(response).trim();
      
    } catch (error) {
      logger.error("Failed to parse AI response:", error);
      throw error;
    }
  }

  /**
   * Create content hash for duplicate detection
   */
  private createContentHash(content: string): string {
    return crypto.createHash('md5').update(content).digest('hex');
  }

  /**
   * Determine image category from theme
   */
  private determineImageCategoryFromTheme(theme: ThemeConfig): string {
    // Use first keyword from theme as category
    if (theme.imageKeywords && theme.imageKeywords.length > 0) {
      return theme.imageKeywords[0];
    }
    
    // Fallback to theme ID
    return theme.id.replace('_', '-');
  }

  /**
   * Determine image category based on content (backward compatibility)
   */
  public determineImageCategory(content: string): string {
    const contentLower = content.toLowerCase();
    
    const categories = {
      'business': ['meeting', 'strategie', 'unternehmen', 'business', 'erfolg'],
      'social-media': ['instagram', 'tiktok', 'social media', 'content', 'posting'],
      'tech': ['tool', 'digital', 'tech', 'software', 'innovation', 'ki', 'ai'],
      'team': ['team', 'zusammen', 'kollaboration', 'mitarbeiter'],
      'marketing': ['marketing', 'kampagne', 'werbung', 'brand', 'marke']
    };
    
    for (const [category, keywords] of Object.entries(categories)) {
      if (keywords.some(keyword => contentLower.includes(keyword))) {
        return category;
      }
    }
    
    return 'default';
  }

  /**
   * Get current day of week in German
   */
  private getCurrentDayOfWeek(): string {
    const days = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
    return days[new Date().getDay()];
  }

  /**
   * Emergency content when generation fails
   */
  private getEmergencyContent(): GeneratedContent {
    const backupPost = this.configManager.getRandomBackupPost();
    
    return {
      text: backupPost,
      postType: 'fallback',
      contentHash: this.createContentHash(backupPost),
      imageCategory: 'default'
    };
  }

  /**
   * Emergency comment when generation fails
   */
  private getEmergencyComment(): string {
    const emergencyComments = [
      "Interessanter Punkt! 👍",
      "Danke für den Einblick! 💡", 
      "Sehr relevant für unsere Branche! 🎯",
      "Guter Ansatz! 👏"
    ];
    
    return emergencyComments[Math.floor(Math.random() * emergencyComments.length)];
  }

  /**
   * Reload configuration (for development)
   */
  public reloadConfig(): void {
    this.configManager.reloadConfig();
    
    // Update default config
    const defaults = this.configManager.getDefaults();
    this.defaultConfig.maxLength = defaults.maxLength;
    this.defaultConfig.includeHashtags = defaults.includeHashtags;
    
    logger.info("📝 ContentService config reloaded");
  }
}