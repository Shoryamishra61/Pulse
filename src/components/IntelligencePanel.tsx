'use client';

import { useState, useEffect } from 'react';
import { usePulseStore } from '@/lib/store';

interface AnalyticsData {
  attribution: {
    model: string;
    lookbackWindow: string;
    campaigns: Array<{
      campaignId: string;
      campaignName: string;
      orders: number;
      revenue: number;
      roi: string;
    }>;
  };
  narrativeInsights: Array<{
    status: 'positive' | 'neutral' | 'negative';
    title: string;
    detail: string;
  }>;
}

export default function IntelligencePanel() {
  const { activeCampaign } = usePulseStore();
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/analytics')
      .then((response) => response.json())
      .then((data: AnalyticsData) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch(() => {
        if (!cancelled) setAnalytics(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCampaign?.events.length]);

  const campaignRows = analytics?.attribution.campaigns.slice(0, 3) || [
    { campaignId: 'c1', campaignName: 'Holiday Gift Guide', orders: 68, revenue: 432100, roi: '18.2x' },
    { campaignId: 'c2', campaignName: 'Cart Recovery W23', orders: 36, revenue: 118500, roi: '24.5x' },
    { campaignId: 'c3', campaignName: 'Welcome Series', orders: 12, revenue: 38400, roi: '8.4x' }
  ];
  const narratives = analytics?.narrativeInsights || [
    { status: 'positive', title: 'WhatsApp + personalized offers', detail: '3x better than email for lapsed VIPs. The personal touch works on messaging channels.' },
    { status: 'negative', title: 'Broad campaigns to churned customers', detail: '0.8% conversion. Churned customers need a specific reason to return.' },
    { status: 'neutral', title: 'New Arrivals emails', detail: 'High open rates (28%) but low clicks (1.2%). Consider adding stronger clear CTAs.' }
  ];

  // Always render Intelligence Panel

  return (
    <aside id="tour-intelligence" className="intelligence-panel" aria-label="Intelligence">
      <div className="intel-section">
        <div className="intel-section-title">What&apos;s Working</div>
        <div className="narrative-feed">
          {narratives.map((item) => (
            <div key={item.title} className="narrative-item">
              <div className={`narrative-dot ${item.status}`} />
              <div className="narrative-text"><strong>{item.title}:</strong> {item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="intel-section">
        <div className="intel-section-title">Revenue Attribution</div>
        <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '6px' }}>{analytics?.attribution.model || 'Last-Touch'} · {analytics?.attribution.lookbackWindow || '7 days'} lookback</div>
        <div className="attribution-table">
          {campaignRows.map((campaign) => (
            <div key={campaign.campaignId} className="attribution-row">
              <span className="attribution-name">{campaign.campaignName}</span>
              <span className="attribution-metric">{campaign.orders} orders</span>
              <span className="attribution-metric">₹{campaign.revenue.toLocaleString('en-IN')}</span>
              <span className="attribution-roi">{campaign.roi}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="intel-section">
        <div className="intel-section-title">Channel Distribution</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', background: 'var(--bg-primary)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
              <span style={{ color: 'var(--text-secondary)' }}>WhatsApp</span>
              <span>45%</span>
            </div>
            <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '45%', background: 'var(--green)', borderRadius: '3px' }} />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Email</span>
              <span>35%</span>
            </div>
            <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '35%', background: 'var(--blue)', borderRadius: '3px' }} />
            </div>
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', marginBottom: '6px', fontWeight: 500 }}>
              <span style={{ color: 'var(--text-secondary)' }}>SMS</span>
              <span>20%</span>
            </div>
            <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: '20%', background: 'var(--text-muted)', borderRadius: '3px' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="intel-section">
        <div className="intel-section-title">Recent Activity</div>
        {activeCampaign && activeCampaign.events.length > 0 ? (
          <div>
            {activeCampaign.events.slice(-5).reverse().map((event) => (
              <div key={event.id} className="intel-event-item">
                <span className={`intel-event-type ${event.eventType || event.type}`}>{event.eventType || event.type}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{event.messageId?.slice(0, 8)}</span>
                <span className="intel-event-time">{new Date(event.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cohort-insight">
            Launch a campaign to see signed channel callbacks appear here.
          </div>
        )}
      </div>

      <div className="intel-section">
        <div className="intel-section-title">Audience Health</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
          <div style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Active (30d)</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>24.8K</div>
            <div style={{ fontSize: '10px', color: 'var(--green)', marginTop: '4px' }}>↑ 12% vs last mo</div>
          </div>
          <div style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, marginBottom: '4px' }}>Opt-Out Rate</div>
            <div style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>0.12%</div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '4px' }}>Healthy baseline</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
