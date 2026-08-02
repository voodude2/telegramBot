import { useEffect, useState } from 'react';

/**
 * Cycles through words in place.
 *
 * All words are stacked in a single CSS grid cell, so the element is always as
 * wide as the LONGEST word and the headline never reflows as the word changes.
 * Only the active word is visible; the outgoing and incoming words crossfade, so
 * the slot is never empty — a plain fade-out/fade-in left the headline reading
 * "chosen" with a hole beside it for a third of a second on every cycle.
 */
export default function RotatingText({
  words = [],
  interval = 2600,
  className = '',
  /**
   * Applied to each word. Any gradient-text treatment MUST go here rather than
   * on an ancestor: `background-clip: text` paints the ancestor's own
   * background, and these words sit in their own layer (grid item + filter), so
   * an inherited `color: transparent` would render them completely invisible.
   */
  wordClassName = '',
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (words.length <= 1) return;

    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return; // hold on the first word rather than flickering

    const timer = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(timer);
  }, [words.length, interval]);

  return (
    // justify-items-center: the cell is as wide as the longest word, so a short
    // word must sit centred in it or the whole centred headline looks off-axis.
    <span className={`inline-grid justify-items-center align-bottom ${className}`}>
      {words.map((word, i) => (
        <span
          key={word}
          aria-hidden={i !== index}
          className={`col-start-1 row-start-1 whitespace-nowrap transition-all duration-500 ease-out ${wordClassName} ${
            i === index
              ? 'opacity-100 translate-y-0 blur-0'
              : 'opacity-0 -translate-y-3 blur-[6px] pointer-events-none'
          }`}
        >
          {word}
        </span>
      ))}
    </span>
  );
}
