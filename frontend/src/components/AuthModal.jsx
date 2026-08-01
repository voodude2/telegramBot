import { useState } from 'react';

export default function AuthModal({ isOpen, onClose, onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: ''
  });

  if (!isOpen) return null;

  const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://telegrambot-1ufk.onrender.com');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const payload = isLogin 
      ? { email: formData.email, password: formData.password }
      : formData;

    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      let data;
      const contentType = res.headers.get("content-type");
      if (contentType && contentType.indexOf("application/json") !== -1) {
        data = await res.json();
      } else {
        data = { error: `Server error: ${res.status}` };
      }
      
      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      localStorage.setItem('techstore_token', data.token);
      onLoginSuccess(data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-bg-card/90 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl animate-fade-in-up">
        
        {/* Close Button */}
        <button onClick={onClose} className="absolute top-4 right-4 text-white/50 hover:text-white transition-colors">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold mb-2">{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p className="text-text-muted text-sm">
            {isLogin ? 'Log in to access your personal AI assistant' : 'Join TechStore for a personalized experience'}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger/20 border border-danger/50 text-danger rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <div>
              <label className="block text-sm text-text-muted mb-1">Name</label>
              <input 
                type="text" 
                required 
                value={formData.name}
                onChange={e => setFormData({...formData, name: e.target.value})}
                className="w-full bg-bg-dark/50 border border-white/10 rounded-lg px-4 py-2.5 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-white placeholder-white/30 transition-all"
                placeholder="John Doe"
              />
            </div>
          )}
          
          <div>
            <label className="block text-sm text-text-muted mb-1">Email</label>
            <input 
              type="email" 
              required 
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
              className="w-full bg-bg-dark/50 border border-white/10 rounded-lg px-4 py-2.5 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-white placeholder-white/30 transition-all"
              placeholder="alex@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-text-muted mb-1">Password</label>
            <input 
              type="password" 
              required 
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
              className="w-full bg-bg-dark/50 border border-white/10 rounded-lg px-4 py-2.5 focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/50 text-white placeholder-white/30 transition-all"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-primary hover:bg-primary-hover text-white font-medium py-2.5 rounded-lg transition-all duration-300 mt-6 shadow-lg shadow-primary/20 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-text-muted">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-primary hover:text-white transition-colors underline decoration-primary/30 underline-offset-4"
          >
            {isLogin ? 'Sign up' : 'Log in'}
          </button>
        </div>
      </div>
    </div>
  );
}
