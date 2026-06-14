'use client';

import { useEffect, useState } from 'react';
import { usePulseStore } from '@/lib/store';
import { motion, AnimatePresence } from 'framer-motion';

type Placement = 'top' | 'bottom' | 'left' | 'right';

export interface TourStep {
  targetId: string;
  title: string;
  content: string;
  placement?: Placement;
}

export const TOURS: Record<string, TourStep[]> = {
  home: [
    { targetId: 'tour-nav', title: 'Global Navigation', content: 'Switch between your active workspace, campaigns, segments, and customers.', placement: 'bottom' },
    { targetId: 'tour-chatbox', title: 'Command Center', content: 'Use natural language to ask questions or command PULSE to build segments for you.', placement: 'top' },
    { targetId: 'tour-intelligence', title: 'Intelligence Panel', content: 'Track real-time ROI, channel health, and actionable AI insights continuously.', placement: 'left' }
  ],
  campaigns: [
    { targetId: 'tour-campaign-list', title: 'Campaign Hub', content: 'Review all dispatched campaigns and monitor real-time delivery stats.', placement: 'top' },
    { targetId: 'tour-new-campaign', title: 'Quick Launch', content: 'Start a new draft instantly. Note: You can also launch these directly from AI Insights!', placement: 'bottom' }
  ],
  segments: [
    { targetId: 'tour-segment-presets', title: 'High-Value Presets', content: 'PULSE pre-computes the most profitable cohorts. Just click to compile one.', placement: 'left' },
    { targetId: 'tour-segment-builder', title: 'Dynamic Builder', content: 'Or use plain English to build highly specific audiences on the fly.', placement: 'bottom' }
  ],
  customers: [
    { targetId: 'tour-customer-list', title: 'Shopper CRM', content: 'Explore individual customer profiles, loyalty tiers, and purchase history.', placement: 'top' }
  ]
};

export default function ProductTour() {
  const { activeTourId, activeTourStepIndex, nextTourStep, completeTour, dismissTour } = usePulseStore();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentTourSteps = activeTourId ? TOURS[activeTourId] : [];
  const currentStep = currentTourSteps[activeTourStepIndex];

  // Update position continuously in case of resize or scroll
  useEffect(() => {
    if (!activeTourId || !currentStep) return;

    const updatePosition = () => {
      const el = document.getElementById(currentStep.targetId);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        // Element not found on DOM yet, might be rendering. Wait a bit.
        setTargetRect(null);
      }
    };

    updatePosition();
    
    // Polling is robust for dynamic UI transitions
    const interval = setInterval(updatePosition, 100);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      clearInterval(interval);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [activeTourId, currentStep]);

  if (!activeTourId || !currentStep) return null;

  const isLastStep = activeTourStepIndex === currentTourSteps.length - 1;

  const handleNext = () => {
    if (isLastStep) {
      completeTour(activeTourId as 'home' | 'campaigns' | 'segments' | 'customers');
    } else {
      nextTourStep();
    }
  };

  let actualPlacement = currentStep.placement || 'bottom';
  
  // Calculate popover position
  let top = 0;
  let left = 0;
  const GAP = 12;

  if (targetRect) {
    if (actualPlacement === 'top' && targetRect.top < 180) {
      actualPlacement = 'bottom';
    }

    if (actualPlacement === 'bottom') {
      top = targetRect.bottom + GAP;
      left = targetRect.left + (targetRect.width / 2);
    } else if (actualPlacement === 'top') {
      top = targetRect.top - GAP;
      left = targetRect.left + (targetRect.width / 2);
    } else if (actualPlacement === 'left') {
      top = targetRect.top + (targetRect.height / 2);
      left = targetRect.left - GAP;
    } else if (actualPlacement === 'right') {
      top = targetRect.top + (targetRect.height / 2);
      left = targetRect.right + GAP;
    }
  }

  return (
    <div className="tour-overlay-container">
      {/* Dim backdrop with spotlight cutout if targetRect exists */}
      <div 
        className="tour-backdrop" 
        onClick={dismissTour}
        style={{
          clipPath: targetRect 
            ? `polygon(
                0% 0%, 0% 100%, 
                ${targetRect.left - 4}px 100%, 
                ${targetRect.left - 4}px ${targetRect.top - 4}px, 
                ${targetRect.right + 4}px ${targetRect.top - 4}px, 
                ${targetRect.right + 4}px ${targetRect.bottom + 4}px, 
                ${targetRect.left - 4}px ${targetRect.bottom + 4}px, 
                ${targetRect.left - 4}px 100%, 
                100% 100%, 100% 0%
              )` 
            : 'none'
        }}
      />

      {/* Popover */}
      {targetRect && (
        <AnimatePresence mode="wait">
          <div
            className={`tour-popover-wrapper placement-${actualPlacement}`}
            style={{
              position: 'absolute',
              top,
              left,
              transform: actualPlacement === 'bottom' ? 'translateX(-50%)' :
                         actualPlacement === 'top' ? 'translate(-50%, -100%)' :
                         actualPlacement === 'left' ? 'translate(-100%, -50%)' :
                         'translateY(-50%)',
              pointerEvents: 'none'
            }}
          >
            <motion.div
              key={currentStep.targetId}
              className={`tour-popover placement-${actualPlacement}`}
              style={{ pointerEvents: 'auto', position: 'relative' }}
              initial={{ opacity: 0, scale: 0.9, y: actualPlacement === 'bottom' ? -10 : actualPlacement === 'top' ? 10 : 0 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.2 }}
            >
              <div className="tour-popover-header">
                <span className="tour-step-badge">{activeTourStepIndex + 1} of {currentTourSteps.length}</span>
                <button className="tour-close-btn" onClick={dismissTour}>✕</button>
              </div>
              <h3 className="tour-title">{currentStep.title}</h3>
              <p className="tour-content">{currentStep.content}</p>
              <div className="tour-footer">
                <button className="btn btn-ghost btn-sm" onClick={dismissTour}>Skip Tour</button>
                <button className="btn btn-primary btn-sm" onClick={handleNext}>
                  {isLastStep ? 'Finish' : 'Next'}
                </button>
              </div>
            </motion.div>
          </div>
        </AnimatePresence>
      )}
    </div>
  );
}
