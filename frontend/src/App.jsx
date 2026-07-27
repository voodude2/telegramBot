import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ProductCard from './components/ProductCard';
import CartSidebar from './components/CartSidebar';
import AIChatWidget from './components/AIChatWidget';

const fallbackProducts = [
  { id: 1, name: "Apple iPhone 15 Pro", category: "Smartphones", description: "Forged in titanium and featuring the groundbreaking A17 Pro chip.", price: 999, rating: 4.9, inStock: true, image: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?q=80&w=400&auto=format&fit=crop" },
  { id: 2, name: "Apple MacBook Pro 14\" M3", category: "Computers", description: "Mind-blowing performance with the M3 chip.", price: 1599, rating: 4.8, inStock: true, image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?q=80&w=400&auto=format&fit=crop" },
  { id: 3, name: "Sony WH-1000XM5", category: "Audio", description: "Industry-leading noise cancellation headphones.", price: 398, rating: 4.7, inStock: false, image: "https://images.unsplash.com/photo-1618366712010-f4ae9c647dcb?q=80&w=400&auto=format&fit=crop" },
  { id: 4, name: "Apple Watch Series 9", category: "Accessories", description: "Advanced health tracking including ECG and blood oxygen.", price: 399, rating: 4.6, inStock: true, image: "https://images.unsplash.com/photo-1434493789847-2f02dc6ca35d?q=80&w=400&auto=format&fit=crop" },
  { id: 5, name: "Logitech G Pro X Superlight", category: "Accessories", description: "Ultra-lightweight gaming mouse at under 63 grams.", price: 149, rating: 4.8, inStock: true, image: "https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?q=80&w=400&auto=format&fit=crop" },
  { id: 6, name: "JBL Charge 5 Bluetooth Speaker", category: "Audio", description: "Portable waterproof speaker with Pro Sound.", price: 149, rating: 4.6, inStock: true, image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?q=80&w=400&auto=format&fit=crop" },
];

export default function App() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cartItems, setCartItems] = useState([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/products');
        if (!response.ok) throw new Error('Failed to fetch products');
        const data = await response.json();
        setProducts(data);
      } catch (err) {
        console.warn("API failed, using fallback data:", err);
        setError(err.message);
        setProducts(fallbackProducts);
      } finally {
        setLoading(false);
      }
    };
    
    fetchProducts();
  }, []);

  const categories = ["All", ...new Set(products.map(p => p.category))];
  const filteredProducts = activeCategory === "All" ? products : products.filter(p => p.category === activeCategory);

  const handleAddToCart = (product) => {
    setCartItems(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        return prev.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { ...product, quantity: 1 }];
    });
    setIsCartOpen(true);
  };

  const removeFromCart = (id) => {
    setCartItems(prev => prev.filter(item => item.id !== id));
  };

  const updateQuantity = (id, delta) => {
    setCartItems(prev => prev.map(item => {
      if (item.id === id) {
        const newQ = item.quantity + delta;
        return newQ > 0 ? { ...item, quantity: newQ } : item;
      }
      return item;
    }));
  };

  const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cartItems.reduce((count, item) => count + item.quantity, 0);

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header / Navigation */}
      <Navbar 
        cartCount={cartCount}
        onOpenCart={() => setIsCartOpen(true)}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
      />

      <main className="flex-grow pt-20">
        {/* Hero Section */}
        <section id="hero" className="relative overflow-hidden py-20 sm:py-32 bg-gradient-to-br from-bg-dark via-[#1a103c] to-[#0d233a] animate-gradient-x">
          {/* Decorative elements */}
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/20 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-float" style={{ animationDelay: '0s' }}></div>
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-secondary/20 rounded-full mix-blend-screen filter blur-3xl opacity-50 animate-float" style={{ animationDelay: '2s' }}></div>
          
          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center z-10">
            <h1 className="text-5xl sm:text-7xl font-extrabold tracking-tight mb-6">
              <span className="block text-white mb-2">Premium Electronics</span>
              <span className="block bg-gradient-to-r from-primary via-[#9b59b6] to-secondary bg-clip-text text-transparent">
                Engineered for the Future
              </span>
            </h1>
            <p className="mt-4 max-w-2xl text-xl text-text-muted mx-auto mb-10">
              Discover the latest in technology. Explore our handpicked selection of cutting-edge gadgets, now assisted by our advanced AI Telegram Assistant.
            </p>
            <div className="flex justify-center gap-4 flex-col sm:flex-row">
              <button 
                onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })} 
                className="px-8 py-4 rounded-full font-bold text-white bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_20px_rgba(108,92,231,0.5)] transform hover:-translate-y-1 transition-all duration-300 cursor-pointer"
              >
                Shop Now
              </button>
              <button 
                onClick={() => setIsAIChatOpen(true)}
                className="px-8 py-4 rounded-full font-bold text-white border border-border-glow hover:bg-white/5 backdrop-blur-sm transform hover:-translate-y-1 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
              >
                AI Assistant 🤖
              </button>
            </div>
          </div>
        </section>

        {/* Product Grid Section */}
        <section id="products" className="py-20 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <div className="mb-12">
            <h2 className="text-3xl font-bold inline-block relative mb-6">
              Featured Products
              <span className="absolute bottom-0 left-0 w-1/2 h-1 bg-gradient-to-r from-primary to-secondary rounded-full transform translate-y-2"></span>
            </h2>
            
            {/* Category Filters */}
            <div className="flex flex-wrap gap-3 mt-4">
              {categories.map(category => (
                <button
                  key={category}
                  onClick={() => setActiveCategory(category)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer ${
                    activeCategory === category 
                      ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/30' 
                      : 'bg-bg-card text-text-muted hover:text-white border border-border-glow hover:border-primary/50'
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-primary"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
              {filteredProducts.map(product => (
                <ProductCard 
                  key={product.id}
                  product={product}
                  onAddToCart={handleAddToCart}
                />
              ))}
            </div>
          )}
          
          {!loading && filteredProducts.length === 0 && (
            <div className="text-center py-20 text-text-muted">
              <p className="text-xl">No products found in this category.</p>
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer id="about" className="bg-bg-card border-t border-border-glow py-12 mt-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center group mb-4">
                <span className="text-2xl mr-2">⚡</span>
                <span className="text-xl font-bold text-white">TechStore</span>
              </div>
              <p className="text-text-muted mb-4 max-w-sm">
                Premium electronics and futuristic gadgets for the modern consumer. Experience tomorrow's technology today.
              </p>
              <div className="inline-flex items-center space-x-2 bg-bg-dark px-3 py-1.5 rounded-full border border-border-glow text-xs text-text-muted">
                <span>Powered by AI</span>
                <span className="text-primary font-bold">✨ Gemini</span>
              </div>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">Quick Links</h4>
              <ul className="space-y-2 text-sm text-text-muted">
                <li><button onClick={() => document.getElementById('hero')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-primary transition-colors cursor-pointer">Home</button></li>
                <li><button onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-primary transition-colors cursor-pointer">Products</button></li>
                <li><button onClick={() => document.getElementById('about')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-primary transition-colors cursor-pointer">About Us</button></li>
                <li><button onClick={() => document.getElementById('contact')?.scrollIntoView({ behavior: 'smooth' })} className="hover:text-primary transition-colors cursor-pointer">Contact</button></li>
              </ul>
            </div>
            
            <div id="contact">
              <h4 className="text-white font-semibold mb-4">Connect</h4>
              <div className="flex space-x-4">
                {[1, 2, 3, 4].map(i => (
                  <a key={i} href="#" className="w-8 h-8 rounded-full bg-bg-dark flex items-center justify-center text-text-muted hover:text-white hover:bg-primary transition-all duration-300">
                    <span className="sr-only">Social {i}</span>
                    <div className="w-4 h-4 bg-current rounded-sm"></div>
                  </a>
                ))}
              </div>
            </div>
          </div>
          
          <div className="pt-8 border-t border-border-glow text-center text-sm text-text-muted">
            <p>&copy; {new Date().getFullYear()} TechStore. All rights reserved.</p>
          </div>
        </div>
      </footer>

      {/* Cart Sidebar */}
      <CartSidebar 
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={updateQuantity}
        onRemoveFromCart={removeFromCart}
        cartTotal={cartTotal}
      />

      {/* Web AI Assistant Chat Widget */}
      <AIChatWidget 
        isOpen={isAIChatOpen} 
        setIsOpen={setIsAIChatOpen} 
      />
    </div>
  );
}
