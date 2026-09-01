'use client';

import { useEffect } from 'react';

const COUNT_MS = 1100;
/** Decelerating: the number arrives rather than stopping dead. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Motion controller for the presentation page.
 *
 * It renders nothing. One client island drives the whole page instead of
 * wrapping every animated element in its own component, and it is opt-in: the
 * page ships fully visible, and this adds `data-motion="on"` only once it has
 * decided motion is wanted. A JavaScript failure therefore costs the animation,
 * never the content — and a reader who asked for reduced motion is left with
 * the static page they asked for.
 */
export default function LandingMotion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.landing-shell');
    if (!root) return;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const observers: IntersectionObserver[] = [];
    const frames: number[] = [];

    const stop = () => {
      observers.splice(0).forEach((observer) => observer.disconnect());
      frames.splice(0).forEach((frame) => cancelAnimationFrame(frame));
    };

    /** Counts a hero figure up from zero once it is on screen. */
    const countUp = (node: HTMLElement) => {
      const target = Number(node.dataset.count);
      if (!Number.isFinite(target)) return;
      // A hidden tab gets no animation frames, so leave the real figure alone
      // rather than pinning it at zero until someone looks.
      if (document.visibilityState !== 'visible') return;
      // Zeroed here rather than on the first frame: the gap between the reveal
      // and that frame was long enough to show the final figure, then flick.
      node.textContent = '0';
      // The start instant comes from the first frame, not from performance.now():
      // the two do not share an origin here, and a start captured outside the
      // loop ran the whole count at a negative progress, printing -1 throughout.
      let started: number | null = null;
      const step = (now: number) => {
        if (started === null) started = now;
        const progress = Math.min(1, Math.max(0, (now - started) / COUNT_MS));
        node.textContent = String(Math.round(easeOut(progress) * target));
        if (progress < 1) frames.push(requestAnimationFrame(step));
      };
      frames.push(requestAnimationFrame(step));
    };

    const start = () => {
      root.dataset.motion = 'on';

      // Reveals fire once and release their element: nothing observes the whole
      // page for the whole session.
      const reveal = new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          entry.target.querySelectorAll<HTMLElement>('[data-count]').forEach(countUp);
          observer.unobserve(entry.target);
        }
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.12 });
      root.querySelectorAll('[data-reveal]').forEach((node) => reveal.observe(node));
      observers.push(reveal);

      // The bar only needs its scrolled state while the top of the page is out
      // of view, which a sentinel reports without a scroll listener.
      const sentinel = root.querySelector('.nav-sentinel');
      if (sentinel) {
        const pinned = new IntersectionObserver(([entry]) => {
          root.classList.toggle('nav-pinned', !entry.isIntersecting);
        });
        pinned.observe(sentinel);
        observers.push(pinned);
      }
    };

    const sync = () => {
      stop();
      if (query.matches) {
        delete root.dataset.motion;
        root.classList.remove('nav-pinned');
        // Whatever a count-up had reached is replaced by the real figure.
        root.querySelectorAll<HTMLElement>('[data-count]').forEach((node) => {
          node.textContent = String(node.dataset.count);
        });
        return;
      }
      start();
    };

    sync();
    query.addEventListener('change', sync);
    return () => {
      query.removeEventListener('change', sync);
      stop();
    };
  }, []);

  return null;
}
