'use client';

import { usePulseStore, type ActiveCampaign } from '@/lib/store';

type SignalLineCampaign = Pick<ActiveCampaign, 'id' | 'name' | 'recipientCount'> &
  Partial<Pick<ActiveCampaign, 'channel' | 'stats' | 'events'>> & {
    status?: string;
  };

export default function SignalLine({ campaign }: { campaign?: SignalLineCampaign }) {
  const { activeCampaign } = usePulseStore();
  const targetCampaign = campaign || activeCampaign;
  if (!targetCampaign) return null;

  const stats = targetCampaign.stats || {
    dispatched: targetCampaign.recipientCount,
    sent_to_channel: 0,
    delivered: Math.round(targetCampaign.recipientCount * 0.98),
    opened: Math.round(targetCampaign.recipientCount * 0.24),
    read: 0,
    clicked: Math.round(targetCampaign.recipientCount * 0.12),
    converted: Math.round(targetCampaign.recipientCount * 0.03),
  };

  const total = targetCampaign.recipientCount || 1;
  const sent = stats.dispatched + stats.sent_to_channel;
  const engaged = (stats.opened || 0) + (stats.read || 0);

  const stages = [
    { label: 'Sent', value: sent },
    { label: 'Delivered', value: stats.delivered },
    { label: 'Opened/Read', value: engaged },
    { label: 'Clicked', value: stats.clicked },
    { label: 'Converted', value: stats.converted },
  ];

  const width = 480;
  const height = 80;
  const padding = 20;
  const usableWidth = width - padding * 2;
  const maxVal = Math.max(sent, 1);

  const points = stages.map((s, i) => ({
    x: padding + (i / (stages.length - 1)) * usableWidth,
    y: padding + (1 - s.value / maxVal) * (height - padding * 2),
  }));

  const topPath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const bottomPath = [...points].reverse().map((p) => {
    const mirrorY = height - padding + (padding - (height - p.y));
    const clampedY = Math.min(height - 4, Math.max(height - padding, mirrorY));
    return `L ${p.x} ${clampedY}`;
  }).join(' ');
  const areaPath = `${topPath} ${bottomPath} Z`;

  // Find steepest drop
  let steepestDrop = { from: '', to: '', rate: 1 };
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].value || 1;
    const rate = stages[i].value / prev;
    if (rate < steepestDrop.rate && stages[i - 1].value > 0) {
      steepestDrop = { from: stages[i - 1].label, to: stages[i].label, rate };
    }
  }

  const events = targetCampaign.events || [];

  return (
    <div>
      <div className="signal-line-container">
        <div className="signal-line-header">
          <div className="signal-line-title">
            <div className={`dispatch-live-dot ${targetCampaign === activeCampaign ? 'active' : 'completed'}`} />
            {targetCampaign.name}
          </div>
          <span className="text-xs text-muted">{total} recipients</span>
        </div>

        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
          <path d={areaPath} fill="var(--blue)" opacity="0.08" />
          <path d={topPath} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--bg-primary)" stroke="var(--blue)" strokeWidth="2" />
          ))}
        </svg>

        <div className="signal-stages">
          {stages.map((stage, i) => {
            const rate = i > 0 && stages[i - 1].value > 0 ? Math.round((stage.value / stages[i - 1].value) * 100) : 100;
            return (
              <div key={stage.label} className="signal-stage">
                <span className="signal-stage-value">{stage.value.toLocaleString()}</span>
                <span className="signal-stage-label">{stage.label}</span>
                {i > 0 && <span className="signal-stage-rate">{rate}%</span>}
              </div>
            );
          })}
        </div>

        {steepestDrop.rate < 0.5 && steepestDrop.from && (
          <div className="signal-annotation">
            Steep drop from {steepestDrop.from} to {steepestDrop.to} ({Math.round(steepestDrop.rate * 100)}%).
            {steepestDrop.to === 'Clicked' && ' CTA may need improvement.'}
            {steepestDrop.to === 'Opened' && ' Subject line or timing may need adjustment.'}
          </div>
        )}
      </div>

      {events.length > 0 && (
        <div className="event-stream" style={{ marginTop: '8px' }}>
          {events.slice(-6).reverse().map((event) => (
            <div key={event.id} className={`event-item ${event.eventType || event.type}`}>
              <span>{event.messageId?.slice(0, 8)}</span>
              <span>{event.eventType || event.type}</span>
              <span style={{ marginLeft: 'auto' }}>
                {new Date(event.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
