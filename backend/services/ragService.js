const { GoogleGenAI } = require('@google/genai');
const config = require('../config');
const { LruCache } = require('../lib/lruCache');
const { loadSheet } = require('./googleSheets');

/**
 * In-memory vector RAG over the FAQ_Policies sheet.
 *
 * Behaviour worth knowing about:
 *  - initializeRAG() is idempotent and returns a promise every caller can await,
 *    so a request arriving during a cold start waits for the index instead of
 *    silently answering "no policy found".
 *  - Embeddings are generated with bounded concurrency, and a single failure no
 *    longer discards the whole knowledge base — the policies that did embed stay
 *    usable.
 *  - Query embeddings are cached; policy questions repeat constantly and each
 *    miss is a paid API call.
 *
 * SCALING NOTE: the index lives in this process, so every instance re-embeds the
 * sheet at boot and holds its own copy. Fine at this size; move the vectors to
 * Redis or pgvector keyed by content hash before scaling out horizontally.
 */

const ai = config.gemini.apiKey ? new GoogleGenAI({ apiKey: config.gemini.apiKey }) : null;

let policyKnowledgeBase = [];
let initPromise = null;
let refreshTimer = null;

const queryEmbeddingCache = new LruCache({
  max: config.rag.queryCacheSize,
  ttlMs: 60 * 60 * 1000,
});

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embed(text) {
  if (!ai) throw new Error('GEMINI_API_KEY is not configured');
  const response = await ai.models.embedContent({
    model: config.gemini.embeddingModel,
    contents: text,
  });
  const values = response?.embeddings?.[0]?.values;
  if (!Array.isArray(values)) throw new Error('Embedding response contained no vector');
  return values;
}

async function embedQuery(text) {
  const cached = queryEmbeddingCache.get(text);
  if (cached) return cached;
  const vector = await embed(text);
  queryEmbeddingCache.set(text, vector);
  return vector;
}

/** Runs `worker` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function pump() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, pump));
  return results;
}

async function fetchPolicies() {
  const rows = await loadSheet({ title: config.google.policySheetTitle });
  if (!rows) return [];

  return rows
    .map((row) => ({
      question: (row.get('Question') || '').trim(),
      answer: (row.get('Answer') || '').trim(),
    }))
    .filter((policy) => policy.question && policy.answer);
}

async function buildIndex() {
  console.log('⏳ [RAG] Fetching policies from Google Sheets...');
  const policies = await fetchPolicies();

  if (policies.length === 0) {
    console.log('ℹ️  [RAG] No policies found. Knowledge base is empty.');
    policyKnowledgeBase = [];
    return;
  }

  let failures = 0;
  const embedded = await mapWithConcurrency(policies, config.rag.embedConcurrency, async (policy) => {
    try {
      const embedding = await embed(`Question: ${policy.question}\nAnswer: ${policy.answer}`);
      return { ...policy, embedding };
    } catch (err) {
      // Tolerate partial failure: one bad row should not blank the whole index.
      failures += 1;
      console.warn(`⚠️  [RAG] Could not embed "${policy.question}":`, err.message);
      return null;
    }
  });

  const nextIndex = embedded.filter(Boolean);

  if (nextIndex.length === 0) {
    console.error('❌ [RAG] Every policy failed to embed. Keeping the previous index.');
    return;
  }

  // Swap atomically so in-flight lookups never observe a half-built index.
  policyKnowledgeBase = nextIndex;
  console.log(
    `✅ [RAG] Indexed ${nextIndex.length}/${policies.length} policies` +
      (failures ? ` (${failures} failed)` : '') +
      `, ${nextIndex[0].embedding.length}-dimension vectors.`
  );
}

/**
 * Builds the index once. Concurrent callers share the same promise, and a failed
 * attempt is not cached so a later request can retry.
 */
function initializeRAG() {
  if (!initPromise) {
    initPromise = buildIndex().catch((err) => {
      console.error('❌ [RAG] Initialization failed:', err.message);
      initPromise = null;
    });

    if (config.rag.refreshIntervalMs > 0 && !refreshTimer) {
      refreshTimer = setInterval(() => {
        buildIndex().catch((err) => console.warn('⚠️  [RAG] Refresh failed:', err.message));
      }, config.rag.refreshIntervalMs);
      refreshTimer.unref(); // never hold the process open
    }
  }
  return initPromise;
}

/** Rebuilds the index on demand (used by the admin refresh route). */
async function refreshRAG() {
  await buildIndex();
  return policyKnowledgeBase.length;
}

/**
 * Finds the policy best matching a query.
 *
 * Returns a structured result rather than a string. The old version returned
 * either prose or a JSON-encoded error string, and because that error string is
 * truthy, callers used it as a reply — customers were shown a literal
 * `{"error":"No relevant policy found"}`.
 *
 * @returns {Promise<{found: boolean, question?: string, answer?: string, score?: number}>}
 */
async function findRelevantPolicy(userQuery) {
  // Wait for a cold-start index rather than reporting a false negative.
  await initializeRAG();

  if (policyKnowledgeBase.length === 0 || !userQuery) {
    return { found: false };
  }

  let queryEmbedding;
  try {
    queryEmbedding = await embedQuery(userQuery);
  } catch (err) {
    console.warn('⚠️  [RAG] Could not embed query:', err.message);
    return { found: false };
  }

  let best = null;
  let bestScore = -1;
  for (const policy of policyKnowledgeBase) {
    const score = cosineSimilarity(queryEmbedding, policy.embedding);
    if (score > bestScore) {
      bestScore = score;
      best = policy;
    }
  }

  if (best && bestScore > config.rag.similarityThreshold) {
    console.log(`🔍 [RAG] Matched "${best.question}" (${(bestScore * 100).toFixed(1)}%)`);
    return { found: true, question: best.question, answer: best.answer, score: bestScore };
  }

  console.log(`🔍 [RAG] No match above threshold (best ${(bestScore * 100).toFixed(1)}%)`);
  return { found: false };
}

function getIndexSize() {
  return policyKnowledgeBase.length;
}

function stopRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

module.exports = {
  initializeRAG,
  refreshRAG,
  findRelevantPolicy,
  getIndexSize,
  stopRefresh,
  cosineSimilarity,
};
