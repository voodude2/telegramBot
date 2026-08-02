import { useEffect, useRef, useState } from 'react';

/**
 * Scroll-reveal via IntersectionObserver.
 *
 * Deliberately dependency-free: a scroll-animation library would add more
 * kilobytes than the whole effect is worth, and IntersectionObserver does this
 * natively without running JavaScript on every scroll frame.
 *
 * Triggering is driven by rootMargin with a threshold of 0, NOT by a visible
 * fraction. A fractional threshold looks fine until an element is taller than
 * the viewport: its intersection ratio can never exceed viewportHeight /
 * elementHeight, so on a short window (a laptop with devtools open, a phone in
 * landscape) a tall section would never cross the threshold and would stay
 * invisible forever. The negative bottom margin gives the same "reveal slightly
 * before it reaches the bottom edge" feel, at any element size.
 *
 * @param {object}  options
 * @param {boolean} [options.once]      Stop observing after the first reveal.
 * @param {number}  [options.threshold] Visible fraction; leave at 0 unless the
 *                                      element is known to be small.
 * @param {number}  [options.delay]     Stagger, in milliseconds.
 */
export function useReveal({ once = true, threshold = 0, delay = 0, rootMargin = '0px 0px -80px 0px' } = {}) {
  const ref = useRef(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    // No observer (very old browser) or reduced motion: show it immediately
    // rather than leaving content permanently invisible.
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (typeof IntersectionObserver === 'undefined' || prefersReduced) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          setIsVisible(false);
        }
      },
      { threshold, rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [once, threshold, rootMargin]);

  return {
    ref,
    isVisible,
    style: { '--reveal-delay': `${delay}ms` },
    className: isVisible ? 'is-visible' : '',
  };
}

/** Current scroll progress through the document, 0–1. */
export function useScrollProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = null;

    const update = () => {
      frame = null;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(window.scrollY / scrollable, 1) : 0);
    };

    // Coalesce scroll events into one update per animation frame.
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, []);

  return progress;
}

/** True once the page has scrolled past `offset` pixels. */
export function useScrolled(offset = 20) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    let frame = null;
    const update = () => {
      frame = null;
      setScrolled(window.scrollY > offset);
    };
    const onScroll = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [offset]);

  return scrolled;
}

/** Highlights whichever section is currently in view. */
export function useActiveSection(ids = []) {
  const [active, setActive] = useState(ids[0] || '');
  const key = ids.join(',');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 0.25, 0.5] }
    );

    const nodes = ids.map((id) => document.getElementById(id)).filter(Boolean);
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [key]);

  return active;
}
