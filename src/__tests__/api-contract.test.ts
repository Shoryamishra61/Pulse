/**
 * API Contract Tests
 *
 * These protect the two regressions that broke the demo:
 * - Mission Panel payload names must normalize into dispatch-ready campaign input.
 * - SSE frames must include named `event:` lines for EventSource listeners.
 */

import { normalizeCampaignRequest } from '../app/api/campaigns/route';
import { formatSSEEvent } from '../app/api/events/route';

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

console.log('\n--- Campaign API Contract ---');

const missionPayload = normalizeCampaignRequest({
  campaignName: 'Win-Back: VIPs',
  segmentName: 'VIPs 90+ Days Dormant',
  audienceSize: 847,
  channel: 'whatsapp',
  messageContent: {
    subject: 'Exclusive Offer',
    body: 'Hi {{first_name}}, come back for 15% off.',
  },
});

assert(missionPayload.isValid, 'Mission Panel payload is accepted');
assert(missionPayload.name === 'Win-Back: VIPs', 'campaignName becomes canonical name');
assert(missionPayload.recipientCount === 500, 'demo recipient count is capped at 500');
assert(missionPayload.channel === 'whatsapp', 'channel is preserved');

const invalidPayload = normalizeCampaignRequest({
  campaignName: 'Missing Body',
  messageContent: {},
});

assert(!invalidPayload.isValid, 'campaign without message body is rejected');

console.log('\n--- SSE Contract ---');

const frame = formatSSEEvent('dispatch_started', {
  campaignId: 'camp-1',
  totalRecipients: 25,
});

assert(frame.startsWith('event: dispatch_started\n'), 'SSE frame has named event line');
assert(frame.includes('data: {"campaignId":"camp-1","totalRecipients":25}'), 'SSE frame serializes data payload');
assert(frame.endsWith('\n\n'), 'SSE frame terminates with blank line');

console.log(`\n${'='.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
