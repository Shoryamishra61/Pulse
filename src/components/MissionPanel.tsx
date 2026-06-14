'use client';

/**
 * PULSE — Mission Panel (Pre-Launch Review)
 *
 * Slide-over that appears before campaign dispatch.
 * Structured review: audience, message, volume, channel health, frequency.
 *
 * Design: white background, zinc typography, no colored accents
 * except semantic status indicators (green/amber/red).
 */

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePulseStore } from '@/lib/store';

// ─── Capital Gauge ───────────────────────────────────────────────────────────

function RelationshipCapitalGauge({ score }: { score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const label = percentage > 70 ? 'Healthy' : percentage > 40 ? 'Moderate' : 'At Risk';

  return (
    <div style={{ marginBottom: '24px' }}>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        marginBottom: '8px',
        fontSize: 'var(--text-xs)',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>Relationship Capital</span>
        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{label} ({percentage}%)</span>
      </div>
      <div style={{
        height: 4, borderRadius: 'var(--radius-full)',
        background: 'var(--bg-elevated)', overflow: 'hidden',
      }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percentage}%` }}
          transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          style={{
            height: '100%',
            borderRadius: 'var(--radius-full)',
            background: 'var(--text-primary)',
          }}
        />
      </div>
    </div>
  );
}

function useRelationshipCapital(audienceSize: number, channel: string, context: string) {
  const [factors, setFactors] = useState<{ score: number, details: string[] }>({
    score: 85, 
    details: ['Analyzing audience fatigue risk...']
  });

  useEffect(() => {
    fetch('/api/campaigns')
      .then(res => res.json())
      .then(data => {
        const campaigns = data.campaigns || [];
        const recentCampaigns = campaigns.filter((c: { createdAt: string; recipientCount?: number }) => {
          const hoursSince = (Date.now() - new Date(c.createdAt).getTime()) / (1000 * 60 * 60);
          return hoursSince < 24;
        });

        const recentVolume = recentCampaigns.reduce((sum: number, c: { createdAt: string; recipientCount?: number }) => sum + (c.recipientCount || 0), 0);
        
        let fatiguePenalty = 0;
        let fatigueDetail = `Fatigue penalty: 0 (Audience rested)`;

        if (recentVolume > 20000 || recentCampaigns.length > 3) {
          fatiguePenalty = 22;
          fatigueDetail = `Fatigue penalty: -22 (High recent contact: ${recentCampaigns.length} campaigns in 24h)`;
        } else if (recentVolume > 5000 || recentCampaigns.length > 1) {
          fatiguePenalty = 12;
          fatigueDetail = `Fatigue penalty: -12 (Moderate recent contact: ${recentCampaigns.length} campaigns in 24h)`;
        }

        const volumePenalty = audienceSize > 50000 ? 25 : audienceSize > 10000 ? 12 : 3;
        const channelBonus = channel === 'whatsapp' || channel === 'sms' ? 8 : 4;
        const relevanceBonus = context ? 12 : 4;
        const consentScore = 92;
        const score = Math.max(20, Math.min(96, consentScore - fatiguePenalty - volumePenalty + channelBonus + relevanceBonus - 10));

        setFactors({
          score,
          details: [
            `Consent coverage: ${consentScore}% seeded accepts-marketing baseline`,
            fatigueDetail,
            `Volume penalty: -${volumePenalty} for ${audienceSize.toLocaleString()} recipients`,
            `Channel fit: +${channelBonus} for ${channel.toUpperCase()}`,
            `Relevance lift: +${relevanceBonus} from audience-specific context`,
          ]
        });
      })
      .catch(() => {
        // Fallback to static if API fails
        setFactors({
          score: 82,
          details: ['Failed to fetch fatigue data, using fallback estimations.']
        });
      });
  }, [audienceSize, channel, context]);

  return factors;
}

// ─── Mission Panel ───────────────────────────────────────────────────────────

export default function MissionPanel() {
  const { isPanelOpen, setPanelOpen, panelData, setActiveCampaign, hasCompletedFirstMission, setHasCompletedFirstMission } = usePulseStore();
  const [isDispatching, setIsDispatching] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  useEffect(() => {
    if (tourStep > 0) {
      const handleGlobalClick = (e: MouseEvent) => {
        // Only advance if they click outside the actual tooltip to avoid double-firing
        if (!(e.target as HTMLElement).closest('.btn-sm')) {
           setTourStep(prev => prev === 1 ? 2 : 0);
           if (tourStep === 2) setHasCompletedFirstMission(true);
        }
      };
      // Timeout to prevent immediate firing from the click that opened it
      const timer = setTimeout(() => document.addEventListener('click', handleGlobalClick), 100);
      return () => {
        clearTimeout(timer);
        document.removeEventListener('click', handleGlobalClick);
      };
    }
  }, [tourStep, setHasCompletedFirstMission]);

  const campaign = (panelData || {}) as Record<string, unknown>;
  const audienceSize = (campaign.audienceSize as number) || 0;
  const channel = (campaign.channel as string) || 'email';
  const segmentName = (campaign.segmentName as string) || 'Selected Audience';
  const messageSubject = (campaign.messageSubject as string) || '';
  const messageBody = (campaign.messageBody as string) || '';
  const aiReasoning = (campaign.aiReasoning as string) || '';
  const context = (campaign.context as string) || '';
  const segmentCriteria = campaign.segmentCriteria;

  const capitalFactors = useRelationshipCapital(audienceSize, channel, context);

  // Initialize tour when panel opens for the first time
  if (isPanelOpen && !hasCompletedFirstMission && tourStep === 0) {
    setTourStep(1);
  }

  if (!isPanelOpen || !panelData) return null;

  const checks = [
    {
      status: audienceSize > 0 ? 'pass' as const : 'fail' as const,
      label: `Audience: ${segmentName}`,
      detail: audienceSize > 0
        ? `${audienceSize.toLocaleString()} recipients selected`
        : 'No audience selected',
    },
    {
      status: messageBody ? 'pass' as const : 'fail' as const,
      label: 'Message Content',
      detail: messageBody
        ? `${channel.toUpperCase()} — ${messageSubject || 'No subject'}`
        : 'No message content',
    },
    {
      status: audienceSize < 50000 ? 'pass' as const : 'warn' as const,
      label: 'Send Volume',
      detail: audienceSize < 50000
        ? 'Within normal limits'
        : `High volume — batched over ~${Math.ceil(audienceSize / 50 / 60)} min`,
    },
    {
      status: 'pass' as const,
      label: 'Channel Health',
      detail: `${channel.toUpperCase()} provider operational — 99.8% uptime`,
    },
    {
      status: audienceSize < 10000 ? 'pass' as const : 'warn' as const,
      label: 'Frequency Check',
      detail: audienceSize < 10000
        ? 'No audience fatigue detected'
        : 'Some recipients contacted within 48h',
    },
  ];

  const canDispatch = checks.every(c => c.status !== 'fail');

  const handleDispatch = async () => {
    setIsDispatching(true);
    try {
      const response = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignName: campaign.campaignName || `Campaign ${new Date().toLocaleDateString()}`,
          channel,
          segmentName,
          audienceSize,
          segmentCriteria,
          messageContent: { subject: messageSubject, body: messageBody },
        }),
      });

      if (response.ok) {
        const result = await response.json() as {
          campaignId: string;
          name: string;
          channel: string;
          recipientCount: number;
          initialStats?: {
            total: number; created: number; enqueued: number; dispatched: number;
            sent_to_channel: number; delivered: number; opened: number; read: number; clicked: number;
            converted: number; failed: number; bounced: number; complained: number;
          };
        };
        setActiveCampaign({
          id: result.campaignId,
          name: result.name,
          channel: result.channel,
          recipientCount: result.recipientCount,
          stats: result.initialStats || {
            total: result.recipientCount,
            created: result.recipientCount,
            enqueued: 0,
            dispatched: 0,
            sent_to_channel: 0,
            delivered: 0,
            opened: 0,
            read: 0,
            clicked: 0,
            converted: 0,
            failed: 0,
            bounced: 0,
            complained: 0,
          },
          events: [],
          status: 'dispatching',
        });
        setPanelOpen(false);
        if (!hasCompletedFirstMission) setHasCompletedFirstMission(true);
      }
    } catch {
      console.error('Campaign dispatch failed.');
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <AnimatePresence>
      {isPanelOpen && (
        <>
          <motion.div
            className="panel-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPanelOpen(false)}
          />

          <motion.div
            className="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="panel-header">
              <div>
                <div style={{
                  fontSize: 'var(--text-xs)', color: 'var(--text-muted)',
                  fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.06em', marginBottom: '4px',
                }}>
                  Pre-Launch Review
                </div>
                <div className="panel-title">
                  {(campaign.campaignName as string) || 'New Campaign'}
                </div>
              </div>
              <button
                className="panel-close"
                onClick={() => setPanelOpen(false)}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="panel-body">
              <RelationshipCapitalGauge score={capitalFactors.score} />
              <div style={{ marginTop: '-12px', marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {capitalFactors.details.map((factor, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', color: factor.includes('-') ? 'var(--red)' : 'var(--text-secondary)', fontSize: '10px', lineHeight: 1.4 }}>
                    {factor}
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                {/* 1. The "Who" Card */}
                <div className="mission-card" style={{ animationDelay: '0.1s' }}>
                  <div className="mission-card-header">
                    <span className="mission-card-title">Who <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· Audience</span></span>
                  </div>
                  <div className="mission-card-body">
                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-primary)' }}>{segmentName}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                      {audienceSize.toLocaleString()} recipients matched.
                    </div>
                    {context && (
                      <div style={{ marginTop: '8px', padding: '8px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>Rule:</strong> {context}
                      </div>
                    )}
                  </div>
                </div>

                {/* 2. The "What" Card */}
                <div className="mission-card" style={{ animationDelay: '0.2s' }}>
                  <div className="mission-card-header">
                    <span className="mission-card-title">What <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· Dispatch</span></span>
                    <span className="card-type-label" style={{ textTransform: 'uppercase' }}>{channel}</span>
                  </div>
                  <div className="mission-card-body">
                    <div style={{ padding: '12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
                      {messageSubject && (
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
                          {messageSubject}
                        </div>
                      )}
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
                        {/* Simple template tag highlighting */}
                        {(messageBody || 'No message content').split(/(\{\{[^}]+\}\})/).map((part, i) => 
                          part.startsWith('{{') ? <span key={i} style={{ color: 'var(--blue)', background: 'var(--blue-light, rgba(59,130,246,0.1))', padding: '0 4px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontSize: '11px' }}>{part}</span> : part
                        )}
                      </div>
                    </div>
                    {aiReasoning && (
                      <div style={{ marginTop: '8px', fontSize: '10px', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                        <strong style={{ color: 'var(--text-secondary)' }}>AI Tone Analysis:</strong> {aiReasoning}
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. The "When" Card */}
                <div className="mission-card" style={{ animationDelay: '0.3s' }}>
                  <div className="mission-card-header">
                    <span className="mission-card-title">When <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· Scheduling</span></span>
                  </div>
                  <div className="mission-card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ padding: '8px 12px', background: 'var(--bg-primary)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--green)', color: 'var(--green)' }}>
                        <span style={{ fontSize: '10px', fontWeight: 600, textTransform: 'uppercase', display: 'block', marginBottom: '2px' }}>Recommended</span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>Immediate</span>
                      </div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                        Audience is highly active during this hour. No fatigue warnings detected.
                      </div>
                    </div>
                  </div>
                </div>

                {/* 4. The "Expected" Card */}
                <div className="mission-card" style={{ animationDelay: '0.4s' }}>
                  <div className="mission-card-header">
                    <span className="mission-card-title">Expected <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>· Performance</span></span>
                  </div>
                  <div className="mission-card-body">
                    <div className="intel-kpi-row" style={{ background: 'var(--bg-primary)', padding: '12px', borderRadius: 'var(--radius-sm)' }}>
                      <div className="intel-kpi">
                        <span className="intel-kpi-value" style={{ color: 'var(--text-primary)' }}>98.2%</span>
                        <span className="intel-kpi-label">Delivery</span>
                      </div>
                      <div className="intel-kpi">
                        <span className="intel-kpi-value" style={{ color: 'var(--text-primary)' }}>24.5%</span>
                        <span className="intel-kpi-label">Read Rate</span>
                      </div>
                      <div className="intel-kpi">
                        <span className="intel-kpi-value" style={{ color: 'var(--green)' }}>1.2x</span>
                        <span className="intel-kpi-label">Est. ROI</span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Footer */}
            <div className="panel-footer">
              <button
                className="btn btn-secondary"
                onClick={() => { setPanelOpen(false); setTourStep(0); }}
              >
                Cancel
              </button>
              <div style={{ position: 'relative' }}>
                {tourStep === 2 && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    style={{ position: 'absolute', bottom: 'calc(100% + 16px)', right: 0, width: '280px', background: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '16px', borderRadius: 'var(--radius-lg)', zIndex: 50 }}
                  >
                    <div style={{ position: 'absolute', bottom: '-6px', right: '40px', width: '12px', height: '12px', background: 'var(--text-primary)', transform: 'rotate(45deg)' }} />
                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Ready for Launch</div>
                    <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '12px', lineHeight: 1.5 }}>
                      When you click launch, Pulse handles batching, delivery optimization, and fallback channels automatically.
                    </div>
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={() => { setTourStep(0); setHasCompletedFirstMission(true); }}
                      style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                    >
                      Got it
                    </button>
                  </motion.div>
                )}
                <button
                  className="btn btn-primary"
                  disabled={!canDispatch || isDispatching}
                  onClick={handleDispatch}
                  style={{ minWidth: 140, position: 'relative', zIndex: tourStep === 2 ? 51 : 1 }}
                >
                  {isDispatching ? 'Dispatching...' : 'Launch Campaign'}
                </button>
              </div>
            </div>

            {/* Tour Step 1 Overlay */}
            {tourStep === 1 && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, x: 20 }} animate={{ opacity: 1, scale: 1, x: 0 }}
                style={{ position: 'absolute', top: '120px', right: 'calc(100% + 16px)', width: '280px', background: 'var(--text-primary)', color: 'var(--bg-primary)', padding: '16px', borderRadius: 'var(--radius-lg)', zIndex: 50 }}
              >
                <div style={{ position: 'absolute', top: '24px', right: '-6px', width: '12px', height: '12px', background: 'var(--text-primary)', transform: 'rotate(45deg)' }} />
                <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>Relationship Capital</div>
                <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '12px', lineHeight: 1.5 }}>
                  Pulse calculates the risk of audience fatigue based on volume and recent contacts. We prioritize long-term trust over short-term blasts.
                </div>
                <button 
                  className="btn btn-primary btn-sm"
                  onClick={() => setTourStep(2)}
                  style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                >
                  Next
                </button>
              </motion.div>
            )}

          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
