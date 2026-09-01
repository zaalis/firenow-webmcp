'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, X } from 'lucide-react';

export type TourStep = {
  id: string;
  /** Selector of the element to light up. */
  target: string;
  title: string;
  body: string;
  /** Prepares the screen before measuring: unfolds a collapsed panel, say. */
  before?: () => void;
};

/**
 * Set when an operator creates an account, read once by the console.
 * The tour belongs to a first account, not to a first visit: a returning
 * operator on a new machine should not be walked through the console again.
 */
export const TOUR_PENDING_KEY = 'firenow.tour.pending';

const GAP = 16;
const PAD = 10;
const NARROW = 700;

/**
 * Spotlight tutorial.
 *
 * A veil darkens the whole interface; only the step's element keeps its own
 * colour, cut out by the spotlight's box-shadow. A separate catcher swallows
 * clicks, so the console cannot move under the operator mid-explanation. The
 * position is re-read every frame, which keeps the light glued to a panel that
 * is still unfolding.
 */
export default function Tour({ steps, onFinish }: { steps: TourStep[]; onFinish: (completed: boolean) => void }) {
  const [index, setIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const holeRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback((completed: boolean) => { onFinish(completed); }, [onFinish]);
  // `close` raises a setState to the parent, so it must not fire from an
  // updater function, which React runs during render.
  const next = useCallback(() => {
    if (index >= steps.length - 1) { close(true); return; }
    setIndex(index + 1);
  }, [close, index, steps.length]);
  const previous = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  // Measurement lives outside React: writing positions frame by frame follows
  // opening panels without a render per frame. The "measured" state is a class
  // on the node rather than a state, so it triggers nothing.
  useEffect(() => {
    if (!step) return;
    // The screen may need preparing first: unfold a collapsed panel.
    step.before?.();
    rootRef.current?.classList.remove('tour-ready');
    let frame = 0;
    const place = () => {
      frame = requestAnimationFrame(place);
      const hole = holeRef.current;
      const card = cardRef.current;
      if (!hole || !card) return;
      const target = document.querySelector(step.target);
      const box = target?.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (!box || box.width === 0 || box.height === 0) {
        // Target missing or collapsed: light the centre rather than nothing.
        hole.style.opacity = '0';
        card.style.left = Math.round((viewportWidth - card.offsetWidth) / 2) + 'px';
        card.style.top = Math.round((viewportHeight - card.offsetHeight) / 2) + 'px';
        rootRef.current?.classList.add('tour-ready');
        return;
      }

      const left = Math.max(4, box.left - PAD);
      const top = Math.max(4, box.top - PAD);
      const width = Math.min(viewportWidth - left - 4, box.width + PAD * 2);
      let height = Math.min(viewportHeight - top - 4, box.height + PAD * 2);
      const cardHeight = card.offsetHeight;
      const cardWidth = card.offsetWidth;

      if (viewportWidth <= NARROW) {
        // On a narrow screen nothing fits beside a full-height panel: the card
        // docks to the bottom and the light stops above it, rather than being
        // covered by its own explanation.
        const cardTop = Math.max(8, viewportHeight - cardHeight - 12);
        card.style.left = Math.round(Math.max(8, (viewportWidth - cardWidth) / 2)) + 'px';
        card.style.top = Math.round(cardTop) + 'px';
        height = Math.max(44, Math.min(height, cardTop - GAP - top));
      } else {
        const below = top + height + GAP;
        const above = top - GAP - cardHeight;
        let cardTop = below + cardHeight <= viewportHeight - 8 ? below
          : above >= 8 ? above
          : Math.max(8, Math.min(viewportHeight - cardHeight - 8, top));
        let cardLeft = left + width / 2 - cardWidth / 2;
        // If the card still overlaps the light, move it to the free side.
        if (cardTop < top + height && cardTop + cardHeight > top) {
          cardLeft = left + width + GAP + cardWidth <= viewportWidth - 8
            ? left + width + GAP
            : left - GAP - cardWidth;
          cardTop = Math.max(8, Math.min(viewportHeight - cardHeight - 8, top));
        }
        card.style.left = Math.round(Math.max(8, Math.min(viewportWidth - cardWidth - 8, cardLeft))) + 'px';
        card.style.top = Math.round(Math.max(8, cardTop)) + 'px';
      }

      hole.style.opacity = '1';
      hole.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      hole.style.width = Math.round(width) + 'px';
      hole.style.height = Math.round(height) + 'px';
      rootRef.current?.classList.add('tour-ready');
    };
    frame = requestAnimationFrame(place);
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Focus follows the step, so a screen reader announces the new content.
  useEffect(() => { cardRef.current?.focus(); }, [index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(false); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); next(); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); previous(); return; }
      if (event.key !== 'Tab') return;
      const focusables = cardRef.current?.querySelectorAll<HTMLElement>('button');
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const item = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); item.focus(); }
      else if (!event.shiftKey && document.activeElement === item) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [close, next, previous]);

  if (!step) return null;

  return (
    <div className="tour" ref={rootRef}>
      <div className="tour-catcher" role="presentation" onMouseDown={(event) => event.preventDefault()} />
      <div ref={holeRef} className="tour-hole" aria-hidden="true" />
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
      >
        <p className="tour-count">Step {index + 1} of {steps.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-dots" aria-hidden="true">
          {steps.map((item, position) => <i key={item.id} className={position === index ? 'on' : position < index ? 'done' : ''} />)}
        </div>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={() => close(false)}>
            <X size={13} aria-hidden="true" />Skip
          </button>
          <button type="button" className="tour-back" onClick={previous} disabled={index === 0}>
            <ArrowLeft size={14} aria-hidden="true" />Back
          </button>
          <button type="button" className="tour-next" onClick={next}>
            {last ? <>Start<Check size={14} aria-hidden="true" /></> : <>Next<ArrowRight size={14} aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
