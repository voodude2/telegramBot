import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../lib/api';
import ProductManager from './admin/ProductManager';

const TABS = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'products', label: 'Products', icon: '📦' },
  { id: 'conversations', label: 'Conversations', icon: '💬' },
  { id: 'ai', label: 'AI & Cost', icon: '✨' },
  { id: 'memory', label: 'Memory', icon: '🧠' },
  { id: 'system', label: 'System', icon: '⚙️' },
];

const num = (n) => Number(n || 0).toLocaleString();
const money = (n, digits = 4) =>
  `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function StatCard({ icon, label, value, sub, accent = 'from-primary to-secondary' }) {
  return (
    <div className="bg-bg-card border border-border-glow rounded-2xl p-5 relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accent}`} />
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-2xl font-bold text-white leading-tight">{value}</div>
      <div className="text-xs text-text-muted mt-1">{label}</div>
      {sub && <div className="text-[11px] text-text-muted/70 mt-2">{sub}</div>}
    </div>
  );
}

function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <div className={`bg-bg-card border border-border-glow rounded-2xl ${className}`}>
      <div className="px-5 py-4 border-b border-border-glow flex items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-white text-sm">{title}</h3>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function Empty({ children }) {
  return <div className="text-center py-8 text-text-muted text-sm">{children}</div>;
}

/** Horizontal bar list used for models, tools and platforms. */
function BarList({ items, total, colorFor }) {
  if (!items.length) return <Empty>No data recorded yet today.</Empty>;
  return (
    <div className="space-y-3">
      {items.map(([label, count], i) => {
        const pct = total > 0 ? (count / total) * 100 : 0;
        return (
          <div key={label}>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-white truncate pr-2">{label}</span>
              <span className="text-text-muted whitespace-nowrap">
                {num(count)} · {pct.toFixed(0)}%
              </span>
            </div>
            <div className="h-2 bg-bg-dark rounded-full overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${colorFor(i)} rounded-full transition-all duration-500`}
                style={{ width: `${Math.max(pct, 2)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminDashboard({ onBack }) {
  const [stats, setStats] = useState(null);
  const [questions, setQuestions] = useState(null);
  const [costs, setCosts] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [memories, setMemories] = useState(null);
  const [health, setHealth] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem('techstore_admin_key') || '');
  const [inputKey, setInputKey] = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tab, setTab] = useState('overview');
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    setError('');
    const headers = adminKey ? { Authorization: `Bearer ${adminKey}` } : {};
    const get = (p) => fetch(`${API_URL}${p}`, { headers });

    try {
      const responses = await Promise.all([
        get('/api/admin/stats'),
        get('/api/admin/questions'),
        get('/api/admin/costs'),
        get('/api/admin/timeline'),
        get('/api/admin/memories'),
        get('/api/admin/health'),
      ]);

      if (responses.some((r) => r.status === 401 || r.status === 503)) {
        setUnauthorized(true);
        return;
      }
      if (responses.some((r) => !r.ok)) throw new Error('Failed to load dashboard data');

      const [s, q, c, t, m, h] = await Promise.all(responses.map((r) => r.json()));
      setStats(s); setQuestions(q); setCosts(c); setTimeline(t);
      setMemories(Array.isArray(m) ? m : []); setHealth(h);
      setUnauthorized(false);
    } catch (err) {
      console.error('Admin dashboard:', err);
      setError(err.message);
    } finally {
      setLoading(false);
      setLastRefresh(new Date());
    }
  }, [adminKey]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const adminAction = async (path, method, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}${path}`, {
        method,
        headers: { Authorization: `Bearer ${adminKey}` },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Action failed');
      await fetchData();
      return body;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // ── Auth gate ─────────────────────────────────────────────────────────────
  if (unauthorized) {
    return (
      <div className="min-h-screen bg-bg-dark text-white flex items-center justify-center p-4">
        <div className="bg-bg-card border border-border-glow p-8 rounded-2xl max-w-md w-full shadow-2xl">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔐</div>
            <h2 className="text-2xl font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Admin Access
            </h2>
            <p className="text-text-muted text-sm mt-2">
              Enter your ADMIN_API_KEY to open the dashboard.
            </p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!inputKey.trim()) return;
              localStorage.setItem('techstore_admin_key', inputKey.trim());
              setAdminKey(inputKey.trim());
              setUnauthorized(false);
              setLoading(true);
            }}
            className="space-y-4"
          >
            <input
              type="password" autoFocus value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="Admin key…"
              className="w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-3 text-white focus:outline-none focus:border-primary"
            />
            <button type="submit" className="w-full py-3 bg-gradient-to-r from-primary to-secondary text-white font-bold rounded-xl hover:opacity-90 transition-opacity">
              Unlock dashboard
            </button>
          </form>
          <button onClick={onBack} className="mt-6 w-full text-xs text-text-muted hover:text-white transition-colors">
            ← Back to store
          </button>
        </div>
      </div>
    );
  }

  if (loading && !stats) {
    return (
      <div className="min-h-screen bg-bg-dark text-white grid place-items-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mx-auto mb-4" />
          <p className="text-text-muted text-sm">Loading dashboard…</p>
        </div>
      </div>
    );
  }

  const modelEntries = Object.entries(costs?.models || {}).sort((a, b) => b[1] - a[1]);
  const toolEntries = Object.entries(costs?.tools || {}).sort((a, b) => b[1] - a[1]);
  const platformEntries = Object.entries(stats?.platforms || {}).sort((a, b) => b[1] - a[1]);
  const totalModelCalls = modelEntries.reduce((a, [, n]) => a + Number(n), 0);
  const totalToolCalls = toolEntries.reduce((a, [, n]) => a + Number(n), 0);
  const totalPlatform = platformEntries.reduce((a, [, n]) => a + Number(n), 0);

  const days = timeline?.timeline || [];
  const maxChats = Math.max(1, ...days.map((d) => d.chats || 0));
  const weekChats = days.reduce((a, d) => a + (d.chats || 0), 0);
  const weekCost = days.reduce((a, d) => a + (d.cost || 0), 0);
  const weekTokens = days.reduce((a, d) => a + (d.tokens || 0), 0);

  const gradient = (i) => [
    'from-purple-500 to-indigo-500',
    'from-blue-500 to-cyan-500',
    'from-emerald-500 to-teal-500',
    'from-amber-500 to-orange-500',
    'from-rose-500 to-pink-500',
  ][i % 5];

  const avgCostPerChat = stats?.totalChats > 0
    ? Number(stats.estimatedCost) / Number(stats.totalChats)
    : 0;

  return (
    <div className="min-h-screen bg-bg-dark text-white font-sans pb-12">
      <header className="sticky top-0 z-50 bg-bg-dark/90 backdrop-blur-md border-b border-border-glow">
        <div className="px-4 md:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl">⚡</span>
            <div className="min-w-0">
              <h1 className="font-bold text-white leading-tight truncate">TechStore Admin</h1>
              <p className="text-[11px] text-text-muted">
                {lastRefresh ? `Updated ${lastRefresh.toLocaleTimeString()}` : 'Loading…'}
                {health?.nodeEnv && ` · ${health.nodeEnv}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={fetchData} disabled={busy}
              className="px-3 py-2 text-xs rounded-lg border border-border-glow text-text-muted hover:text-white hover:border-primary/50 transition-colors disabled:opacity-50">
              ↻ Refresh
            </button>
            <button onClick={onBack}
              className="px-3 py-2 text-xs rounded-lg border border-border-glow text-text-muted hover:text-white transition-colors">
              ← Store
            </button>
            <button onClick={() => { localStorage.removeItem('techstore_admin_key'); setAdminKey(''); setUnauthorized(true); }}
              className="px-3 py-2 text-xs rounded-lg text-rose-400 hover:bg-rose-500/10 transition-colors">
              Sign out
            </button>
          </div>
        </div>

        <nav className="px-4 md:px-6 flex gap-1 overflow-x-auto scrollbar-thin">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-primary text-white font-medium'
                  : 'border-transparent text-text-muted hover:text-white'
              }`}>
              <span className="mr-1.5">{t.icon}</span>{t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="px-4 md:px-6 pt-6 max-w-7xl mx-auto space-y-6">
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/40 text-rose-300 rounded-xl px-4 py-3 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* ── Overview ────────────────────────────────────────────────── */}
        {tab === 'overview' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon="💬" label="Conversations today" value={num(stats?.totalChats)}
                sub={`${num(weekChats)} in the last 7 days`} />
              <StatCard icon="👥" label="Unique sessions today" value={num(stats?.uniqueSessions)}
                accent="from-blue-500 to-cyan-500" />
              <StatCard icon="🔢" label="Tokens today" value={num(stats?.totalTokens)}
                sub={`${num(stats?.inputTokens)} in · ${num(stats?.outputTokens)} out`}
                accent="from-emerald-500 to-teal-500" />
              <StatCard icon="💰" label="Estimated cost today" value={money(stats?.estimatedCost)}
                sub={`≈ ${money(avgCostPerChat, 5)} per conversation`}
                accent="from-amber-500 to-orange-500" />
            </div>

            <Panel title="7-day activity"
              subtitle={`${num(weekChats)} conversations · ${num(weekTokens)} tokens · ${money(weekCost)} estimated`}>
              {days.length === 0 ? <Empty>No timeline data yet.</Empty> : (
                <div className="flex items-end justify-between gap-2 h-48">
                  {days.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center gap-2 group">
                      <div className="w-full flex-1 flex items-end">
                        <div
                          className="w-full bg-gradient-to-t from-primary to-secondary rounded-t-lg transition-all duration-500 relative group-hover:opacity-80 min-h-[4px]"
                          style={{ height: `${((d.chats || 0) / maxChats) * 100}%` }}
                        >
                          <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-bg-card border border-border-glow rounded-lg px-2 py-1 text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                            {num(d.chats)} chats · {money(d.cost)}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-text-muted text-center leading-tight">{d.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title="Channels" subtitle="Where conversations came from today">
                <BarList items={platformEntries} total={totalPlatform} colorFor={gradient} />
              </Panel>
              <Panel title="Tool usage" subtitle={`${num(totalToolCalls)} tool calls today`}>
                <BarList items={toolEntries} total={totalToolCalls} colorFor={gradient} />
              </Panel>
            </div>
          </>
        )}

        {/* ── Products ────────────────────────────────────────────────── */}
        {tab === 'products' && <ProductManager adminKey={adminKey} onChanged={fetchData} />}

        {/* ── Conversations ───────────────────────────────────────────── */}
        {tab === 'conversations' && (
          <Panel title="Most asked questions today"
            subtitle={`${num(questions?.totalQuestions)} messages recorded · what customers actually want`}>
            {!questions?.questions?.length ? <Empty>No questions recorded yet today.</Empty> : (
              <div className="space-y-2">
                {questions.questions.map((q, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-bg-dark/50 hover:bg-bg-dark transition-colors">
                    <span className="text-xs text-text-muted w-6 shrink-0 pt-0.5">#{i + 1}</span>
                    <p className="text-sm text-white flex-1 break-words">{q.question}</p>
                    <span className="text-xs px-2 py-1 rounded-full bg-primary/15 text-primary shrink-0">
                      ×{q.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        {/* ── AI & Cost ───────────────────────────────────────────────── */}
        {tab === 'ai' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon="📥" label="Input tokens today" value={num(costs?.tokens?.input)} />
              <StatCard icon="📤" label="Output tokens today" value={num(costs?.tokens?.output)}
                accent="from-blue-500 to-cyan-500" />
              <StatCard icon="🤖" label="Model calls today" value={num(totalModelCalls)}
                accent="from-emerald-500 to-teal-500" />
              <StatCard icon="💵" label="Cost today" value={money(costs?.tokens?.cost)}
                accent="from-amber-500 to-orange-500" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title="Model usage" subtitle="Which model answered, via the fallback chain">
                <BarList items={modelEntries} total={totalModelCalls} colorFor={gradient} />
              </Panel>
              <Panel title="Tool calls" subtitle="What the agent reached for">
                <BarList items={toolEntries} total={totalToolCalls} colorFor={gradient} />
              </Panel>
            </div>

            <Panel title="Knowledge base" subtitle="Policy passages indexed from the FAQ_Policies sheet"
              action={
                <button onClick={() => adminAction('/api/admin/rag/refresh', 'POST')} disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-lg border border-border-glow text-text-muted hover:text-white hover:border-primary/50 transition-colors disabled:opacity-50">
                  {busy ? 'Reindexing…' : '↻ Reindex'}
                </button>
              }>
              <div className="flex items-center gap-3">
                <span className="text-3xl font-bold text-white">{num(health?.ragPolicies)}</span>
                <span className="text-sm text-text-muted">
                  policies embedded. Edit the sheet, then reindex to publish changes without a redeploy.
                </span>
              </div>
              <p className="text-[11px] text-text-muted/70 mt-3">
                Costs shown throughout are estimates from a configurable rate table, not billed amounts.
              </p>
            </Panel>
          </>
        )}

        {/* ── Memory ──────────────────────────────────────────────────── */}
        {tab === 'memory' && (
          <Panel title="Long-term customer memory"
            subtitle={`${num(memories?.length)} facts remembered by Mem0`}
            action={
              memories?.length > 0 && (
                <button
                  onClick={() => adminAction('/api/admin/memories', 'DELETE',
                    'Clear ALL long-term memories? Customers will lose their remembered preferences. This cannot be undone.')}
                  disabled={busy}
                  className="px-3 py-1.5 text-xs rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50">
                  Clear all
                </button>
              )
            }>
            {!memories?.length ? (
              <Empty>
                {health?.mem0 === false
                  ? 'Mem0 is not configured — set MEM0_API_KEY to enable long-term memory.'
                  : 'No memories extracted yet. They appear after real conversations.'}
              </Empty>
            ) : (
              <div className="space-y-2 max-h-[520px] overflow-y-auto scrollbar-thin">
                {memories.map((m, i) => (
                  <div key={m.id || i} className="p-3 rounded-xl bg-bg-dark/50 border border-border-glow/50">
                    <p className="text-sm text-white break-words">{m.memory || m.content || '—'}</p>
                    <div className="flex flex-wrap gap-2 mt-2 text-[11px] text-text-muted">
                      {m.user_id && <span className="px-2 py-0.5 rounded bg-primary/10">{m.user_id}</span>}
                      {m.created_at && <span>{new Date(m.created_at).toLocaleString()}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        )}

        {/* ── System ──────────────────────────────────────────────────── */}
        {tab === 'system' && (
          <>
            <Panel title="Service health" subtitle="Live dependency status">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Redis (sessions, analytics, accounts)', health?.redis],
                  ['Google Sheets (catalogue, policies)', health?.sheets],
                  ['Mem0 (long-term memory)', health?.mem0],
                  ['RAG index built', (health?.ragPolicies ?? 0) > 0],
                ].map(([label, ok]) => (
                  <div key={label} className="flex items-center justify-between p-3 rounded-xl bg-bg-dark/50 border border-border-glow/50">
                    <span className="text-sm text-white">{label}</span>
                    <span className={`text-xs px-2.5 py-1 rounded-full ${
                      ok ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                    }`}>
                      {ok ? 'Connected' : 'Unavailable'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Panel title="Configuration" subtitle="Read-only, from server environment">
                <dl className="space-y-3 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-muted">Environment</dt>
                    <dd className="text-white">{health?.nodeEnv || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-muted">Uptime</dt>
                    <dd className="text-white">
                      {health?.uptimeSeconds != null
                        ? `${Math.floor(health.uptimeSeconds / 3600)}h ${Math.floor((health.uptimeSeconds % 3600) / 60)}m`
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-muted">Interface language</dt>
                    <dd className="text-white uppercase">{health?.uiLocale || '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-text-muted">Understood languages</dt>
                    <dd className="text-white uppercase">{(health?.locales || []).join(', ') || '—'}</dd>
                  </div>
                </dl>
              </Panel>

              <Panel title="Model fallback chain" subtitle="Tried in order until one responds">
                {!health?.models?.length ? <Empty>Not configured.</Empty> : (
                  <ol className="space-y-2">
                    {health.models.map((m, i) => (
                      <li key={m} className="flex items-center gap-3 p-2.5 rounded-xl bg-bg-dark/50">
                        <span className="w-6 h-6 rounded-full bg-primary/15 text-primary text-xs grid place-items-center shrink-0">
                          {i + 1}
                        </span>
                        <code className="text-xs text-white truncate">{m}</code>
                        {costs?.models?.[m] && (
                          <span className="ml-auto text-[11px] text-emerald-400 shrink-0">
                            {num(costs.models[m])} calls today
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            </div>

            <Panel title="Maintenance">
              <div className="flex flex-wrap gap-3">
                <button onClick={() => adminAction('/api/products/refresh', 'POST')} disabled={busy}
                  className="px-4 py-2.5 text-sm rounded-xl border border-border-glow text-text-muted hover:text-white hover:border-primary/50 transition-colors disabled:opacity-50">
                  ↻ Refresh product cache
                </button>
                <button onClick={() => adminAction('/api/admin/rag/refresh', 'POST')} disabled={busy}
                  className="px-4 py-2.5 text-sm rounded-xl border border-border-glow text-text-muted hover:text-white hover:border-primary/50 transition-colors disabled:opacity-50">
                  ↻ Reindex knowledge base
                </button>
              </div>
              <p className="text-[11px] text-text-muted/70 mt-4">
                Catalogue edits made in the Products tab refresh automatically. Use these after editing
                the Google Sheet directly.
              </p>
            </Panel>
          </>
        )}
      </main>
    </div>
  );
}
