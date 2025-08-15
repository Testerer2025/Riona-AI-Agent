import * as path from 'path';
import logger from '../../config/logger';

export interface ThemeConfig {
  id: string;
  name: string;
  enabled: boolean;
  weight: number;
  prompt: string;
  imageKeywords: string[];
  avoidPhrases?: string[];
}

export interface ConfigData {
  themes: ThemeConfig[];
  defaults: {
    maxLength: number;
    includeHashtags: boolean;
    hashtagCount: number;
    language: string;
  };
  backupPosts: string[];
}

export class ConfigManager {
  private config!: ConfigData;
  private readonly configPath: string;

  constructor() {
    this.configPath = path.join(__dirname, '../config/themes.json');
    this.loadConfig();
    logger.info("⚙️ ConfigManager initialized");
  }

  /**
   * Load configuration from file and apply environment overrides
   */
  private loadConfig(): void {
    try {
      // Load base config from JSON file
      this.config = require(this.configPath);
      logger.info(`📋 Loaded ${this.config.themes.length} themes from config`);
      
      // Apply environment variable overrides
      this.applyEnvironmentOverrides();
      
      // Log active configuration
      this.logActiveConfig();
      
    } catch (error) {
      logger.error("❌ Failed to load config:", error);
      // Use minimal fallback config
      this.config = this.getFallbackConfig();
    }
  }

  /**
   * Apply environment variable overrides
   */
  private applyEnvironmentOverrides(): void {
    // Override max length if set
    if (process.env.POST_MAX_LENGTH) {
      const maxLength = parseInt(process.env.POST_MAX_LENGTH);
      if (!isNaN(maxLength)) {
        this.config.defaults.maxLength = maxLength;
        logger.info(`🔧 Overriding maxLength to ${maxLength} from env`);
      }
    }

    // Disable specific themes
    if (process.env.DISABLED_THEMES) {
      const disabledThemes = process.env.DISABLED_THEMES.split(',').map(t => t.trim());
      const beforeCount = this.config.themes.length;
      
      this.config.themes = this.config.themes.filter(
        theme => !disabledThemes.includes(theme.id)
      );
      
      const disabledCount = beforeCount - this.config.themes.length;
      if (disabledCount > 0) {
        logger.info(`🔧 Disabled ${disabledCount} themes from env: ${disabledThemes.join(', ')}`);
      }
    }

    // Add quick theme from environment
    if (process.env.QUICK_THEME) {
      try {
        const [name, prompt, weightStr] = process.env.QUICK_THEME.split('|');
        const weight = parseInt(weightStr) || 1;
        
        const quickTheme: ThemeConfig = {
          id: `quick_${Date.now()}`,
          name: name || 'Quick Theme',
          enabled: true,
          weight: weight,
          prompt: prompt || 'Erstelle einen Instagram Post.',
          imageKeywords: ['business', 'social media']
        };
        
        this.config.themes.push(quickTheme);
        logger.info(`🔧 Added quick theme from env: ${name}`);
      } catch (error) {
        logger.warn("⚠️ Failed to parse QUICK_THEME env variable");
      }
    }

    // Override theme weights
    if (process.env.THEME_WEIGHTS) {
      try {
        const weights = JSON.parse(process.env.THEME_WEIGHTS);
        for (const [themeId, weight] of Object.entries(weights)) {
          const theme = this.config.themes.find(t => t.id === themeId);
          if (theme && typeof weight === 'number') {
            theme.weight = weight;
            logger.info(`🔧 Overriding weight for ${themeId} to ${weight}`);
          }
        }
      } catch (error) {
        logger.warn("⚠️ Failed to parse THEME_WEIGHTS env variable");
      }
    }

    // Complex overrides via JSON
    if (process.env.CONFIG_OVERRIDES) {
      try {
        const overrides = JSON.parse(process.env.CONFIG_OVERRIDES);
        this.mergeConfig(overrides);
        logger.info("🔧 Applied CONFIG_OVERRIDES from env");
      } catch (error) {
        logger.warn("⚠️ Failed to parse CONFIG_OVERRIDES env variable");
      }
    }
  }

  /**
   * Merge configuration overrides
   */
  private mergeConfig(overrides: any): void {
    if (overrides.themes) {
      for (const overrideTheme of overrides.themes) {
        const existingTheme = this.config.themes.find(t => t.id === overrideTheme.id);
        if (existingTheme) {
          Object.assign(existingTheme, overrideTheme);
        } else {
          this.config.themes.push(overrideTheme);
        }
      }
    }

    if (overrides.defaults) {
      Object.assign(this.config.defaults, overrides.defaults);
    }

    if (overrides.backupPosts) {
      this.config.backupPosts = overrides.backupPosts;
    }
  }

  /**
   * Log active configuration
   */
  private logActiveConfig(): void {
    if (process.env.DEBUG_CONFIG === 'true') {
      logger.info("=== ACTIVE CONFIGURATION ===");
      logger.info(`Themes: ${this.config.themes.map(t => `${t.id}(${t.weight})`).join(', ')}`);
      logger.info(`Max Length: ${this.config.defaults.maxLength}`);
      logger.info(`Language: ${this.config.defaults.language}`);
      logger.info(`Backup Posts: ${this.config.backupPosts.length}`);
      logger.info("============================");
    }
  }

  /**
   * Get all enabled themes
   */
  public getEnabledThemes(): ThemeConfig[] {
    return this.config.themes.filter(theme => theme.enabled);
  }

  /**
   * Get theme by ID
   */
  public getThemeById(id: string): ThemeConfig | undefined {
    return this.config.themes.find(theme => theme.id === id);
  }

  /**
   * Select a theme based on weights
   */
  public selectWeightedTheme(): ThemeConfig {
    const enabledThemes = this.getEnabledThemes();
    
    if (enabledThemes.length === 0) {
      logger.error("❌ No enabled themes found!");
      throw new Error("No themes available");
    }

    // Create weighted array
    const weightedThemes: ThemeConfig[] = [];
    for (const theme of enabledThemes) {
      for (let i = 0; i < theme.weight; i++) {
        weightedThemes.push(theme);
      }
    }

    // Select random theme from weighted array
    const randomIndex = Math.floor(Math.random() * weightedThemes.length);
    const selectedTheme = weightedThemes[randomIndex];
    
    logger.info(`🎲 Selected theme: ${selectedTheme.name} (weight: ${selectedTheme.weight})`);
    return selectedTheme;
  }

  /**
   * Get configuration defaults
   */
  public getDefaults(): ConfigData['defaults'] {
    return this.config.defaults;
  }

  /**
   * Get backup posts
   */
  public getBackupPosts(): string[] {
    return this.config.backupPosts;
  }

  /**
   * Get random backup post
   */
  public getRandomBackupPost(): string {
    const posts = this.config.backupPosts;
    if (posts.length === 0) {
      return "🚀 Innovation durch Kreativität und Strategie.\n\n#marketing #socialmedia #innovation";
    }
    return posts[Math.floor(Math.random() * posts.length)];
  }

  /**
   * Load prompt from file if specified
   */
  public loadPromptFromFile(theme: ThemeConfig): string {
    if (theme.promptFile) {
      try {
        const promptPath = path.join(__dirname, '../config/prompts', theme.promptFile);
        return fs.readFileSync(promptPath, 'utf-8');
      } catch (error) {
        logger.warn(`⚠️ Could not load prompt file: ${theme.promptFile}`);
      }
    }
    return theme.prompt || "Erstelle einen Instagram Post.";
  }
  
  /**
   * Build character context for prompts
   */
  public buildCharacterContext(): string {
    const character = (global as any).agentCharacter;
    
    if (!character) {
      logger.warn("⚠️ No character loaded, using default context");
      return "";
    }
    
    // Build context from character
    const context = [
      `Du bist ${character.name}.`,
      character.bio ? `Über dich: ${character.bio.join(' ')}` : '',
      character.knowledge ? `Deine Expertise: ${character.knowledge.join(', ')}` : '',
      character.style?.all ? `Dein Stil: ${character.style.all.join(' ')}` : '',
      character.style?.post ? `Post-Stil: ${character.style.post.join(' ')}` : '',
      '',  // Empty line for separation
    ].filter(line => line).join('\n');
    
    return context;
  }

  /**
   * Reload configuration (for development)
   */
  public reloadConfig(): void {
    if (process.env.NODE_ENV === 'development') {
      delete require.cache[require.resolve(this.configPath)];
      this.loadConfig();
      logger.info("🔄 Configuration reloaded");
    }
  }

  /**
   * Get fallback configuration
   */
  private getFallbackConfig(): ConfigData {
    logger.warn("⚠️ Using fallback configuration");
    return {
      themes: [
        {
          id: "fallback",
          name: "Fallback Theme",
          enabled: true,
          weight: 1,
          prompt: "Erstelle einen Instagram Post für eine Social Media Agentur. Max 450 Zeichen, Deutsch.",
          imageKeywords: ["business", "social media"]
        }
      ],
      defaults: {
        maxLength: 450,
        includeHashtags: true,
        hashtagCount: 3,
        language: "de"
      },
      backupPosts: [
        "🚀 Innovation durch Kreativität.\n\n#marketing #socialmedia #innovation"
      ]
    };
  }

  /**
   * Get all configuration (for debugging)
   */
  public getAllConfig(): ConfigData {
    return this.config;
  }
}