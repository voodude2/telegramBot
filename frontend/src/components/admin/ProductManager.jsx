import React, { useState, useEffect, useMemo } from 'react';
import { API_URL } from '../../lib/api';

const EMPTY_FORM = {
  name: '', price: '', category: 'Smartphone', description: '', image: '', rating: '5', inStock: true,
};

/**
 * Catalogue management. Writes go to the same Google Sheet the AI reads, so a
 * change here immediately changes what the assistant recommends — the reason
 * the form validates before submitting rather than letting the sheet accept
 * anything.
 */
export default function ProductManager({ adminKey, onChanged }) {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState(null);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [stockFilter, setStockFilter] = useState('all');

  const headers = useMemo(
    () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${adminKey}` }),
    [adminKey]
  );

  const request = async (path, options = {}) => {
    const res = await fetch(`${API_URL}/api/admin/products${path}`, { headers, ...options });
    const isJson = (res.headers.get('content-type') || '').includes('application/json');
    const body = isJson ? await res.json() : null;
    if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
    return body;
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [list, cats] = await Promise.all([request(''), request('/categories')]);
      setProducts(list.products || []);
      setSummary(list.summary || null);
      setCategories(cats.categories || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [adminKey]);

  const flash = (message) => {
    setNotice(message);
    setTimeout(() => setNotice(''), 4000);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError('');
  };

  const openEdit = (product) => {
    setEditingId(product.id);
    setForm({
      name: product.name ?? '',
      price: String(product.price ?? ''),
      category: product.category ?? 'Smartphone',
      description: product.description ?? '',
      image: product.image ?? '',
      rating: String(product.rating ?? 5),
      inStock: Boolean(product.inStock),
    });
    setShowForm(true);
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      category: form.category,
      description: form.description.trim(),
      image: form.image.trim(),
      rating: Number(form.rating),
      inStock: form.inStock,
    };

    try {
      const result = editingId
        ? await request(`/${editingId}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await request('', { method: 'POST', body: JSON.stringify(payload) });

      flash(result.message);
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditingId(null);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product) => {
    if (!window.confirm(`Delete "${product.name}"? This removes it from the live catalogue and the AI will stop recommending it.`)) return;
    setSaving(true);
    try {
      const result = await request(`/${product.id}`, { method: 'DELETE' });
      flash(result.message);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleStock = async (product) => {
    setSaving(true);
    try {
      await request(`/${product.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ inStock: !product.inStock }),
      });
      flash(`"${product.name}" marked ${!product.inStock ? 'in stock' : 'out of stock'}`);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const visible = products.filter((p) => {
    if (categoryFilter !== 'All' && p.category !== categoryFilter) return false;
    if (stockFilter === 'in' && !p.inStock) return false;
    if (stockFilter === 'out' && p.inStock) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !(p.description || '').toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

  const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  return (
    <div className="space-y-6">
      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Total products', value: summary.total, icon: '📦' },
            { label: 'In stock', value: summary.inStock, icon: '✅' },
            { label: 'Out of stock', value: summary.outOfStock, icon: '⛔' },
            { label: 'Catalogue value', value: money(summary.inventoryValue), icon: '💰' },
          ].map((card) => (
            <div key={card.label} className="bg-bg-card border border-border-glow rounded-2xl p-5">
              <div className="text-2xl mb-2">{card.icon}</div>
              <div className="text-2xl font-bold text-white">{card.value}</div>
              <div className="text-xs text-text-muted mt-1">{card.label}</div>
            </div>
          ))}
        </div>
      )}

      {notice && (
        <div className="bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 rounded-xl px-4 py-3 text-sm">
          ✅ {notice}
        </div>
      )}
      {error && (
        <div className="bg-rose-500/10 border border-rose-500/40 text-rose-300 rounded-xl px-4 py-3 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products…"
            className="bg-bg-dark border border-border-glow rounded-xl px-4 py-2 text-sm text-white placeholder-text-muted focus:outline-none focus:border-primary min-w-[200px]"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-bg-dark border border-border-glow rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          >
            <option value="All">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value)}
            className="bg-bg-dark border border-border-glow rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-primary"
          >
            <option value="all">Any stock</option>
            <option value="in">In stock</option>
            <option value="out">Out of stock</option>
          </select>
        </div>

        <button
          onClick={openCreate}
          className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-sm hover:opacity-90 transition-opacity whitespace-nowrap"
        >
          + Add product
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-bg-card border border-primary/40 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">
              {editingId ? `Edit product #${editingId}` : 'New product'}
            </h3>
            <button type="button" onClick={() => setShowForm(false)} className="text-text-muted hover:text-white text-sm">
              Cancel
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs text-text-muted">Name *</span>
              <input
                required minLength={2} maxLength={120}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary"
              />
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">Price (USD) *</span>
              <input
                required type="number" min="0" step="0.01"
                value={form.price}
                onChange={(e) => setForm({ ...form, price: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary"
              />
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">Category *</span>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary"
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="text-[11px] text-text-muted mt-1 block">
                Only these categories exist in the AI's search filter.
              </span>
            </label>

            <label className="block">
              <span className="text-xs text-text-muted">Rating (0–5)</span>
              <input
                type="number" min="0" max="5" step="0.1"
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-xs text-text-muted">Image URL</span>
              <input
                type="url" placeholder="https://…"
                value={form.image}
                onChange={(e) => setForm({ ...form, image: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="text-xs text-text-muted">Description</span>
              <textarea
                rows={3} maxLength={1000}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1 w-full bg-bg-dark border border-border-glow rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-primary resize-y"
              />
              <span className="text-[11px] text-text-muted mt-1 block">
                The AI searches this text — describe what a customer would actually ask for.
              </span>
            </label>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.inStock}
              onChange={(e) => setForm({ ...form, inStock: e.target.checked })}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-sm text-white">In stock</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button
              type="submit" disabled={saving}
              className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create product'}
            </button>
          </div>
        </form>
      )}

      {/* Table */}
      <div className="bg-bg-card border border-border-glow rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border-glow flex items-center justify-between">
          <h3 className="font-semibold text-white text-sm">
            Catalogue <span className="text-text-muted font-normal">({visible.length} shown)</span>
          </h3>
          <button onClick={load} className="text-xs text-text-muted hover:text-white">↻ Reload</button>
        </div>

        {loading ? (
          <div className="p-10 text-center text-text-muted text-sm">Loading catalogue…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-text-muted text-sm">No products match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="bg-bg-dark/50 text-text-muted text-xs uppercase tracking-wide">
                <tr>
                  <th className="text-left px-5 py-3 font-medium">#</th>
                  <th className="text-left px-3 py-3 font-medium">Product</th>
                  <th className="text-left px-3 py-3 font-medium">Category</th>
                  <th className="text-right px-3 py-3 font-medium">Price</th>
                  <th className="text-center px-3 py-3 font-medium">Rating</th>
                  <th className="text-center px-3 py-3 font-medium">Stock</th>
                  <th className="text-right px-5 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-glow/50">
                {visible.map((p) => (
                  <tr key={p.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-5 py-3 text-text-muted">{p.id}</td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        {p.image
                          ? <img src={p.image} alt="" className="w-9 h-9 rounded-lg object-cover border border-border-glow" />
                          : <div className="w-9 h-9 rounded-lg bg-bg-dark border border-border-glow grid place-items-center text-xs">📦</div>}
                        <div className="min-w-0">
                          <div className="text-white font-medium truncate max-w-[240px]">{p.name}</div>
                          <div className="text-text-muted text-xs truncate max-w-[240px]">{p.description}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="px-2 py-1 rounded-full bg-primary/15 text-primary text-xs">{p.category}</span>
                    </td>
                    <td className="px-3 py-3 text-right text-white font-medium">{money(p.price)}</td>
                    <td className="px-3 py-3 text-center text-text-muted">{p.rating} ★</td>
                    <td className="px-3 py-3 text-center">
                      <button
                        onClick={() => toggleStock(p)} disabled={saving}
                        title="Toggle availability"
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors disabled:opacity-50 ${
                          p.inStock
                            ? 'bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25'
                            : 'bg-rose-500/15 text-rose-400 hover:bg-rose-500/25'
                        }`}
                      >
                        {p.inStock ? 'In stock' : 'Out'}
                      </button>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(p)} className="text-xs text-text-muted hover:text-white px-2">Edit</button>
                      <button onClick={() => handleDelete(p)} disabled={saving} className="text-xs text-rose-400 hover:text-rose-300 px-2 disabled:opacity-50">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
