import { useEffect, useState } from 'react';
import { WORKBENCH_TOUR, availableTourSteps } from './steps';
import type { TourStep } from './steps';
import { useWalletTourExample } from './useWalletTourExample';
import type { WalletTourExample } from './useWalletTourExample';

const SEEN_KEY = 'chaingraph.tour.seen';

/** What the workspace offers the tour, which decides the topics worth showing. */
export interface TourSubject {
  workspaceId: string | undefined;
  hasWallets: boolean;
  hasSelection: boolean;
  hasTransactions: boolean;
}

export interface Tour {
  /** The step being previewed, or undefined when no tour is running. */
  step: TourStep | undefined;
  steps: readonly TourStep[];
  activeId: string | undefined;
  /** The workspace has no wallet of its own, so wallet topics preview an example. */
  needsExample: boolean;
  example: WalletTourExample;
  /** Open the tour at its first topic. */
  start: () => void;
  show: (id: string | undefined) => void;
}

/**
 * The guided tour over a workspace. Every value here is presentation: a step
 * previews a view without touching saved workspace state, so callers gate
 * anything that edits or persists on `step` being undefined.
 */
export function useTour(subject: TourSubject): Tour {
  const { workspaceId, hasWallets, hasSelection, hasTransactions } = subject;
  const [activeId, setActiveId] = useState<string>();
  const steps = availableTourSteps(WORKBENCH_TOUR, {
    hasSelection,
    hasTransactions,
    features: [],
  });
  const step =
    activeId === undefined ? undefined : (steps.find((item) => item.id === activeId) ?? steps[0]);
  const needsExample = !!workspaceId && !hasWallets && !!step?.requiresWallet;
  const example = useWalletTourExample(workspaceId, needsExample);

  // Offer the tour once, the first time this browser shows a workspace. Reading
  // and marking the visit is what makes an effect right here; the tour state it
  // opens is a consequence of that external record, not derived from props.
  useEffect(() => {
    if (!workspaceId) return;
    try {
      if (!localStorage.getItem(SEEN_KEY)) {
        setActiveId(WORKBENCH_TOUR[0].id);
        localStorage.setItem(SEEN_KEY, '1');
      }
    } catch {
      // A denied/full store must not crash an unlocked workspace or block export.
      setActiveId(WORKBENCH_TOUR[0].id);
    }
  }, [workspaceId]);

  return {
    step,
    steps,
    activeId,
    needsExample,
    example,
    start: () => setActiveId(WORKBENCH_TOUR[0].id),
    show: setActiveId,
  };
}
