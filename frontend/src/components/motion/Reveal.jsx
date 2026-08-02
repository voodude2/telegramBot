import { useReveal } from '../../hooks/useReveal';

const VARIANTS = {
  up: 'reveal',
  left: 'reveal reveal-left',
  right: 'reveal reveal-right',
  scale: 'reveal reveal-scale',
  blur: 'reveal reveal-blur',
};

/**
 * Reveals its children as they scroll into view.
 *
 * @param {'up'|'left'|'right'|'scale'|'blur'} [variant]
 * @param {number} [delay] Stagger in ms — pass `index * 80` inside a grid.
 * @param {string} [as]    Element to render, so this never breaks semantics.
 */
export default function Reveal({
  children,
  variant = 'up',
  delay = 0,
  as: Tag = 'div',
  className = '',
  threshold,
  once = true,
  ...rest
}) {
  const reveal = useReveal({ delay, threshold, once });

  return (
    <Tag
      ref={reveal.ref}
      style={reveal.style}
      className={`${VARIANTS[variant] || VARIANTS.up} ${reveal.className} ${className}`}
      {...rest}
    >
      {children}
    </Tag>
  );
}
