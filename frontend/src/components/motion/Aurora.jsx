/**
 * Decorative ambient background: drifting colour fields plus a faint grid.
 *
 * Purely presentational, so it is hidden from assistive technology. Animation is
 * transform-only and disabled under prefers-reduced-motion (see index.css).
 */
export default function Aurora({ className = '', variant = 'hero' }) {
  const blobs =
    variant === 'hero'
      ? [
          { className: 'w-[38rem] h-[38rem] bg-primary/30 -top-40 -left-32', delay: '0s' },
          { className: 'w-[32rem] h-[32rem] bg-secondary/25 top-20 -right-24', delay: '-7s' },
          { className: 'w-[28rem] h-[28rem] bg-primary-soft/20 -bottom-32 left-1/3', delay: '-14s' },
        ]
      : [
          { className: 'w-[26rem] h-[26rem] bg-primary/15 -top-24 right-0', delay: '-4s' },
          { className: 'w-[22rem] h-[22rem] bg-secondary/15 bottom-0 -left-16', delay: '-11s' },
        ];

  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      {blobs.map((blob, i) => (
        <div key={i} className={`aurora ${blob.className}`} style={{ animationDelay: blob.delay }} />
      ))}
      <div className="absolute inset-0 grid-overlay" />
    </div>
  );
}
