import { useState, useEffect, useRef } from 'react';

export default function AIChatWidget({ isOpen, setIsOpen }) {
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      text: "Hello! 👋 I'm TechStore's AI Consultant. How can I help you today?\n\n(გამარჯობა! 👋 მე ვარ TechStore-ის AI კონსულტანტი. შემიძლია გიპასუხოთ ნებისმიერ ენაზე!)",
      sender: 'assistant',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');

  const messagesEndRef = useRef(null);

  // Initialize persistent session ID
  useEffect(() => {
    let savedSession = localStorage.getItem('techstore_ai_session');
    if (!savedSession) {
      savedSession = `web_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      localStorage.setItem('techstore_ai_session', savedSession);
    }
    setSessionId(savedSession);
  }, []);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading, isOpen]);

  const handleSend = async (textToSend) => {
    const messageText = textToSend || inputValue.trim();
    if (!messageText || loading) return;

    const userMsg = {
      id: `user_${Date.now()}`,
      text: messageText,
      sender: 'user',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    if (!textToSend) setInputValue('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageText,
          sessionId: sessionId
        })
      });

      if (!response.ok) throw new Error('Network response was not ok');
      const data = await response.json();

      const aiMsg = {
        id: `ai_${Date.now()}`,
        text: data.reply || 'Sorry, I could not generate a response.',
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err) {
      console.error('Error sending message:', err);
      const errorMsg = {
        id: `err_${Date.now()}`,
        text: 'Sorry, a technical error occurred connecting to the AI server.',
        sender: 'assistant',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    "💻 What laptops do you have?",
    "🎧 Show audio headphones",
    "📦 Which items are in stock?",
    "⚡ Any webcams available?"
  ];

  return (
    <>
      {/* Floating Toggle Button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 p-4 rounded-full bg-gradient-to-r from-primary to-secondary text-white shadow-2xl hover:scale-110 active:scale-95 transition-all duration-300 group flex items-center gap-2 cursor-pointer border border-white/20"
          aria-label="Open AI Assistant"
        >
          <span className="text-2xl animate-bounce">🤖</span>
          <span className="hidden sm:inline font-bold text-sm">AI Assistant</span>
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
            <span className="relative inline-flex rounded-full h-4 w-4 bg-secondary"></span>
          </span>
        </button>
      )}

      {/* Chat Window Modal / Drawer */}
      {isOpen && (
        <div className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-[420px] h-[580px] max-h-[85vh] bg-bg-dark/95 backdrop-blur-xl border border-border-glow rounded-3xl shadow-[0_10px_50px_rgba(0,0,0,0.5)] flex flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300">
          {/* Header */}
          <div className="p-4 bg-gradient-to-r from-bg-card to-bg-dark border-b border-border-glow flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="relative w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-secondary flex items-center justify-center text-xl shadow-md">
                🤖
                <span className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-bg-dark"></span>
              </div>
              <div>
                <h3 className="font-bold text-white text-base leading-tight">TechStore AI</h3>
                <p className="text-xs text-text-muted flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                  Live Catalog Consultant
                </p>
              </div>
            </div>
            
            <button
              onClick={() => setIsOpen(false)}
              className="p-2 text-text-muted hover:text-white hover:bg-white/10 rounded-full transition-colors cursor-pointer"
              aria-label="Close Chat"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages Container */}
          <div className="flex-1 p-4 overflow-y-auto space-y-4 text-sm scrollbar-thin">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 whitespace-pre-wrap leading-relaxed shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-r from-primary to-secondary text-white rounded-br-none font-medium'
                      : 'bg-bg-card border border-border-glow text-gray-200 rounded-bl-none'
                  }`}
                >
                  {msg.text}
                </div>
                <span className="text-[10px] text-text-muted mt-1 px-1">{msg.timestamp}</span>
              </div>
            ))}

            {loading && (
              <div className="flex items-start">
                <div className="bg-bg-card border border-border-glow rounded-2xl rounded-bl-none px-4 py-3 text-text-muted flex items-center space-x-2">
                  <span className="text-xs">AI is thinking</span>
                  <span className="flex space-x-1">
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Action Suggestions */}
          {messages.length < 4 && !loading && (
            <div className="px-4 py-2 border-t border-border-glow/50 bg-bg-card/30 flex flex-wrap gap-1.5">
              {quickPrompts.map((prompt, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(prompt)}
                  className="text-xs bg-bg-card hover:bg-primary/20 hover:border-primary border border-border-glow text-text-muted hover:text-white px-2.5 py-1.5 rounded-full transition-all duration-200 cursor-pointer"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="p-3 bg-bg-card border-t border-border-glow flex items-center space-x-2"
          >
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything about products..."
              className="flex-1 bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-sm text-white placeholder-text-muted focus:outline-none focus:border-primary transition-colors"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!inputValue.trim() || loading}
              className="p-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white disabled:opacity-40 hover:opacity-90 active:scale-95 transition-all cursor-pointer flex-shrink-0"
            >
              <svg className="w-5 h-5 transform rotate-90" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
