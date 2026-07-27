export default function ProductCard({ product, onAddToCart }) {
  return (
    <div className="bg-bg-card rounded-2xl overflow-hidden border border-border-glow hover:border-primary/50 transition-all duration-300 group hover:-translate-y-2 hover:shadow-[0_10px_30px_rgba(108,92,231,0.15)] flex flex-col">
      {/* Image */}
      <div className="h-48 bg-gradient-to-br from-gray-800 to-gray-900 relative flex items-center justify-center overflow-hidden">
        <img 
          src={product.image} 
          alt={product.name} 
          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" 
        />
        <div className="absolute inset-0 bg-primary/10 group-hover:bg-primary/20 transition-colors duration-300 mix-blend-overlay"></div>
        {!product.inStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-[2px]">
            <span className="bg-danger text-white px-4 py-1 rounded-full font-bold text-sm transform -rotate-12 border border-white/20 shadow-lg">
              OUT OF STOCK
            </span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-6 flex flex-col flex-grow">
        <div className="flex justify-between items-start mb-2">
          <span className="text-xs font-semibold px-2 py-1 bg-primary/20 text-primary rounded-full border border-primary/30">
            {product.category}
          </span>
          <div className="flex items-center text-yellow-500 text-sm font-medium">
            ⭐ {product.rating}
          </div>
        </div>
        
        <h3 className="text-lg font-bold text-white mb-2 line-clamp-1 group-hover:text-secondary transition-colors duration-300">
          {product.name}
        </h3>
        
        <p className="text-sm text-text-muted mb-4 line-clamp-2 flex-grow">
          {product.description}
        </p>
        
        <div className="flex items-center justify-between mt-auto pt-4 border-t border-border-glow">
          <div className="flex flex-col">
            <span className="text-xs text-text-muted">Price</span>
            <span className="text-xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              ${product.price}
            </span>
          </div>
          
          <button 
            onClick={() => onAddToCart(product)}
            disabled={!product.inStock}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
              product.inStock 
                ? 'bg-gradient-to-r from-primary to-secondary text-white hover:shadow-lg hover:shadow-primary/40 transform hover:scale-110 cursor-pointer' 
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
            title={product.inStock ? "Add to cart" : "Out of stock"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
