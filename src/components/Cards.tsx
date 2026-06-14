'use client';

import { useState } from 'react';
import { usePulseStore } from '@/lib/store';
import { handleSendMessage } from '@/lib/chat';
import { motion } from 'framer-motion';

export function renderInlineMarkdown(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

export default function StructuredCard({ data }: { data: Record<string, unknown> }) {
  const cardType = data.type as string;
  if (cardType === 'segment_result') return <SegmentResultCard data={data} />;
  if (cardType === 'insights') return <InsightsCard data={data} />;
  if (cardType === 'campaign_draft') return <CampaignDraftCard data={data} />;
  if (cardType === 'analytics_summary') return <AnalyticsSummaryCard data={data} />;
  return null;
}

export function SegmentResultCard({ data }: { data: Record<string, unknown> }) {
  const [showSQL, setShowSQL] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [segmentName, setSegmentName] = useState((data.title as string) || 'New Segment');
  const [segmentDesc, setSegmentDesc] = useState((data.sourceQuery as string) || '');
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const { setPanelOpen, isProcessing } = usePulseStore();
  const sourceQuery = String(data.sourceQuery || (data.title as string).replace(/^Segment:\s*/, ''));
  const lastEvaluatedAt = data.lastEvaluatedAt as string | undefined;
  const metrics = data.metrics as Record<string, string | number>;
  const preview = data.preview as Array<Record<string, string | number>>;
  const compiledQuery = data.compiledQuery as { parameterizedSQL?: string; params?: (string | number | boolean)[]; humanReadable?: string } | null;

  const handleSaveSegment = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/segments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: segmentName,
          description: segmentDesc,
          predicate: data.predicateTree
        })
      });
      if (res.ok) {
        setIsSaved(true);
        setShowSaveForm(false);
      } else {
        const err = await res.json();
        alert("Error saving segment: " + (err.error?.message || "Unknown error"));
      }
    } catch (e) {
      console.error(e);
      alert("Error saving segment");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="structured-card">
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-type-label">Segment</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>·</span>
          <span className="card-title">{data.title as string}</span>
        </div>
      </div>

      <div className="card-body">
        <div className="card-metrics">
          <div className="metric-item">
            <span className="metric-value">{metrics.totalCustomers}</span>
            <span className="metric-label">Customers</span>
          </div>
          <div className="metric-item">
            <span className="metric-value">{metrics.avgSpend}</span>
            <span className="metric-label">Avg Spend</span>
          </div>
          <div className="metric-item">
            <span className="metric-value">{metrics.totalPotentialRevenue}</span>
            <span className="metric-label">Total Revenue</span>
          </div>
        </div>

        {preview && preview.length > 0 && (
          <div style={{ marginTop: '16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-xs)' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-default)' }}>
                  {['Name', 'Spend', 'Orders', 'Last Order', 'City'].map(h => (
                    <th key={h} style={{
                      padding: '8px', textAlign: 'left', color: 'var(--text-muted)',
                      fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '8px', color: 'var(--text-primary)' }}>{row.name}</td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{row.totalSpend}</td>
                    <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{row.orders}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{row.lastOrder}</td>
                    <td style={{ padding: '8px', color: 'var(--text-secondary)' }}>{row.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {compiledQuery && (
          <div style={{ marginTop: '16px' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowSQL(!showSQL)} style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {showSQL ? 'Hide Data Lineage' : 'View Data Lineage (Debug)'}
            </button>
            {showSQL && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ padding: '12px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>
                    Parameterized SQL (Compiled)
                  </div>
                  <pre style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', overflow: 'auto', margin: 0 }}>
                    {compiledQuery.parameterizedSQL}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {lastEvaluatedAt && (
        <div style={{ marginTop: '12px', fontSize: '10px', color: 'var(--text-muted)' }}>
          Last evaluated: {new Date(lastEvaluatedAt).toLocaleString('en-IN')}
        </div>
      )}

      <div className="card-actions">
        <button 
          className="btn btn-primary btn-sm"
          onClick={() => {
            setPanelOpen(true, {
              campaignName: `Campaign: ${data.title}`,
              segmentName: data.title as string,
              audienceSize: metrics.totalCustomers as number,
              channel: 'email',
              messageSubject: 'Special Update',
              messageBody: 'Hi {{first_name}}, we picked this for your {{preferred_category}} interests in {{city}}. As a {{loyalty_tier}} shopper, here is a private offer based on what you usually buy.',
              segmentCriteria: data.predicateTree,
            });
          }}
        >
          Create Campaign
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={isProcessing}
          onClick={() => handleSendMessage(sourceQuery)}
        >
          {isProcessing ? 'Re-evaluating...' : 'Re-evaluate'}
        </button>
        {!isSaved ? (
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSaveForm(!showSaveForm)}
          >
            Save Segment
          </button>
        ) : (
          <span style={{ fontSize: '12px', color: 'var(--accent-blue)', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
            ✓ Saved
          </span>
        )}
      </div>

      {showSaveForm && (
        <motion.div 
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          style={{ marginTop: '16px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)', overflow: 'hidden' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input 
              type="text" 
              className="input-field" 
              value={segmentName} 
              onChange={e => setSegmentName(e.target.value)} 
              placeholder="Segment Name" 
              style={{ fontSize: '12px', padding: '8px' }}
            />
            <input 
              type="text" 
              className="input-field" 
              value={segmentDesc} 
              onChange={e => setSegmentDesc(e.target.value)} 
              placeholder="Segment Description" 
              style={{ fontSize: '12px', padding: '8px' }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowSaveForm(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSaveSegment} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Confirm Save'}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export function InsightsCard({ data }: { data: Record<string, unknown> }) {
  const insights = data.insights as Array<Record<string, unknown>>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {insights.map((insight) => {
        const metrics = insight.metrics as Record<string, string | number>;
        return (
          <div key={insight.id as string} className="structured-card">
            <div className="card-header">
              <div className="card-header-left">
                <span className="card-type-label">Insight</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>·</span>
                <span className="card-title">{insight.title as string}</span>
              </div>
            </div>
            <div className="card-body">
              <p className="card-description">{insight.description as string}</p>
              <div className="card-metrics">
                {Object.entries(metrics).map(([key, value]) => (
                  <div key={key} className="metric-item">
                    <span className="metric-value">{value}</span>
                    <span className="metric-label">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                  </div>
                ))}
              </div>
              {Boolean(insight.aiReasoning) && (
                <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Analysis</span>
                  <p style={{ marginTop: '4px' }}>{insight.aiReasoning as string}</p>
                </div>
              )}
            </div>
            <div className="card-actions">
              <button className="btn btn-primary btn-sm">{insight.suggestedAction as string}</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function CampaignDraftCard({ data }: { data: Record<string, unknown> }) {
  const title = String(data.title || 'Draft Campaign');
  const channel = String(data.channel || 'multi-channel');
  const status = String(data.status || 'draft');
  const audience = data.audience ? String(data.audience) : '';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="structured-card"
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {title}
        </h3>
        <span className="badge badge-neutral" style={{ textTransform: 'uppercase' }}>
          {channel}
        </span>
      </div>

      <div style={{ background: 'var(--bg-secondary)', padding: '16px', borderRadius: 'var(--radius-md)', marginBottom: '16px', fontSize: '13px', color: 'var(--text-secondary)' }}>
        <p><strong>Status:</strong> {status}</p>
        <p><strong>Primary Channel:</strong> {channel}</p>
        {audience && <p><strong>Audience:</strong> {audience}</p>}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button 
          className="btn btn-primary" 
          style={{ flex: 1 }}
          onClick={() => {
            const { setPanelOpen } = usePulseStore.getState();
            setPanelOpen(true, {
               audienceSize: Number(data.audienceSize || 847),
               segmentName: String(data.segmentName || audience || 'Target Segment'),
               channel,
               messageSubject: String(data.messageSubject || title),
               messageBody: String(data.messageBody || 'Hey {{first_name}}, we picked this for your {{preferred_category}} interests. As a {{loyalty_tier}} shopper, here is a private offer based on what you usually buy.'),
               aiReasoning: String(data.aiReasoning || 'AI selected this audience, channel, and personalized copy from behavioral context.'),
               context: 'AI Orchestrated Campaign'
            });
          }}
        >
          Review & Launch
        </button>
        <button className="btn btn-secondary" style={{ flex: 1 }}>Edit Copy</button>
      </div>
    </motion.div>
  );
}

export function AnalyticsSummaryCard({ data }: { data: Record<string, unknown> }) {
  const metrics = data.metrics as Record<string, string | number>;
  return (
    <div className="structured-card">
      <div className="card-header">
        <div className="card-header-left">
          <span className="card-type-label">Analytics</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>·</span>
          <span className="card-title">Campaign Performance</span>
        </div>
      </div>
      <div className="card-body">
        <div className="card-metrics">
          {Object.entries(metrics).map(([key, value]) => (
            <div key={key} className="metric-item">
              <span className="metric-value">{value}</span>
              <span className="metric-label">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
