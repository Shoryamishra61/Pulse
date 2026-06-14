'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePulseStore } from '@/lib/store';
import { v4 as uuidv4 } from 'uuid';
import { handleSendMessage } from '@/lib/chat';

export default function CommandBar() {
  const { isCommandBarOpen, setCommandBarOpen } = usePulseStore();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (isCommandBarOpen && inputRef.current) inputRef.current.focus();
  }, [isCommandBarOpen]);

  const commands = [
    { label: 'Find high-value customers', hint: 'segment' },
    { label: 'Show campaign analytics', hint: 'analytics' },
    { label: 'Get customer insights', hint: 'insights' },
    { label: 'Create email campaign', hint: 'campaign' },
    { label: 'Find at-risk customers', hint: 'segment' },
    { label: 'Cart abandonment recovery', hint: 'segment' },
    { label: 'Customers who spent over ₹5000', hint: 'segment' },
    { label: 'Dormant customers from Mumbai', hint: 'segment' },
  ].filter(cmd => !query || cmd.label.toLowerCase().includes(query.toLowerCase()));

  const runCommand = (message: string) => {
    const trimmed = message.trim();
    if (!trimmed) return;

    setCommandBarOpen(false);
    setQuery('');
    router.push('/');

    const store = usePulseStore.getState();
    store.setHasSeenWelcome(true);
    store.addMessage({
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    });
    handleSendMessage(trimmed);
  };

  if (!isCommandBarOpen) return null;

  return (
    <div className="command-bar-overlay" onClick={(e) => { if (e.target === e.currentTarget) setCommandBarOpen(false); }} role="dialog" aria-label="Command bar">
      <div className="command-bar">
        <input ref={inputRef} className="command-bar-input" placeholder="Search or ask anything..." value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setCommandBarOpen(false);
            if (e.key === 'Enter' && query.trim()) {
              runCommand(query);
            }
          }}
        />
        <div className="command-bar-divider" />
        <div className="command-bar-results">
          {commands.map((cmd, i) => (
            <div key={i} className={`command-bar-item ${i === 0 ? 'selected' : ''}`}
              onClick={() => {
                runCommand(cmd.label);
              }}>
              <span className="command-bar-item-text">{cmd.label}</span>
              <span className="command-bar-item-hint">{cmd.hint}</span>
            </div>
          ))}
        </div>
        <div className="command-bar-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Select</span>
          <span>esc Close</span>
        </div>
      </div>
    </div>
  );
}
