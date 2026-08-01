/**
 * Minimal LRU cache with optional per-entry TTL.
 *
 * Used for the in-process fallbacks (chat history when Redis is down, RAG query
 * embeddings). The bound is the point: an unbounded Map here is a memory leak
 * that only shows up during an outage, which is the worst time to find it.
 */
class LruCache {
  constructor({ max = 500, ttlMs = 0 } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, {
      value,
      expiresAt: this.ttlMs > 0 ? Date.now() + this.ttlMs : 0,
    });
    while (this.map.size > this.max) {
      // Map preserves insertion order, so the first key is the least recently used.
      this.map.delete(this.map.keys().next().value);
    }
  }

  delete(key) {
    return this.map.delete(key);
  }

  get size() {
    return this.map.size;
  }
}

module.exports = { LruCache };
