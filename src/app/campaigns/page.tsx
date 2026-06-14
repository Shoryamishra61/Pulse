'use client';

import { useState, useEffect } from 'react';
import { usePulseStore } from '@/lib/store';
import SignalLine from '@/components/SignalLine';

interface Campaign {
  id: string;
  name: string;
  segmentName: string;
  channel: string;
  status: string;
  recipientCount: number;
  messageContent: { subject?: string; body: string };
  createdAt: string;
  stats?: {
    total: number;
    created: number;
    enqueued: number;
    dispatched: number;
    sent_to_channel: number;
    delivered: number;
    opened: number;
    read: number;
    clicked: number;
    converted: number;
    failed: number;
    bounced: number;
    complained: number;
  };
  attribution?: {
    orders: number;
    revenue: number;
    roi: string;
    avgOrderValue: number;
  } | null;
}

export default function CampaignsPage() {
  const { activeCampaign, setPanelOpen } = usePulseStore();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedCampaignDetails, setSelectedCampaignDetails] = useState<Campaign | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      // Artificial delay for production feel
      await new Promise((resolve) => setTimeout(resolve, 800));
      
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      const loadedCampaigns = data.campaigns || [];
      setCampaigns(loadedCampaigns);
      if (loadedCampaigns.length > 0 && !selectedCampaignId) {
        setSelectedCampaignId(loadedCampaigns[0].id);
        fetchCampaignDetails(loadedCampaigns[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCampaignDetails = async (id: string) => {
    setDetailsLoading(true);
    try {
      const res = await fetch(`/api/campaigns?campaignId=${id}`);
      const data = await res.json();
      setSelectedCampaignDetails(data);
    } catch (err) {
      console.error(err);
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCampaigns();
  }, [activeCampaign]);

  useEffect(() => {
    if (!selectedCampaignId || !selectedCampaignDetails) return;
    const shouldPoll = ['dispatching', 'active'].includes(selectedCampaignDetails.status);
    if (!shouldPoll) return;

    const interval = window.setInterval(() => {
      fetchCampaignDetails(selectedCampaignId);
    }, 3000);

    return () => window.clearInterval(interval);
  }, [selectedCampaignId, selectedCampaignDetails?.status]);

  const handleCampaignClick = (cId: string) => {
    if (selectedCampaignId === cId) {
      setSelectedCampaignId(null);
      setSelectedCampaignDetails(null);
    } else {
      setSelectedCampaignId(cId);
      if (activeCampaign && activeCampaign.id === cId) {
        setSelectedCampaignDetails({
          id: activeCampaign.id,
          name: activeCampaign.name,
          segmentName: 'Selected Segment',
          channel: activeCampaign.channel || 'email',
          status: activeCampaign.status || 'active',
          recipientCount: activeCampaign.recipientCount,
          messageContent: { body: '' },
          createdAt: new Date().toISOString(),
          stats: activeCampaign.stats,
        });
      } else {
        fetchCampaignDetails(cId);
      }
    }
  };

  const handleLaunchMockCampaign = () => {
    setPanelOpen(true, {
      campaignName: 'Flash Sale: Active VIPs',
      segmentName: 'Champions',
      audienceSize: 250,
      channel: 'whatsapp',
      messageBody: 'Hey {{first_name}}, your {{loyalty_tier}} early access starts in 1 hour. We saved picks from {{preferred_category}} for you in {{city}}. Use VIP20.',
      aiReasoning: 'Sent via WhatsApp because this cohort prefers fast mobile channels. Copy uses loyalty tier, city, and preferred category to avoid a generic blast.'
    });
  };

  return (
    <div style={{ padding: 'var(--space-6) var(--space-5)', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' }}>Campaigns</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Launch and review personalized communication dispatches.</p>
        </div>
        <button id="tour-new-campaign" className="btn btn-primary" onClick={handleLaunchMockCampaign}>
          New Campaign
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedCampaignId ? '1fr 400px' : '1fr', gap: '20px', alignItems: 'start' }}>
        {/* Campaign List */}
        <div id="tour-campaign-list" className="structured-card" style={{ border: '1px solid var(--border-default)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-default)', background: 'var(--bg-secondary)' }}>
                {['Name', 'Segment', 'Channel', 'Recipients', 'Status', 'Launched At'].map((h) => (
                  <th key={h} style={{ padding: '10px var(--space-4)', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 500, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && campaigns.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '70%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '80%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '40%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '30%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '60%' }} /></td>
                    <td style={{ padding: '12px var(--space-4)' }}><div className="skeleton skeleton-title" style={{ width: '50%' }} /></td>
                  </tr>
                ))
              ) : campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No campaigns dispatched yet. Launch one from an insight card or segment.
                  </td>
                </tr>
              ) : (
                campaigns.map((c) => {
                  const isCurrentActive = activeCampaign && activeCampaign.id === c.id;
                  const displayStatus = isCurrentActive ? 'Live' : c.status;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => handleCampaignClick(c.id)}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer',
                        background: selectedCampaignId === c.id ? 'var(--bg-elevated)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '12px var(--space-4)', fontWeight: 500, color: 'var(--text-primary)' }}>{c.name}</td>
                      <td style={{ padding: '12px var(--space-4)', color: 'var(--text-secondary)' }}>{c.segmentName}</td>
                      <td style={{ padding: '12px var(--space-4)', textTransform: 'uppercase' }}>
                        <span className="evidence-chip">{c.channel}</span>
                      </td>
                      <td style={{ padding: '12px var(--space-4)', fontFamily: 'var(--font-mono)' }}>{c.recipientCount}</td>
                      <td style={{ padding: '12px var(--space-4)', textTransform: 'capitalize' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <div className={`status-dot ${displayStatus === 'Live' || displayStatus === 'dispatching' ? 'active' : 'idle'}`} />
                          <span style={{ fontSize: 'var(--text-xs)' }}>{displayStatus}</span>
                        </div>
                      </td>
                      <td style={{ padding: '12px var(--space-4)', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                        {new Date(c.createdAt).toLocaleDateString('en-IN')} {new Date(c.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Detailed Campaign Autopsy Side Panel */}
        {selectedCampaignId && (
          <div className="structured-card" style={{ padding: 'var(--space-4)', border: '1px solid var(--border-emphasis)', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-type-label">Campaign Autopsy</span>
              <button onClick={() => setSelectedCampaignId(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            {detailsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading campaign details...</div>
            ) : selectedCampaignDetails ? (
              <>
                <div>
                  <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' }}>{selectedCampaignDetails.name}</h2>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Channel: {selectedCampaignDetails.channel.toUpperCase()} · Segment: {selectedCampaignDetails.segmentName}</div>
                </div>

                {/* Funnel Display */}
                <SignalLine campaign={selectedCampaignDetails} />

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Status</span>
                    <span style={{ color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>
                      {selectedCampaignDetails.status}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>Message Text</span>
                    <span style={{ color: 'var(--text-secondary)', maxWidth: '240px', textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {selectedCampaignDetails.messageContent.body || 'Static win-back message template'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                    <span style={{ color: 'var(--text-muted)' }}>ROI Multiplier</span>
                    <span style={{ color: 'var(--green)', fontWeight: 600 }}>
                      {selectedCampaignDetails.attribution?.roi || 'Pending attribution'}
                    </span>
                  </div>
                  {selectedCampaignDetails.attribution && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-xs)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Attributed Revenue</span>
                      <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                        ₹{selectedCampaignDetails.attribution.revenue.toLocaleString('en-IN')}
                      </span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Failed to load campaign.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
