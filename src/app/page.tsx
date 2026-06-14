'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { usePulseStore, type ConversationMessage } from '@/lib/store';
import { v4 as uuidv4 } from 'uuid';
import { handleSendMessage } from '@/lib/chat';
import SignalLine from '@/components/SignalLine';
import StructuredCard, { renderInlineMarkdown } from '@/components/Cards';

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '8px',
      marginBottom: '12px', marginTop: '28px',
    }}>
      <span style={{
        fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        {title}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)',
          background: 'var(--bg-elevated)', borderRadius: 'var(--radius-full)',
          padding: '1px 7px',
        }}>
          {count}
        </span>
      )}
      <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
    </div>
  );
}

// ─── Proactive Insight Cards (The "Today" Canvas) ────────────────────────────

function ProactiveInsights() {
  const { setPanelOpen } = usePulseStore();

  const handleLaunchCampaign = (segmentTitle: string, count: number, channel: string, context: string) => {
    setPanelOpen(true, {
      campaignName: `Win-Back: ${segmentTitle}`,
      segmentName: segmentTitle,
      audienceSize: count,
      channel: channel,
      context,
      messageSubject: `Exclusive Offer for You`,
      messageBody: `Hi {{first_name}}, we noticed you haven't shopped with us in a while. Here's a special 15% off code just for you!`,
      aiReasoning: 'Based on historical RFM analysis, this cohort responds 3.2x better to direct discounting than to new product announcements.'
    });
  };

  const handleShiftBudget = () => {
    setPanelOpen(true, {
      campaignName: 'WhatsApp Lapsed Buyer Recovery',
      segmentName: 'Lapsed VIPs',
      audienceSize: 1250,
      channel: 'whatsapp',
      messageBody: 'Hey {{first_name}}, your favorite items are back in stock. Tap to reorder instantly.',
      aiReasoning: 'WhatsApp generates a 34% open rate vs 10% for email for lapsed cohorts. Shifting budget will increase expected ROI by 2.1x.'
    });
  };

  return (
    <div>
      <div suppressHydrationWarning style={{
        fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)',
        marginBottom: '4px',
      }}>
        Good {getTimeOfDay()}.
      </div>
      <div style={{
        fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
        marginBottom: '20px',
      }}>
        Today Brief: computed from seeded shopper behavior and channel outcome models.
      </div>

      <div className="insight-cards" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        
        {/* Spatial Block 1 */}
        <div className="insight-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="insight-card-title">VIP Reactivation</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Who</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>847 VIPs slipping into dormancy (&gt;90 days)</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>What</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>15% Win-back discount via Email</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>When</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Today, staggered over 2 hours</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Expected ROI</div>
              <div style={{ fontSize: '13px', color: 'var(--green)', fontWeight: 600 }}>4.2x (High Conv)</div>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={() => handleLaunchCampaign('VIPs 90+ Days Dormant', 847, 'email', 'Reactivation')}>
            Review & Launch
          </button>
        </div>

        {/* Spatial Block 2 */}
        <div className="insight-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="insight-card-title">Channel Shift: Lapsed VIPs</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Who</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>1,250 Lapsed Buyers</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>What</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Shift to WhatsApp (Urgent Drop)</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>When</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Immediately</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Expected ROI</div>
              <div style={{ fontSize: '13px', color: 'var(--green)', fontWeight: 600 }}>2.1x Lift vs Email</div>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={handleShiftBudget}>
            Execute Shift
          </button>
        </div>

        {/* Spatial Block 3 */}
        <div className="insight-card" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="insight-card-title">Cart Recovery</div>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Who</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>312 carts (48h abandonment)</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>What</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>SMS low-friction reminder</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>When</div>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>Within next hour</div>
            </div>
            <div style={{ background: 'var(--bg-secondary)', padding: '12px', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: '4px', fontWeight: 600 }}>Expected ROI</div>
              <div style={{ fontSize: '13px', color: 'var(--green)', fontWeight: 600 }}>8.5x (Immediate)</div>
            </div>
          </div>
          
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 'auto' }} onClick={() => handleLaunchCampaign('Abandoned Cart (48h)', 312, 'sms', 'Recovery')}>
            Start Recovery
          </button>
        </div>

      </div>
    </div>
  );
}

function getTimeOfDay(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// ─── Onboarding Welcome Card ──────────────────────────────────────────────────

function WelcomeCard() {
  const { setHasSeenWelcome } = usePulseStore();
  
  useEffect(() => {
    const handleGlobalClick = () => setHasSeenWelcome(true);
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [setHasSeenWelcome]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '48px 24px', background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: '0 4px 24px rgba(0, 0, 0, 0.04)',
      textAlign: 'center', maxWidth: '480px', margin: '48px auto 0'
    }}>
      <div style={{
        width: '56px', height: '56px', borderRadius: '16px', background: 'var(--text-primary)',
        color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '24px', boxShadow: '0 8px 16px rgba(0, 112, 243, 0.2)'
      }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        </svg>
      </div>
      <h2 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
        Welcome to PULSE
      </h2>
      <p style={{ fontSize: '15px', color: 'var(--text-secondary)', lineHeight: '1.6', marginBottom: '32px', maxWidth: '400px' }}>
        Discover high ROI campaign opportunities instantly. Type a command to get started.
      </p>
      <button 
        className="btn btn-primary" 
        style={{ padding: '12px 24px', fontSize: '14px', fontWeight: 600, width: '100%', maxWidth: '300px' }}
        onClick={() => setHasSeenWelcome(true)}
      >
        Show me my opportunities
      </button>
    </div>
  );
}

// ─── Query Result Block ──────────────────────────────────────────────────────

function QueryResultBlock({ message }: { message: ConversationMessage }) {
  const isAgent = message.role === 'agent';
  const time = new Date(message.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

  if (!isAgent) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '10px 0 4px',
      }}>
        <div style={{
          maxWidth: 'min(620px, 86%)',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-elevated)',
          borderRadius: 'var(--radius-lg)',
          padding: '10px 12px',
          boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
        }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              You
            </span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {time}
            </span>
          </div>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-primary)', fontWeight: 500 }}>
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: '10px 0 18px',
      margin: '0 0 2px',
      borderLeft: '2px solid var(--border-emphasis)',
      paddingLeft: '14px',
    }}>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Pulse
        </span>
        <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
          {time}
        </span>
      </div>

      <div style={{
        fontSize: 'var(--text-sm)',
        color: 'var(--text-secondary)',
        lineHeight: 'var(--leading-relaxed)',
        marginBottom: message.structuredData ? '14px' : '0',
      }}>
        {(message.content || '').split('\n').map((line, i) => {
          if (line.trim() === '') return <div key={i} style={{ height: '8px' }} />;
          return <p key={i} style={{ marginBottom: '4px' }}>{renderInlineMarkdown(line)}</p>;
        })}
      </div>

      {message.structuredData && (
        <div style={{ marginTop: '10px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '8px',
          }}>
            <span style={{
              fontSize: '10px',
              color: 'var(--text-muted)',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              Output
            </span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-subtle)' }} />
          </div>
          <StructuredCard data={message.structuredData} />
        </div>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={{ padding: '12px 0' }}>
      <div className="typing-indicator">
        <div className="typing-dot" />
        <div className="typing-dot" />
        <div className="typing-dot" />
      </div>
    </div>
  );
}

// ─── Input Bar ───────────────────────────────────────────────────────────────

function InputBar() {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isProcessing, addMessage, setHasSeenWelcome } = usePulseStore();

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const message = input.trim();
    if (!message || isProcessing) return;
    setInput('');
    setHasSeenWelcome(true);
    addMessage({ id: uuidv4(), role: 'user', content: message, timestamp: new Date().toISOString() });
    await handleSendMessage(message);
  }, [input, isProcessing, addMessage, setHasSeenWelcome]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
    }
  }, [input]);

  return (
    <div id="tour-chatbox" className="input-bar-container">
      <form onSubmit={handleSubmit} className="input-bar">
        <textarea ref={textareaRef} className="input-field" placeholder="Ask anything, e.g., 'Find customers from Mumbai' or press ⌘K" value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
          rows={1} disabled={isProcessing} aria-label="Message input" />
        <button type="submit" className="send-button" disabled={!input.trim() || isProcessing} aria-label="Send message">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </form>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function PulsePage() {
  const { messages, isProcessing, activeCampaign, activeSegment, activeInsights, hasSeenWelcome } = usePulseStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isProcessing, activeSegment, activeInsights]);

  return (
    <>
      <div className="conversation-container" ref={scrollRef}>
        <div className="conversation-thread">
          {/* Top Banner: Live Campaign Pulse Strip */}
          {activeCampaign && (
            <div style={{ marginBottom: '24px', padding: '16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-default)' }}>
              <SignalLine />
            </div>
          )}

          {/* Dynamic View: Welcome, Segment, Insights, or Proactive (Default) */}
          {!hasSeenWelcome ? (
            <WelcomeCard />
          ) : activeSegment ? (
            <>
              <SectionHeader title="Active Segment" />
              <StructuredCard data={{ ...activeSegment, type: 'segment_result' }} />
            </>
          ) : activeInsights ? (
            <>
              <SectionHeader title="Deep Insights" />
              <StructuredCard data={{ insights: activeInsights, type: 'insights' }} />
            </>
          ) : (
            <ProactiveInsights />
          )}
          
          {isProcessing && <TypingIndicator />}

          {messages.length > 0 && hasSeenWelcome && (
            <>
              <SectionHeader title="Decision Trail" count={messages.length} />
              <div>
                {messages.map((message, index) => (
                  <QueryResultBlock key={message.id || index} message={message} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {<InputBar />}
    </>
  );
}
