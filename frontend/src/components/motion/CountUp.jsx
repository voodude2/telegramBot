import { useEffect, useRef, useState } from 'react';
import { useReveal } from '../../hooks/useReveal';

/** Ease-out cubic — fast start, gentle settle. */
const easeOut = (t) => 1 - Math.pow(1 - t, 3);

/**
 * Counts up to `end` when scrolled into view.
 *
 * Driven by requestAnimationFrame against real elapsed time rather than a fixed
 * per-frame step, so the duration is the same on a 60Hz and a 120Hz display.
 */
export default function CountUp({
  end = 0,
  duration = 1600,
  decimals = 0,
  prefix = '',
  suffix = '',
  className = '',
}) {
  const { ref, isVisible } = useReveal();
  const [value, setValue] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    if (!isVisible) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      setValue(end);
      return;
    }

    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      setValue(end * easeOut(progress));
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [isVisible, end, duration]);

  const display = value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span ref={ref} className={className}>
      {prefix}{display}{suffix}
    </span>
  );
}
