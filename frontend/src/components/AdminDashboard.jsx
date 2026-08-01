import React, { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:3000' : 'https://telegrambot-1ufk.onrender.com');

export default function AdminDashboard({ onBack }) {
  // State for all 4 API responses
  const [stats, setStats] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [costs, setCosts] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [memories, setMemories] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [unauthorized, setUnauthorized] = useState(false);
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('techstore_admin_key') || '');
  const [inputKey, setInputKey] = useState('');
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchData = async () => {
    setLoading(true);
    setError(false);
    setUnauthorized(false);
    
    const headers = {};
    if (adminKey) {
      headers['Authorization'] = `Bearer ${adminKey}`;
    }

    try {
      const [statsRes, questionsRes, costsRes, timelineRes, memoriesRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/stats`, { headers }),
        fetch(`${API_URL}/api/admin/questions`, { headers }),
        fetch(`${API_URL}/api/admin/costs`, { headers }),
        fetch(`${API_URL}/api/admin/timeline`, { headers }),
        fetch(`${API_URL}/api/admin/memories`, { headers })
      ]);

      if (statsRes.status === 401 || questionsRes.status === 401) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      if (!statsRes.ok || !questionsRes.ok || !costsRes.ok || !timelineRes.ok || !memoriesRes.ok) {
        throw new Error("Failed to fetch dashboard data");
      }

      const [statsData, questionsData, costsData, timelineData, memoriesData] = await Promise.all([
        statsRes.json(),
        questionsRes.json(),
        costsRes.json(),
        timelineRes.json(),
        memoriesRes.json()
      ]);

      setStats(statsData || { totalChats: 0, uniqueSessions: 0, totalTokens: 0, estimatedCost: 0 });
      setQuestions(questionsData || { questions: [], totalQuestions: 0 });
      setCosts(costsData || { models: {}, tools: {}, tokens: { input: 0, output: 0, cost: 0 } });
      setTimeline(timelineData || { timeline: [] });
      setMemories(memoriesData || []);
    } catch (err) {
      console.error('Error fetching admin dashboard data:', err);
      setError(true);
      // Fallback data structure in case of error to prevent crashes
      setStats({ totalChats: 0, uniqueSessions: 0, totalTokens: 0, estimatedCost: 0 });
      setQuestions({ questions: [], totalQuestions: 0 });
      setCosts({ models: {}, tools: {}, tokens: { input: 0, output: 0, cost: 0 } });
      setTimeline({ timeline: [] });
      setMemories([]);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); // Auto refresh every 30s
    return () => clearInterval(interval);
  }, [adminKey]);

  const handleLogin = (e) => {
    e.preventDefault();
    if (!inputKey.trim()) return;
    localStorage.setItem('techstore_admin_key', inputKey.trim());
    setAdminKey(inputKey.trim());
  };

  const handleLogout = () => {
    localStorage.removeItem('techstore_admin_key');
    setAdminKey('');
    setUnauthorized(true);
  };

  if (unauthorized) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center p-4">
        <div className="bg-bg-card border border-border-glow p-8 rounded-2xl max-w-md w-full shadow-2xl backdrop-blur-md">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔐</div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Admin Access Restricted
            </h2>
            <p className="text-text-muted text-sm mt-2">
              Please enter your ADMIN_API_KEY to access analytics dashboard.
            </p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Admin Security Key</label>
              <input
                type="password"
                value={inputKey}
                onChange={(e) => setInputKey(e.target.value)}
                placeholder="Enter password..."
                className="w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary transition-colors"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white font-bold rounded-xl shadow-lg hover:opacity-90 transition-opacity"
            >
              Unlock Dashboard
            </button>
          </form>
          <div className="mt-6 text-center">
            <button
              onClick={onBack}
              className="text-xs text-text-muted hover:text-white transition-colors"
            >
              ← Back to Store
            </button>
          </div>
        </div>
      </div>
    );
  }

  const handleRefresh = () => {
    fetchData();
  };

  // Safe formatting functions
  const formatNumber = (num) => Number(num || 0).toLocaleString();
  const formatCost = (num) => Number(num || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });

  // Calculate chart metrics
  const maxChats = timeline?.timeline?.length > 0 ? Math.max(...timeline.timeline.map(d => d.chats || 0)) : 0;
  
  // Calculate model metrics
  const modelsData = Object.entries(costs?.models || {});
  const totalModelCalls = modelsData.reduce((acc, [_, count]) => acc + count, 0);

  // Calculate tool metrics
  const toolsData = Object.entries(costs?.tools || {});
  const totalToolCalls = toolsData.reduce((acc, [_, count]) => acc + count, 0);

  const getToolIcon = (name) => {
    const n = name.toLowerCase();
    if (n.includes('search')) return '🔍';
    if (n.includes('policy')) return '📋';
    if (n.includes('cart')) return '🛒';
    return '🔧';
  };

  const getModelColor = (index) => {
    const colors = [
      'from-purple-500 to-indigo-500',
      'from-blue-500 to-cyan-500',
      'from-emerald-500 to-teal-500',
      'from-rose-500 to-pink-500'
    ];
    return colors[index % colors.length];
  };

  return (
    <div className="min-h-screen bg-bg-dark text-white font-sans pb-10">
      
      {/* Header bar */}
      <header className="sticky top-0 z-50 bg-bg-dark/80 backdrop-blur-md border-b border-border-glow px-4 md:px-6 py-4 flex items-center justify-between transition-all">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-text-muted hover:text-white transition-colors cursor-pointer bg-bg-card/50 px-3 py-1.5 md:px-4 md:py-2 rounded-lg border border-border-glow hover:bg-bg-card"
        >
          <span>←</span> <span className="hidden sm:inline">Store</span>
        </button>
        
        <h1 className="text-lg md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary animate-gradient-x">
          📊 Admin Dashboard
        </h1>
        
        <div className="flex items-center gap-3 md:gap-4">
          <span className="text-xs text-text-muted hidden md:inline">
            Last updated: {lastRefresh.toLocaleTimeString()}
          </span>
          <button 
            onClick={handleRefresh}
            disabled={loading}
            className="p-1.5 md:p-2 rounded-lg bg-bg-card border border-border-glow hover:bg-bg-card/80 transition-all text-white flex items-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <span className={loading ? 'animate-spin inline-block' : 'inline-block'}>🔄</span>
            <span className="hidden md:inline">Refresh</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="bg-danger/20 border border-danger/50 text-danger px-6 py-3 text-center text-sm mt-4 mx-4 md:mx-6 rounded-lg backdrop-blur-sm">
          ⚠️ Connection to API failed. Showing cached or default zero values.
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 md:px-6 mt-6 md:mt-8 space-y-6 md:space-y-8 animate-float" style={{animationDuration: '8s'}}>
        
        {/* KPI Cards Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          {/* Card 1: Today's Chats */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-primary/50 transition-all duration-300 group flex flex-col justify-between hover:shadow-[0_0_15px_rgba(108,92,231,0.2)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">💬</span>
              <h3 className="text-text-muted font-medium group-hover:text-white transition-colors">Today's Chats</h3>
            </div>
            {loading && !stats ? (
              <div className="h-10 bg-white/10 rounded animate-pulse w-24"></div>
            ) : (
              <p className="text-3xl md:text-4xl font-bold font-mono">{formatNumber(stats?.totalChats)}</p>
            )}
          </div>

          {/* Card 2: Unique Sessions */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-primary/50 transition-all duration-300 group flex flex-col justify-between hover:shadow-[0_0_15px_rgba(108,92,231,0.2)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">👥</span>
              <h3 className="text-text-muted font-medium group-hover:text-white transition-colors">Unique Sessions</h3>
            </div>
            {loading && !stats ? (
              <div className="h-10 bg-white/10 rounded animate-pulse w-24"></div>
            ) : (
              <p className="text-3xl md:text-4xl font-bold font-mono">{formatNumber(stats?.uniqueSessions)}</p>
            )}
          </div>

          {/* Card 3: Total Tokens */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-primary/50 transition-all duration-300 group flex flex-col justify-between hover:shadow-[0_0_15px_rgba(108,92,231,0.2)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">🔤</span>
              <h3 className="text-text-muted font-medium group-hover:text-white transition-colors">Total Tokens</h3>
            </div>
            {loading && !stats ? (
              <div className="h-10 bg-white/10 rounded animate-pulse w-32"></div>
            ) : (
              <p className="text-3xl md:text-4xl font-bold font-mono text-secondary">{formatNumber(stats?.totalTokens)}</p>
            )}
          </div>

          {/* Card 4: Est. Cost */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-primary/50 transition-all duration-300 group flex flex-col justify-between hover:shadow-[0_0_15px_rgba(108,92,231,0.2)]">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-2xl">💰</span>
              <h3 className="text-text-muted font-medium group-hover:text-white transition-colors">Est. Cost</h3>
            </div>
            {loading && !stats ? (
              <div className="h-10 bg-white/10 rounded animate-pulse w-28"></div>
            ) : (
              <p className="text-3xl md:text-4xl font-bold font-mono text-danger">${formatCost(stats?.estimatedCost)}</p>
            )}
          </div>
        </div>

        {/* Memories / Knowledge Base Section */}
        <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 shadow-lg">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-white/5">
            <span className="text-2xl">🧠</span>
            <h3 className="text-xl font-bold">Autonomous Memory (Mem0)</h3>
            <span className="ml-auto text-xs bg-primary/20 text-primary px-2 py-1 rounded-full border border-primary/30">
              {memories ? memories.length : 0} Facts Stored
            </span>
          </div>
          
          <div className="overflow-x-auto">
            {loading && !memories ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse w-full"></div>)}
              </div>
            ) : memories && memories.length > 0 ? (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs text-text-muted border-b border-white/10 uppercase tracking-wider">
                    <th className="pb-3 pr-4 font-medium">Memory</th>
                    <th className="pb-3 pr-4 font-medium">User ID</th>
                    <th className="pb-3 font-medium text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 text-sm">
                  {memories.map((mem, idx) => (
                    <tr key={mem.id || idx} className="hover:bg-white/5 transition-colors group">
                      <td className="py-3 pr-4 font-medium text-white/90">
                        {mem.memory || mem.content || mem.text}
                      </td>
                      <td className="py-3 pr-4 text-text-muted font-mono text-xs">
                        {mem.user_id || mem.userId || 'System'}
                      </td>
                      <td className="py-3 text-text-muted text-right">
                        {mem.createdAt || mem.created_at ? new Date(mem.createdAt || mem.created_at).toLocaleDateString() : 'Just now'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-text-muted">
                <span className="text-4xl block mb-2 opacity-50">📭</span>
                No memories recorded yet. Talk to the bot to create memories!
              </div>
            )}
          </div>
        </div>

        {/* Main Charts & Lists Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          
          {/* 7-Day Activity Chart */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 flex flex-col h-80 md:h-96 hover:border-border-glow/80 transition-all">
            <h2 className="text-lg md:text-xl font-semibold mb-6 flex items-center gap-2">
              <span>📈</span> 7-Day Activity
            </h2>
            
            <div className="flex-1 flex items-end justify-between gap-2 md:gap-4 relative px-2">
              {loading && !timeline ? (
                <div className="absolute inset-0 flex items-center justify-center animate-pulse text-text-muted">Loading chart data...</div>
              ) : (!timeline?.timeline || timeline.timeline.length === 0 || maxChats === 0) ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-text-muted">
                  <span className="text-4xl mb-2">📊</span>
                  <p>No data yet</p>
                </div>
              ) : (
                timeline.timeline.map((day, idx) => {
                  const heightPercent = maxChats > 0 ? (day.chats / maxChats) * 100 : 0;
                  return (
                    <div key={idx} className="flex flex-col items-center flex-1 h-full justify-end group">
                      <div className="w-full relative flex justify-center h-full items-end pb-8">
                        {/* Tooltip */}
                        <div className="absolute bottom-full mb-2 opacity-0 group-hover:opacity-100 transition-opacity bg-bg-dark border border-border-glow p-3 rounded-xl text-xs w-max max-w-[150px] z-10 pointer-events-none shadow-xl transform translate-y-2 group-hover:translate-y-0 duration-200">
                          <p className="font-bold text-white mb-1">{day.label}</p>
                          <p className="text-text-muted">Chats: <span className="font-mono text-primary font-medium">{day.chats}</span></p>
                          <p className="text-text-muted">Sessions: <span className="font-mono text-white font-medium">{day.sessions}</span></p>
                          <p className="text-text-muted">Cost: <span className="font-mono text-danger font-medium">${formatCost(day.cost)}</span></p>
                        </div>
                        {/* Bar */}
                        <div 
                          className="w-full max-w-[40px] bg-gradient-to-t from-primary to-secondary rounded-t-md transition-all duration-700 ease-out min-h-[4px] opacity-80 group-hover:opacity-100 group-hover:shadow-[0_0_15px_rgba(108,92,231,0.5)]"
                          style={{ height: `${heightPercent}%` }}
                        ></div>
                        {/* Label */}
                        <span className="absolute bottom-0 text-[10px] md:text-xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full text-center">
                          {day.label ? day.label.split(' ')[0] : ''}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Top Questions */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 flex flex-col h-80 md:h-96 hover:border-border-glow/80 transition-all">
            <h2 className="text-lg md:text-xl font-semibold mb-6 flex items-center gap-2">
              <span>❓</span> Top Questions Today
            </h2>
            
            <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
              {loading && !questions ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 bg-white/5 rounded-lg animate-pulse w-full"></div>
                ))
              ) : (!questions?.questions || questions.questions.length === 0) ? (
                <div className="h-full flex flex-col items-center justify-center text-text-muted">
                  <span className="text-4xl mb-2 opacity-70">🤷</span>
                  <p>No questions recorded today</p>
                </div>
              ) : (
                questions.questions.slice(0, 15).map((q, idx) => (
                  <div key={idx} className="flex items-center gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-transparent hover:border-border-glow group">
                    <span className="text-text-muted font-mono w-6 text-right group-hover:text-white transition-colors">{idx + 1}.</span>
                    <p className="flex-1 truncate text-sm md:text-base" title={q.question}>{q.question}</p>
                    <span className="bg-primary/20 text-primary px-2 py-0.5 rounded-full text-xs font-mono font-medium border border-primary/30">
                      {q.count}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

        </div>

        {/* Bottom Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          
          {/* Model Usage */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-border-glow/80 transition-all">
            <h2 className="text-lg md:text-xl font-semibold mb-6 flex items-center gap-2">
              <span>🤖</span> Model Usage
            </h2>
            
            <div className="space-y-6">
              {loading && !costs ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <div className="h-4 bg-white/10 rounded w-1/4 animate-pulse"></div>
                    <div className="h-4 bg-white/5 rounded-full animate-pulse w-full"></div>
                  </div>
                ))
              ) : modelsData.length === 0 ? (
                <p className="text-text-muted italic">No model usage data recorded.</p>
              ) : (
                modelsData.sort((a, b) => b[1] - a[1]).map(([model, count], idx) => {
                  const percent = totalModelCalls > 0 ? (count / totalModelCalls) * 100 : 0;
                  return (
                    <div key={model} className="space-y-2 group">
                      <div className="flex justify-between text-sm md:text-base">
                        <span className="font-medium text-white/90 group-hover:text-white transition-colors">{model}</span>
                        <div className="flex gap-4 text-text-muted font-mono">
                          <span>{formatNumber(count)} calls</span>
                          <span className="text-white w-12 text-right">{percent.toFixed(1)}%</span>
                        </div>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-2.5 md:h-3 overflow-hidden shadow-inner">
                        <div 
                          className={`h-full bg-gradient-to-r ${getModelColor(idx)} rounded-full transition-all duration-1000 ease-out`}
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Tool Usage */}
          <div className="bg-bg-card/50 backdrop-blur-sm border border-border-glow rounded-2xl p-5 md:p-6 hover:border-border-glow/80 transition-all">
            <h2 className="text-lg md:text-xl font-semibold mb-6 flex items-center gap-2">
              <span>🔧</span> Tool Usage
            </h2>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {loading && !costs ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="bg-white/5 border border-white/5 rounded-xl p-4 animate-pulse h-24"></div>
                ))
              ) : toolsData.length === 0 ? (
                <p className="text-text-muted italic col-span-1 sm:col-span-2">No tool usage data recorded.</p>
              ) : (
                toolsData.sort((a, b) => b[1] - a[1]).map(([tool, count]) => {
                  const percent = totalToolCalls > 0 ? (count / totalToolCalls) * 100 : 0;
                  return (
                    <div key={tool} className="bg-bg-dark/60 border border-border-glow rounded-xl p-4 hover:bg-bg-dark hover:border-secondary/50 transition-all group duration-300">
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-white/90 group-hover:text-white">
                          <span className="text-lg">{getToolIcon(tool)}</span>
                          <span className="truncate" title={tool}>{tool}</span>
                        </div>
                        <span className="text-lg md:text-xl font-bold font-mono text-secondary">{formatNumber(count)}</span>
                      </div>
                      <div className="w-full bg-white/5 rounded-full h-1.5 overflow-hidden">
                        <div 
                          className="h-full bg-secondary rounded-full transition-all duration-1000 ease-out"
                          style={{ width: `${percent}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
