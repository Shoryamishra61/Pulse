'use client';

import { useState, useEffect } from 'react';
import { usePulseStore } from '@/lib/store';
import { handleSendMessage } from '@/lib/chat';
import StructuredCard from '@/components/Cards';

interface PreSavedSegment {
  id: string;
  title: string;
  description: string;
  queryText: string;
  metrics: {
    totalCustomers: number;
    avgSpend: string;
    totalPotentialRevenue: string;
  };
  relevance: string;
}

interface SavedSegment {
  id: string;
  name: string;
  description?: string;
  member_count: number;
  created_at: string;
  updated_at: string;
  last_evaluated_at?: string;
}

const PRE_SAVED_SEGMENTS: PreSavedSegment[] = [
  {
    id: 'dormant-vips',
    title: 'VIPs 90+ Days Dormant',
    description: 'Lifetime spend above ₹5,000, no purchases in 90+ days.',
    queryText: 'Find customers who spent over ₹5000 and haven\'t bought anything in 90 days',
    metrics: {
      totalCustomers: 847,
      avgSpend: '₹7,850',
      totalPotentialRevenue: '₹66.5L',
    },
    relevance: 'Highest ROI win-back opportunity based on historical retention.',
  },
  {
    id: 'cart-abandoners',
    title: 'Abandoned Cart (48h)',
    description: 'Customers with items in cart, browsed in last 14 days, checkout incomplete.',
    queryText: 'Find customers who abandoned their cart in the last 48 hours',
    metrics: {
      totalCustomers: 312,
      avgSpend: '₹2,340',
      totalPotentialRevenue: '₹7.3L',
    },
    relevance: 'High immediate conversion potential using WhatsApp reminder.',
  },
  {
    id: 'mumbai-regulars',
    title: 'Mumbai Regular Shoppers',
    description: 'Customers from Mumbai with more than 3 orders.',
    queryText: 'Find customers from Mumbai who have placed more than 3 orders',
    metrics: {
      totalCustomers: 145,
      avgSpend: '₹4,120',
      totalPotentialRevenue: '₹5.9L',
    },
    relevance: 'Strong cohort for localized fashion drops and physical pop-up invites.',
  },
  {
    id: 'new-shoppers',
    title: 'New Shoppers (Under 30d)',
    description: 'Shoppers who signed up in the last 30 days and have 1 order.',
    queryText: 'Find customers who joined in the last 30 days and have exactly 1 order',
    metrics: {
      totalCustomers: 218,
      avgSpend: '₹1,450',
      totalPotentialRevenue: '₹3.1L',
    },
    relevance: 'Critical for repeat conversion push via welcome onboarding emails.',
  },
  {
    id: 'high-value-churn-risk',
    title: 'High-Value Churn Risk',
    description: 'Top 10% spenders whose frequency dropped in the last 2 months.',
    queryText: 'Find high spenders whose order frequency decreased recently',
    metrics: {
      totalCustomers: 94,
      avgSpend: '₹12,400',
      totalPotentialRevenue: '₹11.6L',
    },
    relevance: 'Direct 1:1 outreach recommended. Retention is cheaper than acquisition.',
  },
  {
    id: 'holiday-shoppers',
    title: 'Holiday-Only Buyers',
    description: 'Customers who only buy during Q4 sales events.',
    queryText: 'Find customers who only purchased during november and december',
    metrics: {
      totalCustomers: 1420,
      avgSpend: '₹3,200',
      totalPotentialRevenue: '₹45.4L',
    },
    relevance: 'Perfect for early-access holiday drops.',
  },
];

export default function SegmentsPage() {
  const { activeSegment, isProcessing } = usePulseStore();
  const [nlInput, setNlInput] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [savedSegments, setSavedSegments] = useState<SavedSegment[]>([]);
  const [showSaved, setShowSaved] = useState(false);

  useEffect(() => {
    fetchSavedSegments();
  }, []);

  async function fetchSavedSegments() {
    try {
      const response = await fetch('/api/segments');
      const data = await response.json();
      if (data.success) {
        setSavedSegments(data.data.segments);
      }
    } catch (error) {
      console.error('Failed to fetch saved segments:', error);
    }
  }

  async function handleDeleteSegment(id: string, name: string) {
    if (!confirm(`Delete segment "${name}"? This cannot be undone.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/segments/${id}`, { method: 'DELETE' });
      const data = await response.json();
      
      if (data.success) {
        setSavedSegments(savedSegments.filter(s => s.id !== id));
      } else {
        alert(data.error?.message || 'Failed to delete segment');
      }
    } catch (error) {
      alert('Failed to delete segment');
      console.error(error);
    }
  }

  async function handleReevaluate(id: string) {
    try {
      const response = await fetch(`/api/segments/${id}/evaluate`, { method: 'POST' });
      const data = await response.json();
      
      if (data.success) {
        setSavedSegments(savedSegments.map(s => 
          s.id === id ? { ...s, ...data.data.segment } : s
        ));
        alert(`Re-evaluated: ${data.data.change >= 0 ? '+' : ''}${data.data.change} members`);
      } else {
        alert(data.error?.message || 'Failed to re-evaluate');
      }
    } catch (error) {
      alert('Failed to re-evaluate');
      console.error(error);
    }
  }

  const handleCompilePreset = async (preset: PreSavedSegment) => {
    setSelectedPresetId(preset.id);
    setNlInput(preset.queryText);
    await handleSendMessage(preset.queryText);
  };

  const handleCustomCompile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlInput.trim() || isProcessing) return;
    setSelectedPresetId(null);
    await handleSendMessage(nlInput.trim());
  };

  return (
    <div style={{ padding: 'var(--space-6) var(--space-5)', display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 600, color: 'var(--text-primary)' }}>Segments</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Carve out customer cohorts using dynamic relational properties or natural language.</p>
        </div>
        <button
          onClick={() => setShowSaved(!showSaved)}
          className="btn btn-secondary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span>{showSaved ? 'Hide' : 'Show'} Saved Segments</span>
          <span style={{ 
            background: 'var(--accent-blue)', 
            color: 'white', 
            borderRadius: '12px', 
            padding: '2px 8px', 
            fontSize: '11px', 
            fontWeight: 600 
          }}>
            {savedSegments.length}
          </span>
        </button>
      </div>

      {showSaved && savedSegments.length > 0 && (
        <div style={{ 
          background: 'var(--bg-secondary)', 
          border: '1px solid var(--border-default)', 
          borderRadius: 'var(--radius-lg)', 
          padding: 'var(--space-4)',
          marginBottom: '20px'
        }}>
          <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '12px' }}>Saved Segments</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {savedSegments.map(segment => (
              <div
                key={segment.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'var(--space-3)',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {segment.name}
                  </div>
                  {segment.description && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {segment.description}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    {segment.member_count.toLocaleString()} members • 
                    Updated {new Date(segment.updated_at).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => handleReevaluate(segment.id)}
                    className="btn btn-small"
                    title="Re-evaluate"
                  >
                    ↻
                  </button>
                  <button
                    onClick={() => handleDeleteSegment(segment.id, segment.name)}
                    className="btn btn-small"
                    style={{ color: 'var(--red)' }}
                    title="Delete"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '24px', alignItems: 'start' }}>
        
        {/* Left Column: Explorer / Result */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          
          {/* Segment Builder Input */}
          <div id="tour-segment-builder" className="structured-card" style={{ padding: 'var(--space-4)' }}>
            <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '8px' }}>
              Create Dynamic Segment
            </h3>
            <form onSubmit={handleCustomCompile} style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Describe your audience, e.g. 'Customers from Delhi who spent over 3000 rupees'..."
                value={nlInput}
                onChange={(e) => setNlInput(e.target.value)}
                className="input-field"
                disabled={isProcessing}
                style={{ flex: 1, minHeight: '38px' }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!nlInput.trim() || isProcessing}
                style={{ height: '38px' }}
              >
                {isProcessing ? 'Compiling...' : 'Compile'}
              </button>
            </form>
            <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '8px' }}>
              Powered by the Text-to-SQL compiler. Compiles English instructions directly into verified database schema selections.
            </div>
          </div>

          {/* Compiled Result Card */}
          {activeSegment ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Compiled Cohort Preview
              </h3>
              <StructuredCard data={{ ...activeSegment, type: 'segment_result' }} />
            </div>
          ) : (
            <div style={{
              padding: '48px',
              textAlign: 'center',
              border: '1px dashed var(--border-default)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-muted)',
              background: 'var(--bg-secondary)',
            }}>
              Compile a segment or select a preset from the sidebar to inspect matching shoppers and prepare communications.
            </div>
          )}

        </div>

        {/* Right Column: Preset Cards */}
        <div id="tour-segment-presets" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <h3 style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            High-Value Presets
          </h3>
          {PRE_SAVED_SEGMENTS.map((preset) => (
            <div
              key={preset.id}
              onClick={() => handleCompilePreset(preset)}
              style={{
                padding: 'var(--space-4)',
                background: selectedPresetId === preset.id ? 'var(--bg-elevated)' : 'var(--bg-primary)',
                border: selectedPresetId === preset.id ? '1px solid var(--border-emphasis)' : '1px solid var(--border-default)',
                borderRadius: 'var(--radius-lg)',
                cursor: 'pointer',
                transition: 'all var(--duration-fast) var(--ease-default)',
              }}
              className="preset-card"
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-primary)' }}>{preset.title}</span>
                <span style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)', color: 'var(--blue)' }}>{preset.metrics.totalCustomers}</span>
              </div>
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: '1.4', marginBottom: '8px' }}>
                {preset.description}
              </p>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
                {preset.relevance}
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}
