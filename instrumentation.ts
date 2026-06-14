/**
 * PULSE CRM — Server Instrumentation
 * 
 * This file is executed when the Next.js server starts.
 * It initializes services that need to run throughout the server lifecycle.
 * 
 * Reference: Next.js Instrumentation Hook
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on Node.js server (not Edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Import campaign scheduler to ensure it starts
    // The scheduler auto-starts on module load (see campaign-scheduler.ts line 185)
    const { campaignScheduler } = await import('./src/lib/services/campaign-scheduler');
    
    console.log('[PULSE] Server instrumentation complete');
    console.log('[PULSE] Campaign Scheduler:', campaignScheduler.getStatus());
  }
}
