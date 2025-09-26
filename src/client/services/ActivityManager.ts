import logger from "../../config/logger";

export enum ActivityType {
  POSTING = 'posting',
  COMMENTING = 'commenting',
  LIKING = 'liking',
  IDLE = 'idle'
}

export enum ActivityPriority {
  HIGH = 1,    // Posting
  MEDIUM = 2,  // Commenting
  LOW = 3      // Liking
}

interface ScheduledActivity {
  id: string;
  type: ActivityType;
  priority: ActivityPriority;
  scheduledFor: Date;
  data?: any;
}

export class ActivityManager {
  private currentActivity: ActivityType = ActivityType.IDLE;
  private activityQueue: ScheduledActivity[] = [];
  private isProcessing: boolean = false;
  private postingInterval: NodeJS.Timeout | null = null;
  
  // Configuration
  private readonly BASE_POST_INTERVAL_MS: number;
  private readonly POST_VARIANCE_MS: number;
  private readonly COMMENT_INTERVAL_MS: number = 3 * 60 * 1000; // 3 minutes
  private readonly SAFETY_BUFFER_MS: number = 30 * 1000; // 30 seconds

  constructor(isTestMode: boolean = false) {
    if (isTestMode) {
      this.BASE_POST_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes for testing
      this.POST_VARIANCE_MS = 0; // No variance in test mode
      logger.info(`🎯 ActivityManager initialized - Post interval: ${this.BASE_POST_INTERVAL_MS / 60000} minutes (fixed)`);
    } else {
      this.BASE_POST_INTERVAL_MS = 4.5 * 60 * 60 * 1000; // 4.5 hours base interval
      this.POST_VARIANCE_MS = 30 * 60 * 1000; // ±30 minutes variance (4-5 hours total)
      
      const minHours = (this.BASE_POST_INTERVAL_MS - this.POST_VARIANCE_MS) / (60 * 60 * 1000);
      const maxHours = (this.BASE_POST_INTERVAL_MS + this.POST_VARIANCE_MS) / (60 * 60 * 1000);
      
      logger.info(`🎯 ActivityManager initialized - Post interval: ${minHours.toFixed(1)}-${maxHours.toFixed(1)} hours`);
    }
  }

  /**
   * Generate random posting interval between min and max
   */
  private getRandomPostingInterval(): number {
    const variance = Math.random() * this.POST_VARIANCE_MS * 2 - this.POST_VARIANCE_MS; // -variance to +variance
    const interval = this.BASE_POST_INTERVAL_MS + variance;
    
    const hours = interval / (60 * 60 * 1000);
    logger.info(`⏰ Next post scheduled in ${hours.toFixed(1)} hours`);
    
    return Math.max(interval, 60000); // Minimum 1 minute
  }

  /**
   * Start the activity scheduler
   */
  public start(): void {
    logger.info("🚀 Starting ActivityManager scheduler...");
    
    // Schedule regular posting with random intervals
    this.scheduleRecurringPosts();
    
    // Start processing queue
    this.processActivityQueue();
    
    logger.info("✅ ActivityManager started successfully");
  }

  /**
   * Stop all activities gracefully
   */
  public stop(): void {
    logger.info("⏹️ Stopping ActivityManager...");
    
    if (this.postingInterval) {
      clearTimeout(this.postingInterval);
      this.postingInterval = null;
    }
    
    this.activityQueue = [];
    this.currentActivity = ActivityType.IDLE;
    this.isProcessing = false;
    
    logger.info("✅ ActivityManager stopped");
  }

  /**
   * Check if system is available for a specific activity
   */
  public canExecuteActivity(type: ActivityType): boolean {
    // Posting has highest priority - can interrupt everything
    if (type === ActivityType.POSTING) {
      return true;
    }
    
    // Other activities only when idle or lower priority
    const currentPriority = this.getActivityPriority(this.currentActivity);
    const requestedPriority = this.getActivityPriority(type);
    
    return !this.isProcessing && (this.currentActivity === ActivityType.IDLE || requestedPriority < currentPriority);
  }

  /**
   * Request to execute an activity
   */
  public async requestActivity(type: ActivityType, data?: any): Promise<boolean> {
    if (type === ActivityType.POSTING) {
      return await this.executeImmediate(type, data);
    }
    
    if (this.canExecuteActivity(type)) {
      return await this.executeImmediate(type, data);
    }
    
    logger.info(`⏳ Activity ${type} queued - system busy with ${this.currentActivity}`);
    this.queueActivity(type, data);
    return false;
  }

  /**
   * Get current system status
   */
  public getStatus(): {
    currentActivity: ActivityType;
    isProcessing: boolean;
    queueLength: number;
    nextScheduledPost: Date | null;
  } {
    return {
      currentActivity: this.currentActivity,
      isProcessing: this.isProcessing,
      queueLength: this.activityQueue.length,
      nextScheduledPost: this.getNextScheduledPost()
    };
  }

  /**
   * Schedule recurring posts with random intervals
   */
  private scheduleRecurringPosts(): void {
    const scheduleNextPost = () => {
      const nextInterval = this.getRandomPostingInterval();
      
      this.postingInterval = setTimeout(() => {
        logger.info("🎯 Triggering scheduled post");
        
        if (this.canExecuteActivity(ActivityType.POSTING)) {
          logger.info("✅ Can post - requesting activity");
          this.requestActivity(ActivityType.POSTING);
        } else {
          logger.warn("⏰ Scheduled post skipped - system busy");
        }
        
        // Schedule the next post with a new random interval
        scheduleNextPost();
        
      }, nextInterval);
    };
    
    // Initial post after 2 minutes
    setTimeout(() => {
      logger.info("🎯 Triggering initial post after 2 minutes");
      this.requestActivity(ActivityType.POSTING);
      
      // Start the random scheduling cycle
      scheduleNextPost();
      
    }, 2 * 60 * 1000);
  }

  /**
   * Execute activity immediately
   */
  private async executeImmediate(type: ActivityType, _data?: any): Promise<boolean> {
    if (this.isProcessing && type !== ActivityType.POSTING) {
      logger.warn(`🚫 Cannot execute ${type} - system processing`);
      return false;
    }

    // Interrupt current activity if posting
    if (type === ActivityType.POSTING && this.currentActivity !== ActivityType.IDLE) {
      logger.info(`⚡ Interrupting ${this.currentActivity} for posting`);
    }

    this.setActivity(type);
    
    try {
      logger.info(`▶️ Executing ${type} activity`);
      
      // NOTE: This ActivityManager now only manages state and scheduling
      // The actual work is done in the main loop of InstagramBot
      // We just set the state - the unlock happens when the real work is done
      
      // No simulation anymore - the real work determines the timing
      logger.info(`🔄 ${type} activity started - waiting for completion...`);
      return true;
      
    } catch (error) {
      logger.error(`❌ ${type} activity failed:`, error);
      this.setActivity(ActivityType.IDLE); // Only unlock on error
      return false;
    }
  }

  /**
   * Mark activity as completed (called from outside)
   */
  public completeActivity(type: ActivityType, success: boolean = true): void {
    if (this.currentActivity === type) {
      if (success) {
        logger.info(`✅ ${type} activity completed successfully`);
      } else {
        logger.warn(`⚠️ ${type} activity completed with errors`);
      }
      this.setActivity(ActivityType.IDLE);
    } else {
      logger.warn(`⚠️ Tried to complete ${type} but current activity is ${this.currentActivity}`);
    }
  }

  /**
   * Queue activity for later execution
   */
  private queueActivity(type: ActivityType, data?: any): void {
    const activity: ScheduledActivity = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      priority: this.getActivityPriority(type),
      scheduledFor: new Date(Date.now() + this.COMMENT_INTERVAL_MS),
      data
    };
    
    this.activityQueue.push(activity);
    this.activityQueue.sort((a, b) => a.priority - b.priority || a.scheduledFor.getTime() - b.scheduledFor.getTime());
  }

  /**
   * Process queued activities
   */
  private async processActivityQueue(): Promise<void> {
    setInterval(async () => {
      if (this.activityQueue.length === 0 || this.isProcessing) {
        return;
      }

      const now = new Date();
      const nextActivity = this.activityQueue[0];
      
      if (nextActivity.scheduledFor <= now && this.canExecuteActivity(nextActivity.type)) {
        this.activityQueue.shift();
        await this.executeImmediate(nextActivity.type, nextActivity.data);
      }
    }, 10000); // Check every 10 seconds
  }

  /**
   * Set current activity state
   */
  private setActivity(type: ActivityType): void {
    this.currentActivity = type;
    this.isProcessing = type !== ActivityType.IDLE;
    
    if (type !== ActivityType.IDLE) {
      logger.info(`🔒 System locked for ${type}`);
    } else {
      logger.info("🔓 System unlocked");
    }
  }

  /**
   * Get activity priority
   */
  private getActivityPriority(type: ActivityType): ActivityPriority {
    switch (type) {
      case ActivityType.POSTING:
        return ActivityPriority.HIGH;
      case ActivityType.COMMENTING:
        return ActivityPriority.MEDIUM;
      case ActivityType.LIKING:
        return ActivityPriority.LOW;
      default:
        return ActivityPriority.LOW;
    }
  }

  /**
   * Get next scheduled post time
   */
  private getNextScheduledPost(): Date | null {
    const nextPost = this.activityQueue.find(a => a.type === ActivityType.POSTING);
    return nextPost ? nextPost.scheduledFor : null;
  }

  /**
   * Simulate activity execution (temporary)
   */
  private async simulateActivity(type: ActivityType): Promise<void> {
    const duration = type === ActivityType.POSTING ? 30000 : 5000;
    await new Promise(resolve => setTimeout(resolve, duration));
  }
}