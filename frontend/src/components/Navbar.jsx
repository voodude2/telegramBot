import { useScrolled, useActiveSection } from '../hooks/useReveal';

export default function Navbar({ cartCount, onOpenCart, isMobileMenuOpen, setIsMobileMenuOpen, user, onLoginClick, onLogout }) {
  // The bar condenses and gains contrast once the hero scrolls away, so it stays
  // legible over content without being heavy over the hero itself.
  const scrolled = useScrolled(30);
  const activeSection = useActiveSection(['hero', 'products', 'about', 'contact']);

  const navLinks = [
    { label: 'Home', target: 'hero' },
    { label: 'Products', target: 'products' },
    { label: 'About', target: 'about' },
    { label: 'Contact', target: 'contact' }
  ];

  const handleNavClick = (target) => {
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' });
    setIsMobileMenuOpen(false);
  };

  const handleLogoClick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setIsMobileMenuOpen(false);
  };

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-500 ${
      scrolled
        ? 'bg-bg-dark/90 backdrop-blur-xl border-b border-border-glow shadow-lg shadow-black/20'
        : 'bg-transparent border-b border-transparent'
    }`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className={`flex justify-between items-center transition-all duration-500 ${scrolled ? 'h-16' : 'h-20'}`}>
          {/* Logo */}
          <div 
            onClick={handleLogoClick} 
            className="flex-shrink-0 flex items-center cursor-pointer group"
          >
            <span className={`mr-2 rounded-full transition-all duration-500 group-hover:animate-pulse-glow ${scrolled ? 'text-2xl' : 'text-3xl'}`}>⚡</span>
            <span className={`font-bold text-gradient-animated transition-all duration-500 ${scrolled ? 'text-xl' : 'text-2xl'}`}>
              TechStore
            </span>
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex space-x-8">
            {navLinks.map(link => (
              <button
                key={link.label}
                onClick={() => handleNavClick(link.target)}
                className={`relative py-1 font-medium cursor-pointer transition-colors duration-300 group/link ${
                  activeSection === link.target ? 'text-white' : 'text-text-muted hover:text-white'
                }`}
              >
                {link.label}
                <span className={`absolute -bottom-0.5 left-0 h-0.5 rounded-full bg-gradient-to-r from-primary to-secondary transition-all duration-300 ${
                  activeSection === link.target ? 'w-full' : 'w-0 group-hover/link:w-full'
                }`} />
              </button>
            ))}
          </nav>

          {/* Action Buttons */}
          <div className="flex items-center space-x-4">
            {/* User Auth */}
            {user ? (
              <div className="hidden md:flex items-center space-x-3 bg-white/5 border border-white/10 px-3 py-1.5 rounded-full">
                <span className="text-sm text-text-muted">Hi, <span className="text-white font-medium">{user.name.split(' ')[0]}</span></span>
                <div className="w-px h-4 bg-white/20"></div>
                <button 
                  onClick={onLogout}
                  className="text-xs text-danger/80 hover:text-danger font-medium transition-colors cursor-pointer"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button 
                onClick={onLoginClick}
                className="hidden md:flex items-center space-x-2 text-sm font-medium text-white/80 hover:text-white transition-colors cursor-pointer"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <span>Login</span>
              </button>
            )}

            {/* Admin Dashboard Link */}
            <a 
              href="#admin" 
              className="p-2 text-text-muted/40 hover:text-primary transition-colors duration-300"
              aria-label="Admin Dashboard"
              title="Admin Dashboard"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </a>
            
            <button 
              onClick={onOpenCart} 
              className="relative p-2 text-text-muted hover:text-white transition-colors duration-300 cursor-pointer"
              aria-label="Shopping Cart"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              {cartCount > 0 && (
                <span key={cartCount} className="absolute top-0 right-0 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 text-[11px] font-bold leading-none text-white transform translate-x-1/2 -translate-y-1/2 bg-danger rounded-full shadow-lg shadow-danger/40 animate-fade-in-up">
                  {cartCount}
                </span>
              )}
            </button>
            
            {/* Mobile menu button */}
            <button 
              className="md:hidden text-text-muted hover:text-white p-2"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              aria-label="Toggle Menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      
      {/* Mobile Nav */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-bg-card border-b border-border-glow">
          <div className="px-2 pt-2 pb-3 space-y-1 sm:px-3 bg-bg-dark border-b border-border-glow">
          {user ? (
            <div className="px-3 py-2 flex justify-between items-center bg-white/5 rounded-md mb-2 border border-white/10">
              <span className="text-white font-medium">Hi, {user.name}</span>
              <button onClick={onLogout} className="text-danger text-sm font-medium">Logout</button>
            </div>
          ) : (
            <button 
              onClick={() => { setIsMobileMenuOpen(false); onLoginClick(); }}
              className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-primary hover:bg-white/5 transition-colors"
            >
              Login / Register
            </button>
          )}
          {navLinks.map(link => (
              <button 
                key={link.label} 
                onClick={() => handleNavClick(link.target)} 
                className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-text-muted hover:text-white hover:bg-bg-dark transition-colors"
              >
                {link.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </header>
  );
}
