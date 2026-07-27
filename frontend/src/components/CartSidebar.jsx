export default function CartSidebar({ 
  isOpen, 
  onClose, 
  cartItems, 
  onUpdateQuantity, 
  onRemoveFromCart, 
  cartTotal 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden flex justify-end">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose}
      ></div>

      {/* Drawer */}
      <div className="relative w-full max-w-md h-full bg-bg-card shadow-2xl flex flex-col border-l border-border-glow z-10">
        <div className="px-6 py-4 border-b border-border-glow flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Your Cart</h2>
          <button 
            onClick={onClose} 
            className="text-text-muted hover:text-white p-1 transition-colors cursor-pointer"
            aria-label="Close cart"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* Cart Item List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {cartItems.length === 0 ? (
            <div className="text-center py-16 text-text-muted">
              <span className="text-5xl block mb-3">🛒</span>
              <p className="text-lg font-medium">Your cart is empty.</p>
            </div>
          ) : (
            cartItems.map(item => (
              <div key={item.id} className="flex gap-4 border-b border-border-glow/50 pb-4">
                <img 
                  src={item.image} 
                  alt={item.name} 
                  className="w-20 h-20 object-cover rounded-lg bg-bg-dark flex-shrink-0" 
                />
                <div className="flex-1 flex flex-col justify-between">
                  <div>
                    <h4 className="text-white font-medium line-clamp-1">{item.name}</h4>
                    <div className="text-primary font-bold">${item.price}</div>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center bg-bg-dark rounded-md border border-border-glow">
                      <button 
                        onClick={() => onUpdateQuantity(item.id, -1)} 
                        className="px-2 py-1 text-text-muted hover:text-white transition-colors cursor-pointer"
                      >
                        -
                      </button>
                      <span className="px-2 text-white text-sm font-semibold">{item.quantity}</span>
                      <button 
                        onClick={() => onUpdateQuantity(item.id, 1)} 
                        className="px-2 py-1 text-text-muted hover:text-white transition-colors cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                    <button 
                      onClick={() => onRemoveFromCart(item.id)} 
                      className="text-danger hover:text-red-400 text-sm font-medium transition-colors cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
        
        {/* Footer / Checkout */}
        {cartItems.length > 0 && (
          <div className="p-6 border-t border-border-glow bg-bg-dark/50">
            <div className="flex justify-between text-white font-bold mb-4 text-lg">
              <span>Total</span>
              <span className="text-primary">${cartTotal.toFixed(2)}</span>
            </div>
            <button className="w-full py-3 rounded-lg bg-gradient-to-r from-primary to-secondary text-white font-bold hover:shadow-lg hover:shadow-primary/30 transition-all cursor-pointer">
              Checkout
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
