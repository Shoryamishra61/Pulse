'use client';

import { useEffect } from 'react';
import { usePulseStore } from '@/lib/store';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useSSE } from '@/hooks/useSSE';
import CommandBar from '@/components/CommandBar';
import MissionPanel from '@/components/MissionPanel';
import IntelligencePanel from '@/components/IntelligencePanel';
import ProductTour from '@/components/ProductTour';

function NavigationHeader() {
  const pathname = usePathname();
  const { activeCampaign, setCommandBarOpen } = usePulseStore();

  return (
    <header className="status-bar" role="banner">
      <div className="status-bar-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span className="status-bar-brand-name">Pulse</span>
        {activeCampaign && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '8px' }}>
            <div className="status-dot active animate-pulse" />
            <span className="text-xs text-muted" style={{ fontSize: '10px' }}>
              Live: {activeCampaign.name} ({activeCampaign.stats.delivered} dlv)
            </span>
          </div>
        )}
      </div>

      <nav id="tour-nav" className="status-bar-nav" aria-label="Global navigation" style={{ display: 'flex', gap: '20px', margin: '0 auto' }}>
        <Link href="/" className={`nav-link ${pathname === '/' ? 'active' : ''}`}>
          Today
        </Link>
        <Link href="/campaigns" className={`nav-link ${pathname === '/campaigns' ? 'active' : ''}`}>
          Campaigns
        </Link>
        <Link href="/segments" className={`nav-link ${pathname === '/segments' ? 'active' : ''}`}>
          Segments
        </Link>
        <Link href="/customers" className={`nav-link ${pathname === '/customers' ? 'active' : ''}`}>
          Customers
        </Link>
      </nav>

      <div className="status-bar-right">
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setCommandBarOpen(true)}
          aria-label="Open command bar"
        >
          <span className="text-xs text-muted">Search</span>
          <kbd className="kbd">Ctrl K</kbd>
        </button>
      </div>
    </header>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { isCommandBarOpen, setCommandBarOpen, activeCampaign, tourStatus, startTour, activeTourId } = usePulseStore();
  const pathname = usePathname();

  useSSE(activeCampaign?.id || null);

  useEffect(() => {
    // If the user navigates away from the active tour's page, auto-dismiss it so it doesn't pop back up later
    if (activeTourId) {
      if (
        (activeTourId === 'home' && pathname !== '/') ||
        (activeTourId === 'campaigns' && pathname !== '/campaigns') ||
        (activeTourId === 'segments' && pathname !== '/segments') ||
        (activeTourId === 'customers' && pathname !== '/customers')
      ) {
        usePulseStore.getState().dismissTour();
        return;
      }
      return; // Don't try to start a new tour while one is active
    }

    const timeout = setTimeout(() => {
      if (usePulseStore.getState().activeTourId) return; // double check after timeout

      if (pathname === '/' && !tourStatus.home) {
        startTour('home');
      } else if (pathname === '/campaigns' && !tourStatus.campaigns) {
        startTour('campaigns');
      } else if (pathname === '/segments' && !tourStatus.segments) {
        startTour('segments');
      } else if (pathname === '/customers' && !tourStatus.customers) {
        startTour('customers');
      }
    }, 800); // slight delay so DOM elements are ready
    return () => clearTimeout(timeout);
  }, [pathname, tourStatus, startTour, activeTourId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && (key === 'k' || e.code === 'KeyK')) {
        e.preventDefault();
        e.stopPropagation();
        setCommandBarOpen(!usePulseStore.getState().isCommandBarOpen);
      }
      if ((key === 'escape' || e.code === 'Escape') && usePulseStore.getState().isCommandBarOpen) {
        e.preventDefault();
        e.stopPropagation();
        setCommandBarOpen(false);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [setCommandBarOpen]);

  return (
    <div className="app-container">
      <NavigationHeader />

      <div className="main-content">
        <div className="conversation-column">
          {children}
        </div>
        <IntelligencePanel />
      </div>

      <CommandBar />
      <MissionPanel />
      <ProductTour />
    </div>
  );
}
