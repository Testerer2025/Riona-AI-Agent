import { Post, Comment } from "../../models";
import logger from "../../config/logger";
import crypto from 'crypto';

export interface PostData {
  content: string;
  contentHash: string;
  postType: string;
  imagePath: string;
  imageCategory: string;
}

export interface CommentData {
  postId: string;
  postUrl: string;
  postAuthor: string;
  commentText: string;
}

export interface HistoryGuidelines {
  avoidKeywords: string[];
  avoidEmojis: string[];
  recommendedTopics: string[];
  recentImageCategories: string[];
}

export class HistoryService {
  private readonly ANALYSIS_WINDOW_DAYS = 14; // Analyze last 14 days
  private readonly MAX_RECENT_POSTS = 25;     // Maximum posts to analyze
  private readonly KEYWORD_THRESHOLD = 3;     // How many times before keyword is "overused"
  
  constructor() {
    logger.info("📊 HistoryService initialized");
  }

  /**
   * Check if content is duplicate
   */
  public async isDuplicate(contentHash: string): Promise<boolean> {
    try {
      const existingPost = await Post.findOne({ content_hash: contentHash });
      
      if (existingPost) {
        logger.warn(`⚠️ Duplicate content detected (hash: ${contentHash.substring(0, 12)}...)`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      logger.error("❌ Duplicate check failed:", error);
      return false; // Fail safely
    }
  }

  /**
   * Analyze recent posts to generate content guidelines
   */
  public async analyzeRecentPosts(): Promise<HistoryGuidelines> {
    try {
      logger.info("🔍 Analyzing recent posts for content guidelines...");
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.ANALYSIS_WINDOW_DAYS);
      
      const recentPosts = await Post.find({
        posted_at: { $gte: cutoffDate }
      })
      .sort({ posted_at: -1 })
      .limit(this.MAX_RECENT_POSTS)
      .select('content image_name posted_at post_type');
      
      if (recentPosts.length === 0) {
        logger.info("📝 No recent posts found, using default guidelines");
        return this.getDefaultGuidelines();
      }
      
      logger.info(`📊 Analyzing ${recentPosts.length} recent posts...`);
      
      const analysis = this.performContentAnalysis(recentPosts);
      
      logger.info("✅ Content analysis completed");
      logger.info(`🚫 Keywords to avoid: ${analysis.avoidKeywords.slice(0, 5).join(', ')}${analysis.avoidKeywords.length > 5 ? '...' : ''}`);
      
      return analysis;
      
    } catch (error) {
      logger.error("❌ Post analysis failed:", error);
      return this.getDefaultGuidelines();
    }
  }

  /**
   * Save new post to history
   */
  public async savePost(postData: PostData): Promise<void> {
    try {
      const post = new Post({
        content: postData.content,
        content_hash: postData.contentHash,
        image_name: postData.imagePath ? require('path').basename(postData.imagePath) : 'unknown',
        image_path: postData.imagePath,
        posted_at: new Date(),
        post_type: postData.postType,
        success: true
      });
      
      await post.save();
      
      logger.info(`✅ Post saved to history:`);
      logger.info(`📝 Content: "${postData.content.substring(0, 100)}..."`);
      logger.info(`🏷️ Type: ${postData.postType}`);
      logger.info(`🖼️ Category: ${postData.imageCategory}`);
      
    } catch (error) {
      logger.error("❌ Failed to save post to history:", error);
    }
  }

  /**
   * Save comment to history
   */
  public async saveComment(commentData: CommentData): Promise<void> {
    try {
      const commentHash = crypto.createHash('md5').update(commentData.commentText).digest('hex');
      
      const comment = new Comment({
        post_id: commentData.postId,
        post_url: commentData.postUrl,
        post_author: commentData.postAuthor,
        comment_text: commentData.commentText,
        comment_hash: commentHash,
        commented_at: new Date(),
        success: true,
        is_own_post: false
      });
      
      await comment.save();
      
      logger.info(`✅ Comment saved: "${commentData.commentText}" on post by ${commentData.postAuthor}`);
      
    } catch (error) {
      logger.error("❌ Failed to save comment to history:", error);
    }
  }

  /**
   * Check if already commented on post
   */
  public async hasCommentedOnPost(postId: string): Promise<boolean> {
    try {
      const existingComment = await Comment.findOne({ post_id: postId });
      return !!existingComment;
      
    } catch (error) {
      logger.error("❌ Comment check failed:", error);
      return false; // Fail safely - better to potentially duplicate than miss engagement
    }
  }

  /**
   * Get posting statistics
   */
  public async getPostingStats(days: number = 7): Promise<{
    totalPosts: number;
    averagePerDay: number;
    topCategories: string[];
    engagementRate: number;
  }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const [posts, comments] = await Promise.all([
        Post.countDocuments({ posted_at: { $gte: cutoffDate } }),
        Comment.countDocuments({ commented_at: { $gte: cutoffDate } })
      ]);
      
      // Get category distribution
      const categoryStats = await Post.aggregate([
        { $match: { posted_at: { $gte: cutoffDate } } },
        { $group: { _id: '$post_type', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]);
      
      const topCategories = categoryStats.map(stat => stat._id);
      const engagementRate = posts > 0 ? (comments / posts) * 100 : 0;
      
      return {
        totalPosts: posts,
        averagePerDay: posts / days,
        topCategories,
        engagementRate
      };
      
    } catch (error) {
      logger.error("❌ Failed to get posting stats:", error);
      return { totalPosts: 0, averagePerDay: 0, topCategories: [], engagementRate: 0 };
    }
  }

  /**
   * Perform detailed content analysis
   */
  private performContentAnalysis(posts: any[]): HistoryGuidelines {
    const wordFrequency = new Map<string, number>();
    const emojiFrequency = new Map<string, number>();
    const imageCategories: string[] = [];
    const topics = new Set<string>();
    
    // Analyze each post
    for (const post of posts) {
      const content = post.content.toLowerCase();
      
      // Extract and count words (excluding common words)
      const words = content.match(/\b[a-zäöüß]+\b/g) || [];
      const meaningfulWords = words.filter(word => 
        word.length > 3 && 
        !this.isCommonWord(word)
      );
      
      for (const word of meaningfulWords) {
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
      
      // Extract and count emojis
      const emojis = content.match(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu) || [];
      for (const emoji of emojis) {
        emojiFrequency.set(emoji, (emojiFrequency.get(emoji) || 0) + 1);
      }
      
      // Track image categories and post types
      if (post.image_name) {
        imageCategories.push(this.extractCategoryFromImageName(post.image_name));
      }
      
      if (post.post_type) {
        topics.add(post.post_type);
      }
    }
    
    // Generate guidelines
    const avoidKeywords = Array.from(wordFrequency.entries())
      .filter(([word, count]) => count >= this.KEYWORD_THRESHOLD)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([word]) => word);
    
    const avoidEmojis = Array.from(emojiFrequency.entries())
      .filter(([emoji, count]) => count >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([emoji]) => emoji);
    
    // Recommend underused topics
    const allTopics = ['business', 'team', 'tech', 'marketing', 'analytics', 'social-media'];
    const usedTopics = Array.from(topics);
    const recommendedTopics = allTopics.filter(topic => 
      !usedTopics.some(used => used.includes(topic))
    ).slice(0, 3);
    
    return {
      avoidKeywords,
      avoidEmojis,
      recommendedTopics,
      recentImageCategories: [...new Set(imageCategories)]
    };
  }

  /**
   * Check if word is too common to be meaningful
   */
  private isCommonWord(word: string): boolean {
    const commonWords = [
      'und', 'der', 'die', 'das', 'eine', 'ein', 'ist', 'sind', 'haben', 'hat',
      'mit', 'für', 'auf', 'von', 'zu', 'im', 'am', 'bei', 'nach', 'vor',
      'über', 'unter', 'durch', 'ohne', 'gegen', 'heute', 'hier', 'dann',
      'noch', 'mehr', 'auch', 'nur', 'aber', 'wenn', 'wie', 'was', 'wer',
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
      'her', 'was', 'one', 'our', 'out', 'day', 'get', 'use', 'man', 'new',
      'now', 'way', 'may', 'say', 'each', 'which', 'she', 'how', 'its', 'said'
    ];
    
    return commonWords.includes(word.toLowerCase());
  }

  /**
   * Extract category from image filename
   */
  private extractCategoryFromImageName(imageName: string): string {
    const lowerName = imageName.toLowerCase();
    
    if (lowerName.includes('business') || lowerName.includes('office')) return 'business';
    if (lowerName.includes('social') || lowerName.includes('media')) return 'social-media';
    if (lowerName.includes('tech') || lowerName.includes('digital')) return 'tech';
    if (lowerName.includes('marketing') || lowerName.includes('brand')) return 'marketing';
    if (lowerName.includes('team') || lowerName.includes('group')) return 'team';
    if (lowerName.includes('analytics') || lowerName.includes('data')) return 'analytics';
    
    return 'default';
  }

  /**
   * Get default guidelines when no history available
   */
  private getDefaultGuidelines(): HistoryGuidelines {
    return {
      avoidKeywords: [],
      avoidEmojis: [],
      recommendedTopics: ['business', 'team', 'innovation'],
      recentImageCategories: []
    };
  }
}