import { useScrollProgress } from '../../hooks/useReveal';

/** Thin gradient bar showing how far through the page the reader is. */
export default function ScrollProgress() {
  const progress = useScrollProgress();

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 bg-transparent pointer-events-none">
      <div
        className="h-full bg-gradient-to-r from-primary via-secondary to-primary-soft origin-left transition-transform duration-150 ease-out"
        style={{ transform: `scaleX(${progress})` }}
        role="progressbar"
        aria-label="Page scroll progress"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}
