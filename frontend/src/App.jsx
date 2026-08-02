import { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import ProductCard from './components/ProductCard';
import CartSidebar from './components/CartSidebar';
import AIChatWidget from './components/AIChatWidget';
import AdminDashboard from './components/AdminDashboard';
import AuthModal from './components/AuthModal';
import { API_URL, clearToken, getToken } from './lib/api';
import Reveal from './components/motion/Reveal';
import CountUp from './components/motion/CountUp';
import ScrollProgress from './components/motion/ScrollProgress';
import Aurora from './components/motion/Aurora';
import RotatingText from './components/motion/RotatingText';

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
  const [cartItems, setCartItems] = useState(() => {
    // Corrupt or hand-edited localStorage should not white-screen the whole store.
    try {
      const saved = localStorage.getItem('techstore_cart');
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('techstore_cart', JSON.stringify(cartItems));
  }, [cartItems]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState("All");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isAIChatOpen, setIsAIChatOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Check auth status on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (!getToken()) return;
      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
        } else {
          clearToken();
        }
      } catch (err) {
        console.warn('Auth check failed:', err);
      }
    };
    checkAuth();
  }, []);

  // Hash-based routing for Admin Dashboard
  const [currentPage, setCurrentPage] = useState(
    window.location.hash === '#admin' ? 'admin' : 'store'
  );

  useEffect(() => {
    const handleHashChange = () => {
      setCurrentPage(window.location.hash === '#admin' ? 'admin' : 'store');
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const response = await fetch(`${API_URL}/api/products`);
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

  const handleChatAction = (action) => {
    const payload = action?.payload || {};

    switch (action?.type) {
      case 'ADD_TO_CART': {
        const product = products.find(p => p.id === payload.productId);
        if (product) handleAddToCart(product);
        break;
      }

      case 'REMOVE_FROM_CART': {
        // A quantity means "take some off"; no quantity means remove the line.
        setCartItems(prev => prev.flatMap(item => {
          if (item.id !== payload.productId) return [item];
          if (!payload.quantity) return [];
          const remaining = item.quantity - payload.quantity;
          return remaining > 0 ? [{ ...item, quantity: remaining }] : [];
        }));
        setIsCartOpen(true);
        break;
      }

      case 'CLEAR_CART':
        setCartItems([]);
        break;

      default:
        break;
    }
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

  // Admin Dashboard route
  if (currentPage === 'admin') {
    return <AdminDashboard onBack={() => { window.location.hash = ''; setCurrentPage('store'); }} />;
  }

  const inStockCount = products.filter(p => p.inStock).length;

  const highlights = [
    { icon: '🧠', title: 'Knows the catalogue', body: 'The assistant searches live stock and pricing mid-conversation — never a canned FAQ script.' },
    { icon: '🌍', title: 'Speaks your language', body: 'Ask in any language and get an answer in the same one, with prices and policies translated.' },
    { icon: '📚', title: 'Never invents policy', body: 'Returns, shipping and warranty answers come from our own documentation by vector search.' },
    { icon: '🛒', title: 'Builds your cart', body: 'Add, remove or clear items by simply asking. The assistant sees your cart and acts on it.' },
  ];

  return (
    <div className="min-h-screen flex flex-col font-sans relative">
      <ScrollProgress />

      <Navbar
        cartCount={cartCount}
        onOpenCart={() => setIsCartOpen(true)}
        isMobileMenuOpen={isMobileMenuOpen}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        user={user}
        onLoginClick={() => setIsAuthModalOpen(true)}
        onLogout={() => {
          clearToken();
          setUser(null);
        }}
      />

      <main className="flex-grow">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section id="hero" className="relative min-h-[92vh] flex items-center overflow-hidden pt-20">
          <Aurora variant="hero" />

          <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full py-20 z-10">
            <div className="max-w-4xl mx-auto text-center">
              <Reveal variant="scale">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass border border-primary/30 text-xs font-medium text-primary-soft mb-8">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary" />
                  </span>
                  AI shopping assistant · live on web &amp; Telegram
                </span>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="text-5xl sm:text-7xl lg:text-8xl font-extrabold tracking-tight mb-6 leading-[1.05]">
                  <span className="block text-white">Premium electronics,</span>
                  <span className="block text-gradient-animated">
                    chosen{' '}
                    <RotatingText words={['for you', 'by AI', 'in seconds', 'your way']} />
                  </span>
                </h1>
              </Reveal>

              <Reveal delay={160}>
                <p className="max-w-2xl mx-auto text-lg sm:text-xl text-text-muted mb-10 leading-relaxed">
                  Ask our AI consultant anything — in any language. It searches real stock,
                  compares specs, answers policy questions and fills your cart while you talk.
                </p>
              </Reveal>

              <Reveal delay={240}>
                <div className="flex flex-col sm:flex-row justify-center gap-4 mb-16">
                  <button
                    onClick={() => setIsAIChatOpen(true)}
                    className="group px-8 py-4 rounded-full font-bold text-white bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_40px_rgba(108,92,231,0.5)] hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <span className="text-lg">🤖</span>
                    Talk to the AI
                    <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </button>
                  <button
                    onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })}
                    className="px-8 py-4 rounded-full font-bold text-white glass border border-border-glow hover:border-primary/50 hover:-translate-y-0.5 transition-all duration-300 cursor-pointer"
                  >
                    Browse products
                  </button>
                </div>
              </Reveal>

              <Reveal delay={320}>
                <dl className="grid grid-cols-3 gap-4 sm:gap-8 max-w-2xl mx-auto">
                  {[
                    { value: products.length || 23, suffix: '+', label: 'Products in stock' },
                    { value: 2, suffix: '', label: 'Channels, one brain' },
                    { value: 24, suffix: '/7', label: 'Instant answers' },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <dt className="text-3xl sm:text-4xl font-extrabold bg-gradient-to-r from-primary-soft to-secondary bg-clip-text text-transparent">
                        <CountUp end={stat.value} suffix={stat.suffix} />
                      </dt>
                      <dd className="text-xs sm:text-sm text-text-muted mt-1">{stat.label}</dd>
                    </div>
                  ))}
                </dl>
              </Reveal>
            </div>
          </div>

          {/* Scroll hint */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 hidden sm:flex flex-col items-center gap-2">
            <span className="text-[11px] uppercase tracking-[0.2em] text-text-muted">Scroll</span>
            <span className="w-5 h-8 rounded-full border border-border-glow flex justify-center pt-1.5">
              <span className="w-1 h-1.5 rounded-full bg-secondary animate-scroll-hint" />
            </span>
          </div>
        </section>

        {/* ── Marquee ──────────────────────────────────────────────────── */}
        <section className="py-6 border-y border-border-glow bg-bg-card/30 overflow-hidden marquee-mask">
          <div className="flex w-max animate-marquee">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center gap-12 px-6" aria-hidden={copy === 1}>
                {['Free shipping over $99', 'Genuine 2-year warranty', '30-day returns', 'AI support in any language', 'Same-day dispatch', 'Secure checkout'].map((item) => (
                  <span key={item} className="flex items-center gap-3 text-sm text-text-muted whitespace-nowrap">
                    <span className="text-secondary">◆</span>
                    {item}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </section>

        {/* ── Why ──────────────────────────────────────────────────────── */}
        <section id="about" className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <Aurora variant="soft" />
          <div className="relative max-w-7xl mx-auto z-10">
            <Reveal className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-secondary">Why TechStore</span>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mt-3 mb-4">
                Not a chatbot. A consultant.
              </h2>
              <p className="text-text-muted text-lg leading-relaxed">
                Most store bots read from a script. Ours reads from our live inventory
                and our actual policy documents.
              </p>
            </Reveal>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {highlights.map((item, i) => (
                <Reveal key={item.title} delay={i * 90} variant="up">
                  <div className="spotlight glow-border h-full bg-bg-card/60 border border-border-glow rounded-2xl p-6 hover:-translate-y-1.5 transition-transform duration-500">
                    <div className="text-3xl mb-4">{item.icon}</div>
                    <h3 className="font-bold text-white mb-2">{item.title}</h3>
                    <p className="text-sm text-text-muted leading-relaxed">{item.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ── Products ─────────────────────────────────────────────────── */}
        <section id="products" className="py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
          <Reveal className="mb-10">
            <span className="text-xs font-semibold tracking-[0.2em] uppercase text-secondary">The catalogue</span>
            <h2 className="text-4xl sm:text-5xl font-bold text-white mt-3 mb-4">
              Featured products
            </h2>
            <p className="text-text-muted max-w-xl">
              {loading
                ? 'Loading the live catalogue…'
                : `${products.length} products · ${inStockCount} ready to ship today.`}
              {error && <span className="text-amber-400/80"> Showing sample data — the live catalogue is unreachable.</span>}
            </p>
          </Reveal>

          {/* Category filter */}
          <Reveal delay={80}>
            <div className="sticky top-16 z-30 -mx-4 px-4 py-3 mb-10 bg-bg-dark/80 backdrop-blur-lg">
              <div className="flex flex-wrap gap-2.5">
                {categories.map(category => (
                  <button
                    key={category}
                    onClick={() => setActiveCategory(category)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 cursor-pointer border ${
                      activeCategory === category
                        ? 'bg-gradient-to-r from-primary to-secondary text-white border-transparent shadow-lg shadow-primary/30 scale-105'
                        : 'bg-bg-card text-text-muted hover:text-white border-border-glow hover:border-primary/50'
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>
          </Reveal>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="bg-bg-card border border-border-glow rounded-2xl overflow-hidden h-[400px]">
                  <div className="h-48 shimmer bg-bg-elevated" />
                  <div className="p-5 space-y-3">
                    <div className="h-4 w-3/4 rounded shimmer bg-bg-elevated" />
                    <div className="h-3 w-full rounded shimmer bg-bg-elevated" />
                    <div className="h-3 w-2/3 rounded shimmer bg-bg-elevated" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="text-center py-24">
              <div className="text-5xl mb-4 opacity-40">🔍</div>
              <p className="text-xl text-text-muted">No products in this category.</p>
              <button
                onClick={() => setActiveCategory('All')}
                className="mt-4 text-primary hover:text-secondary transition-colors text-sm font-medium"
              >
                Show everything
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {filteredProducts.map((product, i) => (
                <Reveal key={product.id} delay={Math.min(i, 8) * 70} variant="up">
                  <ProductCard product={product} onAddToCart={handleAddToCart} />
                </Reveal>
              ))}
            </div>
          )}
        </section>

        {/* ── AI showcase ──────────────────────────────────────────────── */}
        <section className="relative py-24 px-4 sm:px-6 lg:px-8 overflow-hidden border-y border-border-glow">
          <Aurora variant="soft" />
          <div className="relative max-w-7xl mx-auto grid lg:grid-cols-2 gap-14 items-center z-10">
            <Reveal variant="left">
              <span className="text-xs font-semibold tracking-[0.2em] uppercase text-secondary">Try it now</span>
              <h2 className="text-4xl sm:text-5xl font-bold text-white mt-3 mb-6 leading-tight">
                Ask anything.<br />In any language.
              </h2>
              <p className="text-text-muted text-lg mb-8 leading-relaxed">
                The same assistant answers here and on Telegram, sharing one memory of
                who you are and what you like.
              </p>

              <ul className="space-y-3 mb-8">
                {['Searches real-time stock and pricing', 'Answers policy questions from our own documents', 'Remembers your preferences between visits', 'Adds and removes items from your cart'].map((line, i) => (
                  <li key={line} className="flex items-start gap-3" style={{ '--reveal-delay': `${i * 60}ms` }}>
                    <span className="mt-1 w-5 h-5 rounded-full bg-secondary/15 text-secondary grid place-items-center text-xs shrink-0">✓</span>
                    <span className="text-text-muted">{line}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => setIsAIChatOpen(true)}
                className="group px-7 py-3.5 rounded-full font-bold text-white bg-gradient-to-r from-primary to-secondary hover:shadow-[0_0_40px_rgba(108,92,231,0.45)] hover:-translate-y-0.5 transition-all duration-300 cursor-pointer inline-flex items-center gap-2"
              >
                Open the assistant
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>
            </Reveal>

            {/* Mock conversation */}
            <Reveal variant="right" delay={120}>
              <div className="glass border border-border-glow rounded-3xl p-6 shadow-2xl">
                <div className="flex items-center gap-3 pb-4 border-b border-border-glow mb-4">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary grid place-items-center text-lg">🤖</div>
                  <div>
                    <p className="font-bold text-white text-sm">TechStore AI</p>
                    <p className="text-[11px] text-text-muted flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Live catalogue consultant
                    </p>
                  </div>
                </div>

                <div className="space-y-3 text-sm">
                  <div className="flex justify-end">
                    <p className="max-w-[85%] bg-gradient-to-r from-primary to-secondary text-white rounded-2xl rounded-br-sm px-4 py-2.5">
                      I need a laptop under $2000 for video editing
                    </p>
                  </div>
                  <div className="flex justify-start">
                    <p className="max-w-[90%] bg-bg-card border border-border-glow rounded-2xl rounded-bl-sm px-4 py-2.5 text-gray-200">
                      The <strong className="text-white">MacBook Pro 14" M3</strong> at $1,999 is your best
                      pick — it's in stock and handles 4K timelines comfortably. Want me to add it?
                    </p>
                  </div>
                  <div className="flex justify-end">
                    <p className="max-w-[85%] bg-gradient-to-r from-primary to-secondary text-white rounded-2xl rounded-br-sm px-4 py-2.5">
                      Yes please
                    </p>
                  </div>
                  <div className="flex justify-start">
                    <p className="max-w-[90%] bg-bg-card border border-border-glow rounded-2xl rounded-bl-sm px-4 py-2.5 text-gray-200">
                      Added to your cart 🛒 Anything else?
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer id="contact" className="bg-bg-card/40 border-t border-border-glow py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">
            <Reveal className="col-span-1 md:col-span-2">
              <div className="flex items-center mb-4">
                <span className="text-2xl mr-2">⚡</span>
                <span className="text-xl font-bold text-gradient-animated">TechStore</span>
              </div>
              <p className="text-text-muted mb-6 max-w-sm leading-relaxed">
                Premium electronics with an AI consultant that actually knows the
                catalogue — on the web and on Telegram.
              </p>
              <div className="inline-flex items-center gap-2 glass px-3 py-1.5 rounded-full border border-border-glow text-xs text-text-muted">
                <span>Powered by</span>
                <span className="text-primary-soft font-bold">✨ Gemini</span>
              </div>
            </Reveal>

            <Reveal delay={80}>
              <h4 className="text-white font-semibold mb-4">Explore</h4>
              <ul className="space-y-2.5 text-sm text-text-muted">
                {[['Home', 'hero'], ['Products', 'products'], ['Why us', 'about']].map(([label, target]) => (
                  <li key={label}>
                    <button
                      onClick={() => document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' })}
                      className="hover:text-primary-soft transition-colors cursor-pointer"
                    >
                      {label}
                    </button>
                  </li>
                ))}
                <li>
                  <button onClick={() => setIsAIChatOpen(true)} className="hover:text-primary-soft transition-colors cursor-pointer">
                    AI Assistant
                  </button>
                </li>
              </ul>
            </Reveal>

            <Reveal delay={160}>
              <h4 className="text-white font-semibold mb-4">Support</h4>
              <ul className="space-y-2.5 text-sm text-text-muted">
                <li>Free shipping over $99</li>
                <li>30-day returns</li>
                <li>2-year warranty</li>
                <li>
                  <button onClick={() => setIsAIChatOpen(true)} className="text-primary-soft hover:text-secondary transition-colors cursor-pointer">
                    Ask the assistant →
                  </button>
                </li>
              </ul>
            </Reveal>
          </div>

          <div className="pt-8 border-t border-border-glow flex flex-col sm:flex-row justify-between items-center gap-3 text-sm text-text-muted">
            <p>&copy; {new Date().getFullYear()} TechStore. All rights reserved.</p>
            <p className="text-xs">Demo storefront · built with React &amp; Gemini</p>
          </div>
        </div>
      </footer>

      <CartSidebar
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems}
        onUpdateQuantity={updateQuantity}
        onRemoveFromCart={removeFromCart}
        cartTotal={cartTotal}
      />

      <AIChatWidget
        isOpen={isAIChatOpen}
        setIsOpen={setIsAIChatOpen}
        onAction={handleChatAction}
        user={user}
        cartItems={cartItems}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onLoginSuccess={(userData) => setUser(userData)}
      />
    </div>
  );
}
