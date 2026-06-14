/**
 * PULSE CRM — Global State Store (Zustand)
 * 
 * Architecture Decision: Zustand over Context API
 * 
 * Why Zustand:
 * 1. Zero boilerplate — no providers, no reducers
 * 2. Selective re-rendering — components subscribe to specific slices
 * 3. Middleware support — we use devtools for debugging
 * 4. External store — accessible outside React tree (for SSE handlers)
 * 
 * State is organized by domain:
 * - conversation: Chat thread and messages
 * - campaign: Active campaign + dispatch state  
 * - ui: Command bar, panels, notifications
 */

import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  structuredData?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

export interface SegmentResult {
  title: string;
  metrics: Record<string, string | number>;
  preview: Array<Record<string, string | number>>;
  compiledQuery: Record<string, unknown> | null;
  predicateTree: Record<string, unknown> | null;
  sourceQuery?: string;
  lastEvaluatedAt?: string;
}

export interface InsightResult {
  id: string;
  title: string;
  description: string;
  metrics: Record<string, string | number>;
  suggestedAction: string;
  aiReasoning?: string;
}


export interface CampaignStats {
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
}

export interface EventStreamItem {
  id: string;
  type: string;
  messageId?: string;
  eventType?: string;
  fromState?: string;
  toState?: string;
  timestamp: string;
  promoted?: boolean;
}

export interface ActiveCampaign {
  id: string;
  name: string;
  channel?: string;
  recipientCount: number;
  stats: CampaignStats;
  events: EventStreamItem[];
  status?: 'dispatching' | 'active' | 'completed';
}

// ─── Store ───────────────────────────────────────────────────────────────────

interface PulseStore {
  // ── Canvas State ───────────────────────────────────────────────────────
  messages: ConversationMessage[]; // Kept for backend response tracking if needed, but not primary UI
  activeSegment: SegmentResult | null;
  activeInsights: InsightResult[] | null;
  isProcessing: boolean;
  threadId: string | null;
  setActiveSegment: (segment: SegmentResult | null) => void;
  setActiveInsights: (insights: InsightResult[] | null) => void;
  addMessage: (message: ConversationMessage) => void;
  setProcessing: (processing: boolean) => void;
  clearCanvas: () => void;

  // ── Campaign State ─────────────────────────────────────────────────────
  activeCampaign: ActiveCampaign | null;
  setActiveCampaign: (campaign: ActiveCampaign | null) => void;
  updateCampaignStats: (stateOrStats: string | Partial<CampaignStats>) => void;
  addCampaignEvent: (event: EventStreamItem) => void;

  // ── UI State ───────────────────────────────────────────────────────────
  isCommandBarOpen: boolean;
  isPanelOpen: boolean;
  panelData: Record<string, unknown> | null;
  setCommandBarOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean, data?: Record<string, unknown>) => void;
  
  // ── Onboarding State ───────────────────────────────────────────────────
  hasSeenWelcome: boolean;
  setHasSeenWelcome: (seen: boolean) => void;
  hasCompletedFirstMission: boolean;
  setHasCompletedFirstMission: (completed: boolean) => void;

  // ── Product Tour State ─────────────────────────────────────────────────
  tourStatus: {
    home: boolean;
    campaigns: boolean;
    segments: boolean;
    customers: boolean;
  };
  activeTourId: string | null;
  activeTourStepIndex: number;
  startTour: (tourId: string) => void;
  nextTourStep: () => void;
  completeTour: (tourId: 'home' | 'campaigns' | 'segments' | 'customers') => void;
  dismissTour: () => void;
}

import { persist, createJSONStorage } from 'zustand/middleware';

export const usePulseStore = create<PulseStore>()(
  persist(
    (set) => ({
      // ── Canvas ─────────────────────────────────────────────────────────────
      messages: [],
      activeSegment: null,
      activeInsights: null,
      isProcessing: false,
      threadId: null,

      setActiveSegment: (segment) => set({ activeSegment: segment }),
      setActiveInsights: (insights) => set({ activeInsights: insights }),

      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message],
        })),

      setProcessing: (processing) =>
        set({ isProcessing: processing }),

      clearCanvas: () =>
        set({ messages: [], activeSegment: null, activeInsights: null, threadId: null }),

      // ── Campaign ───────────────────────────────────────────────────────────
      activeCampaign: null,

      setActiveCampaign: (campaign) =>
        set({ activeCampaign: campaign }),

      /**
       * Accepts either a state name string (from SSE events, e.g. "delivered")
       * or a partial stats object. When a string is passed, increments that counter.
       */
      updateCampaignStats: (stateOrStats) =>
        set((state) => {
          if (!state.activeCampaign) return {};
          if (typeof stateOrStats === 'string') {
            const key = stateOrStats as keyof CampaignStats;
            const currentVal = state.activeCampaign.stats[key];
            if (typeof currentVal === 'number') {
              return {
                activeCampaign: {
                  ...state.activeCampaign,
                  stats: {
                    ...state.activeCampaign.stats,
                    [key]: currentVal + 1,
                  },
                },
              };
            }
            return {};
          }
          return {
            activeCampaign: {
              ...state.activeCampaign,
              stats: { ...state.activeCampaign.stats, ...stateOrStats },
            },
          };
        }),

      addCampaignEvent: (event) =>
        set((state) => ({
          activeCampaign: state.activeCampaign
            ? {
                ...state.activeCampaign,
                events: [...state.activeCampaign.events.slice(-100), event],
              }
            : null,
        })),

      // ── UI ─────────────────────────────────────────────────────────────────
      isCommandBarOpen: false,
      isPanelOpen: false,
      panelData: null,

      setCommandBarOpen: (open) => set({ isCommandBarOpen: open }),
      setPanelOpen: (open, data) => set({ isPanelOpen: open, panelData: data || null }),

      // ── Onboarding ─────────────────────────────────────────────────────────
      hasSeenWelcome: false,
      setHasSeenWelcome: (seen) => set({ hasSeenWelcome: seen }),
      hasCompletedFirstMission: false,
      setHasCompletedFirstMission: (completed) => set({ hasCompletedFirstMission: completed }),

      // ── Product Tour ───────────────────────────────────────────────────────
      tourStatus: {
        home: false,
        campaigns: false,
        segments: false,
        customers: false,
      },
      activeTourId: null,
      activeTourStepIndex: 0,

      startTour: (tourId) => set({ activeTourId: tourId, activeTourStepIndex: 0 }),
      nextTourStep: () => set((state) => ({ activeTourStepIndex: state.activeTourStepIndex + 1 })),
      completeTour: (tourId) => set((state) => ({
        activeTourId: null,
        activeTourStepIndex: 0,
        tourStatus: { ...state.tourStatus, [tourId]: true }
      })),
      dismissTour: () => set((state) => {
        if (!state.activeTourId) return state;
        return {
          activeTourId: null,
          activeTourStepIndex: 0,
          tourStatus: { ...state.tourStatus, [state.activeTourId]: true }
        };
      }),
    }),
    {
      name: 'pulse-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        hasSeenWelcome: state.hasSeenWelcome,
        hasCompletedFirstMission: state.hasCompletedFirstMission,
        tourStatus: state.tourStatus,
      }),
    }
  )
);
