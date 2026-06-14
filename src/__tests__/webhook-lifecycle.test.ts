/**
 * Webhook lifecycle integration test
 *
 * Verifies accept-then-queue processing updates campaign stats end-to-end.
 */

import { v4 as uuidv4 } from 'uuid';
import { webhookProcessor } from '../lib/services/webhook-processor';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string): void {
  if (condition) {
    console.log(`  PASS ${testName}`);
    passed++;
  } else {
    console.error(`  FAIL ${testName}${detail ? ` - ${detail}` : ''}`);
    failed++;
  }
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 3000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

console.log('\n--- Webhook Lifecycle ---');

async function runWebhookLifecycleTests(): Promise<void> {
  const campaignId = uuidv4();
  const messageId = uuidv4();

  webhookProcessor.initializeMessage({
    id: messageId,
    campaignId,
    campaignName: 'Lifecycle Test Campaign',
    customerId: 'cust-test-1',
    customerEmail: 'test@example.com',
    channel: 'whatsapp',
  });

  webhookProcessor.promoteMessageState(messageId, 'sent_to_channel', {
    providerMessageId: 'ch_test_provider',
  });

  const deliveredEventId = uuidv4();
  const acceptResult = webhookProcessor.acceptWebhook({
    eventId: deliveredEventId,
    messageId,
    campaignId,
    eventType: 'delivered',
    timestamp: new Date().toISOString(),
    metadata: { provider: 'test' },
  });

  assert(acceptResult.accepted === true, 'delivered webhook is accepted');

  await waitFor(() => webhookProcessor.getCampaignStats(campaignId).delivered >= 1);

  const stats = webhookProcessor.getCampaignStats(campaignId);
  assert(stats.total === 1, 'campaign has one tracked message');
  assert(stats.sent_to_channel === 1 || stats.delivered === 1, 'message reached channel or delivered state');
  assert(stats.delivered === 1, 'delivered count increments after callback');

  const duplicate = webhookProcessor.acceptWebhook({
    eventId: deliveredEventId,
    messageId,
    campaignId,
    eventType: 'delivered',
    timestamp: new Date().toISOString(),
    metadata: { provider: 'test' },
  });

  assert(duplicate.accepted === true, 'duplicate webhook is accepted');
  assert(
    webhookProcessor.getCampaignStats(campaignId).delivered === 1,
    'duplicate webhook does not double-count delivery',
  );
}

runWebhookLifecycleTests()
  .then(() => {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
    console.log(`${'='.repeat(50)}`);

    if (failed > 0) {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
