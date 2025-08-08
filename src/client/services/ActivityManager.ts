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
  private readonly POST_INTERVAL_MS: number;
  private readonly COMMENT_INTERVAL_MS: number = 3 * 60 * 1000; // 3 minutes
  private readonly SAFETY_BUFFER_MS: number = 30 * 1000; // 30 seconds

  constructor(isTestMode: boolean = false) {
    this.POST_INTERVAL_MS = isTestMode ? 5 * 60 * 1000 : 30 * 60 * 1000; // 5min test, 30min prod
    logger.info(`🎯 ActivityManager initialized - Post interval: ${this.POST_INTERVAL_MS / 60000} minutes`);
  }

  /**
   * Start the activity scheduler
   */
  public start(): void {
    logger.info("🚀 Starting ActivityManager scheduler...");
    
    // Schedule regular posting
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
      clearInterval(this.postingInterval);
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
   * Schedule recurring posts
   */
  private scheduleRecurringPosts(): void {
    // Initial post after 2 minutes
    setTimeout(() => {
      this.requestActivity(ActivityType.POSTING);
    }, 2 * 60 * 1000);

    // Regular interval posting
    this.postingInterval = setInterval(() => {
      if (this.canExecuteActivity(ActivityType.POSTING)) {
        this.requestActivity(ActivityType.POSTING);
      } else {
        logger.warn("⏰ Scheduled post skipped - system busy");
      }
    }, this.POST_INTERVAL_MS);
  }

  /**
   * Execute activity immediately
   */
  private async executeImmediate(type: ActivityType, data?: any): Promise<boolean> {
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
      
      // Here we would call the actual service methods
      // This is where we'll integrate with ContentService, etc.
      
      await this.simulateActivity(type);
      
      logger.info(`✅ ${type} activity completed`);
      return true;
      
    } catch (error) {
      logger.error(`❌ ${type} activity failed:`, error);
      return false;
    } finally {
      this.setActivity(ActivityType.IDLE);
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