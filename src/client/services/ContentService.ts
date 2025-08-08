import { runAgent } from "../../Agent";
import logger from "../../config/logger";
import crypto from 'crypto';

export enum PostType {
  AGENCY_SHOWCASE = 'agency_showcase',
  TIPS_TRICKS = 'tips_tricks', 
  MOTIVATIONAL = 'motivational',
  INDUSTRY_NEWS = 'industry_news',
  BEHIND_SCENES = 'behind_scenes'
}

export interface GeneratedContent {
  text: string;
  postType: PostType;
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
  private readonly defaultConfig: ContentConfig = {
    maxLength: 450,
    includeHashtags: true,
    includeCallToAction: true,
    avoidKeywords: [],
    preferredTopics: []
  };

  private postTypeWeights: Record<PostType, number> = {
    [PostType.AGENCY_SHOWCASE]: 3,
    [PostType.TIPS_TRICKS]: 3,
    [PostType.MOTIVATIONAL]: 2,
    [PostType.INDUSTRY_NEWS]: 1,
    [PostType.BEHIND_SCENES]: 1
  };

  constructor() {
    logger.info("📝 ContentService initialized");
  }

  /**
   * Generate new post content
   */
  public async generatePost(config?: Partial<ContentConfig>): Promise<GeneratedContent> {
    const finalConfig = { ...this.defaultConfig, ...config };
    
    try {
      logger.info("🎨 Generating new post content...");
      
      const postType = this.selectPostType();
      const content = await this.generateContentByType(postType, finalConfig);
      const contentHash = this.createContentHash(content);
      const imageCategory = this.determineImageCategory(content);
      
      const result: GeneratedContent = {
        text: content,
        postType,
        contentHash,
        imageCategory
      };
      
      logger.info(`✅ Generated ${postType} post (${content.length} chars)`);
      return result;
      
    } catch (error) {
      logger.error("❌ Content generation failed:", error);
      return this.getEmergencyContent();
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
   * Select post type based on weights
   */
  private selectPostType(): PostType {
    const weightedTypes: PostType[] = [];
    
    for (const [type, weight] of Object.entries(this.postTypeWeights)) {
      for (let i = 0; i < weight; i++) {
        weightedTypes.push(type as PostType);
      }
    }
    
    const randomIndex = Math.floor(Math.random() * weightedTypes.length);
    return weightedTypes[randomIndex];
  }

  /**
   * Generate content by specific type
   */
  private async generateContentByType(type: PostType, config: ContentConfig): Promise<string> {
    const prompts = {
      [PostType.AGENCY_SHOWCASE]: this.getAgencyShowcasePrompt(config),
      [PostType.TIPS_TRICKS]: this.getTipsPrompt(config),
      [PostType.MOTIVATIONAL]: this.getMotivationalPrompt(config),
      [PostType.INDUSTRY_NEWS]: this.getIndustryNewsPrompt(config),
      [PostType.BEHIND_SCENES]: this.getBehindScenesPrompt(config)
    };

    const prompt = prompts[type];
    const result = await runAgent(null as any, prompt);
    
    return this.parseAIResponse(result);
  }

  /**
   * Generate agency showcase prompt
   */
  private getAgencyShowcasePrompt(config: ContentConfig): string {
    return `
      Create an Instagram post for a social media marketing agency showcasing expertise.
      
      Style Options (choose one randomly):
      - Client success story (anonymous)
      - Behind-the-scenes agency process
      - Industry insight from experience
      - Problem-solution showcase
      
      Requirements:
      - ${config.maxLength} characters max
      - German language
      - Professional but approachable
      - Show expertise without bragging
      - Include engaging question at end
      - 3-4 relevant hashtags if needed
      
      Avoid these overused phrases: "Erfolgreiche Social Media Strategie", "Was denkt ihr?", "Schreibt uns!"
      
      Return only the post text.
    `;
  }

  /**
   * Generate tips prompt
   */
  private getTipsPrompt(config: ContentConfig): string {
    return `
      Create a practical social media marketing tip post.
      
      Tip Categories (choose one):
      - Content creation tricks
      - Engagement strategies  
      - Analytics insights
      - Platform-specific hacks
      - Time-saving tools
      
      Requirements:
      - ${config.maxLength} characters max
      - German language
      - Actionable and specific
      - Include benefit/result
      - Encourage implementation
      - Professional tone
      
      Format: 💡 Tipp: [specific advice] → [expected result/benefit]
      
      Return only the post text.
    `;
  }

  /**
   * Generate motivational prompt
   */
  private getMotivationalPrompt(config: ContentConfig): string {
    const dayOfWeek = new Date().toLocaleDateString('de-DE', { weekday: 'long' });
    
    return `
      Create a motivational ${dayOfWeek} post for business owners and marketers.
      
      Themes (choose one):
      - Entrepreneurial mindset
      - Creative persistence  
      - Team collaboration
      - Innovation mindset
      - Customer focus
      
      Requirements:
      - ${config.maxLength} characters max
      - German language
      - Inspiring but not cheesy
      - Business-relevant
      - Include reflection question
      - Relate to marketing/business challenges
      
      Avoid generic motivation - focus on business-specific inspiration.
      
      Return only the post text.
    `;
  }

  /**
   * Generate industry news prompt
   */
  private getIndustryNewsPrompt(config: ContentConfig): string {
    return `
      Create a post about a current digital marketing trend or development.
      
      Topic Areas (choose one):
      - AI in marketing
      - Platform updates (Instagram, TikTok, LinkedIn)
      - Consumer behavior changes
      - New marketing tools
      - Privacy/regulation changes
      
      Requirements:
      - ${config.maxLength} characters max
      - German language
      - Educational and informative
      - Include practical implications
      - Professional expert tone
      - Ask for community opinions
      
      Format: 🔮 Trend Update: [trend] → [why it matters] → [what to do about it]
      
      Return only the post text.
    `;
  }

  /**
   * Generate behind-the-scenes prompt
   */
  private getBehindScenesPrompt(config: ContentConfig): string {
    return `
      Create an authentic behind-the-scenes post about agency life.
      
      Scenarios (choose one):
      - Team brainstorming session insights
      - Client meeting learnings
      - Tool/process discoveries
      - Daily agency challenges
      - Creative process moments
      
      Requirements:
      - ${config.maxLength} characters max
      - German language
      - Authentic and relatable
      - Show human side of business
      - Include lesson learned
      - Invite community sharing
      
      Tone: Conversational, honest, professional but personal
      
      Return only the post text.
    `;
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
   * Determine image category based on content
   */
  private determineImageCategory(content: string): string {
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
   * Emergency content when generation fails
   */
  private getEmergencyContent(): GeneratedContent {
    const emergencyPosts = [
      "🚀 Innovation passiert nicht von selbst - sie entsteht durch mutiges Handeln und kontinuierliches Lernen.\n\nWas war euer innovativster Schritt dieses Jahr?\n\n#innovation #marketing #mindset",
      
      "💡 Die besten Ideen entstehen oft im Dialog. Deshalb schätzen wir den Austausch mit unserer Community so sehr.\n\nWelche Herausforderung beschäftigt euch gerade?\n\n#community #austausch #marketing",
      
      "📊 Daten erzählen Geschichten - aber nur, wenn wir die richtigen Fragen stellen.\n\nWie nutzt ihr Analytics für eure Strategien?\n\n#analytics #datenanalyse #marketing"
    ];
    
    const randomPost = emergencyPosts[Math.floor(Math.random() * emergencyPosts.length)];
    
    return {
      text: randomPost,
      postType: PostType.MOTIVATIONAL,
      contentHash: this.createContentHash(randomPost),
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
}