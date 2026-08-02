import { useRef, useState } from 'react';

export default function ProductCard({ product, onAddToCart }) {
  const cardRef = useRef(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [justAdded, setJustAdded] = useState(false);

  /**
   * Feeds the cursor position to the CSS spotlight as percentages. Cheap enough
   * to run inline: it only writes two custom properties, and only while hovered.
   */
  const handleMouseMove = (e) => {
    const node = cardRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    node.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
    node.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
  };

  const handleAdd = () => {
    onAddToCart(product);
    // Brief confirmation so the click has a visible result even when the cart
    // drawer is already open.
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  };

  return (
    <article
      ref={cardRef}
      onMouseMove={handleMouseMove}
      className="spotlight glow-border bg-bg-card rounded-2xl overflow-hidden border border-border-glow transition-all duration-500 group hover:-translate-y-2 hover:shadow-[0_18px_50px_-12px_rgba(108,92,231,0.45)] flex flex-col h-full"
    >
      {/* Image */}
      <div className="h-48 bg-gradient-to-br from-bg-elevated to-bg-dark relative overflow-hidden">
        {!imageLoaded && !imageFailed && <div className="absolute inset-0 shimmer bg-bg-elevated" />}

        {imageFailed ? (
          <div className="absolute inset-0 grid place-items-center text-4xl opacity-30">📦</div>
        ) : (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={() => setImageFailed(true)}
            className={`w-full h-full object-cover transition-all duration-700 group-hover:scale-110 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-transparent to-transparent opacity-70" />

        <span className="absolute top-3 left-3 z-10 text-[11px] font-semibold px-2.5 py-1 rounded-full glass border border-primary/30 text-primary-soft">
          {product.category}
        </span>

        <span className="absolute top-3 right-3 z-10 text-[11px] font-medium px-2 py-1 rounded-full glass border border-white/10 text-amber-300">
          ★ {product.rating}
        </span>

        {!product.inStock && (
          <div className="absolute inset-0 bg-bg-dark/70 backdrop-blur-[2px] grid place-items-center z-10">
            <span className="bg-danger/90 text-white px-4 py-1.5 rounded-full font-bold text-xs tracking-wide border border-white/20 shadow-lg">
              OUT OF STOCK
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-5 flex flex-col flex-grow relative z-10">
        <h3 className="text-lg font-bold text-white mb-2 line-clamp-1 group-hover:text-secondary transition-colors duration-300">
          {product.name}
        </h3>

        <p className="text-sm text-text-muted mb-4 line-clamp-2 flex-grow leading-relaxed">
          {product.description}
        </p>

        <div className="flex items-end justify-between mt-auto pt-4 border-t border-border-glow">
          <div className="flex flex-col">
            <span className="text-[11px] text-text-muted uppercase tracking-wider">Price</span>
            <span className="text-2xl font-bold bg-gradient-to-r from-primary-soft to-secondary bg-clip-text text-transparent">
              ${Number(product.price).toLocaleString()}
            </span>
          </div>

          <button
            onClick={handleAdd}
            disabled={!product.inStock}
            aria-label={product.inStock ? `Add ${product.name} to cart` : 'Out of stock'}
            className={`h-11 px-4 rounded-xl flex items-center gap-2 font-semibold text-sm transition-all duration-300 ${
              product.inStock
                ? justAdded
                  ? 'bg-emerald-500 text-white scale-95'
                  : 'bg-gradient-to-r from-primary to-secondary text-white hover:shadow-lg hover:shadow-primary/40 hover:scale-105 active:scale-95 cursor-pointer'
                : 'bg-white/5 text-text-muted cursor-not-allowed'
            }`}
          >
            {justAdded ? (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Added
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}
