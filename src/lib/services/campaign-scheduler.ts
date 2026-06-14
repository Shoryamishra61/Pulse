/**
 * PULSE CRM — Campaign Scheduler Service
 * 
 * Manages scheduled campaign execution using a simple polling mechanism.
 * Production: Replace with cron jobs or BullMQ delayed jobs.
 * 
 * Reference: PRD FR-13 - Campaign Scheduling (P1-002 FIX)
 * Reference: SRS §8.1 - Queue System for Scheduled Campaigns
 */

interface ScheduledCampaign {
  campaign_id: string;
  scheduled_at: Date;
  campaign_config: any;
}

class CampaignScheduler {
  private scheduledCampaigns: ScheduledCampaign[] = [];
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start the scheduler (polls every 30 seconds)
   */
  start() {
    if (this.isRunning) {
      console.log('[Campaign Scheduler] Already running');
      return;
    }

    this.isRunning = true;
    console.log('[Campaign Scheduler] Started - checking every 30 seconds');

    // Check immediately on start
    this.checkScheduledCampaigns();

    // Then check every 30 seconds
    this.checkInterval = setInterval(() => {
      this.checkScheduledCampaigns();
    }, 30 * 1000);
  }

  /**
   * Stop the scheduler
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('[Campaign Scheduler] Stopped');
  }

  /**
   * Schedule a campaign for future execution
   */
  scheduleCampaign(campaign_id: string, scheduled_at: Date, campaign_config: any) {
    const existing = this.scheduledCampaigns.find(c => c.campaign_id === campaign_id);
    
    if (existing) {
      // Update existing scheduled campaign
      existing.scheduled_at = scheduled_at;
      existing.campaign_config = campaign_config;
      console.log(`[Campaign Scheduler] Updated schedule for ${campaign_id} to ${scheduled_at.toISOString()}`);
    } else {
      // Add new scheduled campaign
      this.scheduledCampaigns.push({
        campaign_id,
        scheduled_at,
        campaign_config,
      });
      console.log(`[Campaign Scheduler] Scheduled campaign ${campaign_id} for ${scheduled_at.toISOString()}`);
    }

    // Sort by scheduled_at (earliest first)
    this.scheduledCampaigns.sort((a, b) => a.scheduled_at.getTime() - b.scheduled_at.getTime());
  }

  /**
   * Cancel a scheduled campaign
   */
  cancelScheduledCampaign(campaign_id: string): boolean {
    const index = this.scheduledCampaigns.findIndex(c => c.campaign_id === campaign_id);
    if (index >= 0) {
      this.scheduledCampaigns.splice(index, 1);
      console.log(`[Campaign Scheduler] Cancelled scheduled campaign ${campaign_id}`);
      return true;
    }
    return false;
  }

  /**
   * Get all scheduled campaigns
   */
  getScheduledCampaigns(): ScheduledCampaign[] {
    return [...this.scheduledCampaigns];
  }

  /**
   * Check for campaigns that should be dispatched now
   */
  private async checkScheduledCampaigns() {
    const now = new Date();
    const dueNow = this.scheduledCampaigns.filter(c => c.scheduled_at <= now);

    if (dueNow.length === 0) {
      return;
    }

    console.log(`[Campaign Scheduler] Found ${dueNow.length} campaigns due for dispatch`);

    for (const scheduled of dueNow) {
      try {
        await this.executeCampaign(scheduled);
        
        // Remove from scheduled list
        this.scheduledCampaigns = this.scheduledCampaigns.filter(
          c => c.campaign_id !== scheduled.campaign_id
        );
      } catch (error) {
        console.error(`[Campaign Scheduler] Failed to execute campaign ${scheduled.campaign_id}:`, error);
        
        // Remove failed campaign from schedule
        this.scheduledCampaigns = this.scheduledCampaigns.filter(
          c => c.campaign_id !== scheduled.campaign_id
        );
      }
    }
  }

  /**
   * Execute a scheduled campaign
   */
  private async executeCampaign(scheduled: ScheduledCampaign) {
    console.log(`[Campaign Scheduler] Executing campaign ${scheduled.campaign_id}`);

    // Import dynamically to avoid circular dependencies
    const { dispatchCampaign } = await import('./campaign-dispatch');
    
    // Dispatch the campaign
    await dispatchCampaign(scheduled.campaign_config);
    
    console.log(`[Campaign Scheduler] Campaign ${scheduled.campaign_id} dispatched successfully`);
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      is_running: this.isRunning,
      scheduled_campaigns_count: this.scheduledCampaigns.length,
      next_scheduled: this.scheduledCampaigns[0]?.scheduled_at || null,
    };
  }
}

// Singleton instance
export const campaignScheduler = new CampaignScheduler();

// Start scheduler automatically when module loads
if (typeof window === 'undefined') {
  // Only run on server-side
  campaignScheduler.start();
}

// Global access for Next.js hot reload preservation
if (typeof globalThis !== 'undefined') {
  (globalThis as any).__pulseCampaignScheduler = campaignScheduler;
}

// Cleanup on process exit
if (typeof process !== 'undefined') {
  process.on('SIGTERM', () => {
    campaignScheduler.stop();
  });
  process.on('SIGINT', () => {
    campaignScheduler.stop();
  });
}
