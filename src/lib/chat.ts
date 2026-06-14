import { usePulseStore, type ConversationMessage, type SegmentResult, type InsightResult } from '@/lib/store';
import { v4 as uuidv4 } from 'uuid';

export async function handleSendMessage(message: string) {
  const store = usePulseStore.getState();
  store.setProcessing(true);
  store.setCommandBarOpen(false);

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, threadId: store.threadId }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || (typeof errorData.error === 'string' ? errorData.error : null) || errorData.details || 'Internal Server Error';
      store.addMessage({
        id: uuidv4(),
        role: 'agent',
        content: `Sorry, I encountered an error: ${errorMessage}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const data = await response.json() as ConversationMessage;

    store.addMessage({
      id: data.id || uuidv4(),
      role: 'agent',
      content: data.content || 'No content provided.',
      structuredData: data.structuredData,
      metadata: data.metadata,
      timestamp: data.timestamp || new Date().toISOString(),
    });

    if (data.structuredData) {
      if (data.structuredData.type === 'segment_result') {
        store.setActiveSegment({
          title: String(data.structuredData.title || 'Segment'),
          metrics: data.structuredData.metrics as SegmentResult['metrics'],
          preview: data.structuredData.preview as SegmentResult['preview'],
          compiledQuery: (data.structuredData.compiledQuery as SegmentResult['compiledQuery']) || null,
          predicateTree: (data.structuredData.predicateTree as SegmentResult['predicateTree']) || null,
          sourceQuery: data.structuredData.sourceQuery as string | undefined,
          lastEvaluatedAt: data.structuredData.lastEvaluatedAt as string | undefined,
        });
        store.setActiveInsights(null);
      } else if (data.structuredData.type === 'insights') {
        store.setActiveInsights(data.structuredData.insights as InsightResult[]);
        store.setActiveSegment(null);
      } else if (data.structuredData.type === 'campaign_draft') {
        store.setPanelOpen(true, {
          campaignName: data.structuredData.title,
          channel: data.structuredData.channel,
          segmentName: data.structuredData.segmentName || store.activeSegment?.title || 'Selected Audience',
          audienceSize: data.structuredData.audienceSize || store.activeSegment?.metrics.totalCustomers || 300,
          messageSubject: data.structuredData.messageSubject || 'Update',
          messageBody: data.structuredData.messageBody || 'Hello {{first_name}}, we have something exciting for you!',
          aiReasoning: data.structuredData.aiReasoning || 'This campaign was drafted from audience behavior and engagement context.',
          segmentCriteria: data.structuredData.predicateTree,
        });
      }
    }

  } catch (err) {
    console.error('Failed to process message', err);
  } finally {
    store.setProcessing(false);
  }
}
