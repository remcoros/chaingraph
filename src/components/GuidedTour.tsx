import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, List, Lightbulb } from 'lucide-react';
import { useDialogFocus } from './Dialogs';
import type { TourStep } from '../features/tour/steps';

/** A presentation-only tour. Feature adapters own step visibility and panel previews. */
export function GuidedTour({
  steps,
  activeId,
  onStepChange,
}: {
  steps: readonly TourStep[];
  activeId: string;
  onStepChange: (id: string | undefined) => void;
}) {
  const index = Math.max(
    0,
    steps.findIndex((step) => step.id === activeId),
  );
  const step = steps[index];
  const [contentsOpen, setContentsOpen] = useState(false);
  const [spotlight, setSpotlight] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    fallback: boolean;
  }>();
  const contentsButton = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    copyRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [step?.id]);
  useEffect(() => {
    if (!contentsOpen) return;
    const navigation = navigationRef.current;
    const current = navigation?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!navigation || !current) return;
    const bounds = navigation.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    if (item.top < bounds.top) navigation.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) navigation.scrollTop += item.bottom - bounds.bottom;
  }, [contentsOpen, step?.id]);
  const dialogRef = useDialogFocus(
    () => onStepChange(undefined),
    '[aria-label="Help and samples"]',
  );
  useEffect(() => {
    if (!step) return;
    let frame = 0;
    const primary = document.querySelector<HTMLElement>(step.target);
    const scrollPositions: { element: HTMLElement; top: number; left: number }[] = [];
    if (step.revealTarget && primary) {
      for (let element = primary.parentElement; element; element = element.parentElement) {
        if (
          element.scrollHeight > element.clientHeight ||
          element.scrollWidth > element.clientWidth
        )
          scrollPositions.push({ element, top: element.scrollTop, left: element.scrollLeft });
      }
    }
    const reveal = () => {
      if (step.revealTarget)
        primary?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    };
    reveal();
    const measure = () => {
      const primary = document.querySelector<HTMLElement>(step.target);
      const visible = (element: HTMLElement | null) => !!element?.getClientRects().length;
      const target = visible(primary)
        ? primary
        : step.fallbackTarget
          ? document.querySelector<HTMLElement>(step.fallbackTarget)
          : null;
      const rect = visible(target) ? target!.getBoundingClientRect() : undefined;
      setSpotlight(
        rect && rect.bottom > 0 && rect.top < innerHeight
          ? {
              left: Math.max(4, rect.left),
              top: Math.max(4, rect.top),
              width: Math.max(0, Math.min(innerWidth - 4, rect.right) - Math.max(4, rect.left)),
              height: Math.max(0, Math.min(innerHeight - 4, rect.bottom) - Math.max(4, rect.top)),
              fallback: target !== primary,
            }
          : undefined,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    for (const selector of [step.target, step.fallbackTarget]) {
      const target = selector && document.querySelector(selector);
      if (target) observer.observe(target);
    }
    schedule();
    const resize = () => {
      reveal();
      schedule();
    };
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', schedule, true);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', schedule, true);
      for (const { element, top, left } of scrollPositions) {
        if (element.isConnected) element.scrollTo({ top, left, behavior: 'instant' });
      }
    };
  }, [step]);
  if (!step) return null;
  const Icon = step.icon;
  const onLeft = spotlight && spotlight.left + spotlight.width / 2 > innerWidth * 0.6;
  const onTop =
    spotlight &&
    innerWidth < 1000 &&
    spotlight.top + spotlight.height / 2 > innerHeight * 0.58 &&
    spotlight.height < innerHeight * 0.65;
  return (
    <div
      className={`tour-backdrop ${spotlight ? 'has-spotlight' : ''} ${onLeft ? 'tour-place-left' : ''} ${onTop ? 'tour-place-top' : ''}`}
    >
      {spotlight && (
        <div
          className="tour-spotlight"
          style={{
            left: spotlight.left,
            top: spotlight.top,
            width: spotlight.width,
            height: spotlight.height,
          }}
          aria-hidden="true"
        />
      )}
      <div
        className="tour-card"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guided tour"
        aria-describedby="tour-description"
      >
        <div className="tour-heading">
          <span className="eyebrow">
            GUIDED TOUR · {index + 1} / {steps.length}
          </span>
          <button className="text-button" onClick={() => onStepChange(undefined)}>
            Skip tour
          </button>
        </div>
        <button
          ref={contentsButton}
          className="tour-contents-toggle"
          aria-label="Tour contents"
          aria-expanded={contentsOpen}
          aria-controls="tour-steps"
          onClick={() => setContentsOpen(!contentsOpen)}
        >
          <List size={16} />
          Tour contents<span>{step.label}</span>
          <ChevronDown size={14} />
        </button>
        {contentsOpen && (
          <nav ref={navigationRef} id="tour-steps" className="tour-index" aria-label="Tour steps">
            {steps.map((item, i) => (
              <button
                key={item.id}
                aria-current={item.id === step.id ? 'step' : undefined}
                onClick={() => {
                  onStepChange(item.id);
                  setContentsOpen(false);
                  contentsButton.current?.focus();
                }}
              >
                <span>{String(i + 1).padStart(2, '0')}</span>
                {item.label}
              </button>
            ))}
          </nav>
        )}
        <div ref={copyRef} className="tour-copy" aria-live="polite" aria-atomic="true">
          <h2>
            <Icon size={22} aria-hidden="true" />
            {step.title}
          </h2>
          <p id="tour-description">{step.text}</p>
          {(!spotlight || spotlight.fallback) && step.missingTargetText && (
            <p className="tour-prerequisite">{step.missingTargetText}</p>
          )}
          <div className="tour-tip">
            <Lightbulb size={16} aria-hidden="true" />
            <p>{step.tip}</p>
          </div>
        </div>
        <div className="tour-bottom">
          <span className="small muted">Jump to any topic above</span>
          <div className="button-row">
            <button
              aria-label="Back"
              disabled={index === 0}
              onClick={() => onStepChange(steps[index - 1].id)}
            >
              <ChevronLeft size={14} />
              Back
            </button>
            <button className="primary" onClick={() => onStepChange(steps[index + 1]?.id)}>
              {index === steps.length - 1 ? 'Start exploring' : 'Next'}
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
