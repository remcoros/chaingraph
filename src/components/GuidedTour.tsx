import { useEffect } from 'react';
import { Activity, ChevronRight, FolderOpen, GitBranch, Wallet as WalletIcon } from 'lucide-react';
import { useDialogFocus } from './Dialogs';
const tourSteps = [
  {
    target: 'workspace-tabs',
    title: 'An investigation has its own space',
    text: 'Open several workspaces in the top tabs. Each has a network, password, wallets, and graph. Changes are encrypted and saved automatically in this browser.',
  },
  {
    target: 'wallet-panel',
    title: 'Bring your wallets together',
    text: 'Add account public keys in Wallets. Each wallet keeps its own receive/change discovery. You can also start from a transaction, output, or address in the search bar.',
  },
  {
    target: 'graph-stage',
    title: 'Follow the coins',
    text: 'Select nodes to inspect them. Drag empty space to orbit, scroll to zoom, and right-drag to pan. Use Flat for a 2D view. Hover for tracing actions. Filter in Entities, focus a neighborhood, and use All paths to restore the view.',
  },
  {
    target: 'analysis-panel',
    title: 'Build an interpretation',
    text: 'Choose an analysis tool and scope, inspect its evidence, and exclude findings whenever you want. Stale results need a rerun after loading new data. Labels and notes stay yours. Export an encrypted workspace before clearing browser data.',
  },
];
export function GuidedTour({
  tour,
  setTour,
}: {
  tour: number;
  setTour: (step: number | undefined) => void;
}) {
  const dialogRef = useDialogFocus(() => setTour(undefined));
  useEffect(() => {
    const element = document.querySelector(`[data-tour="${tourSteps[tour].target}"]`);
    element?.classList.add('tour-highlight');
    return () => {
      element?.classList.remove('tour-highlight');
    };
  }, [tour]);
  return (
    <div className="tour-backdrop">
      <div
        className="tour-card"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
      >
        <div className="section-title">
          <span className="eyebrow">
            QUICK TOUR · {tour + 1} / {tourSteps.length}
          </span>
          <button className="text-button" onClick={() => setTour(undefined)}>
            Skip tour
          </button>
        </div>
        <div className="tour-symbol">
          {tour === 0 ? (
            <FolderOpen />
          ) : tour === 1 ? (
            <WalletIcon />
          ) : tour === 2 ? (
            <GitBranch />
          ) : (
            <Activity />
          )}
        </div>
        <h2>{tourSteps[tour].title}</h2>
        <p>{tourSteps[tour].text}</p>
        <div className="tour-bottom">
          <div className="tour-dots">
            {tourSteps.map((_, i) => (
              <i key={i} className={i === tour ? 'active' : ''} />
            ))}
          </div>
          <div className="button-row">
            {tour > 0 && <button onClick={() => setTour(tour - 1)}>Back</button>}
            <button
              className="primary"
              onClick={() => setTour(tour === tourSteps.length - 1 ? undefined : tour + 1)}
            >
              {tour === tourSteps.length - 1 ? 'Start exploring' : 'Next'}
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
