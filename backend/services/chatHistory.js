const config = require('../config');
const { redis, safeRedis } = require('../lib/redisClient');
const { LruCache } = require('../lib/lruCache');
const memoryService = require('./memoryService');

/**
 * Conversation history: Redis-backed with a bounded in-process fallback.
 *
 * The fallback is capped by an LRU rather than an open Map — during a Redis
 * outage every active session would otherwise be retained forever, turning a
 * recoverable degradation into an out-of-memory crash.
 */
const fallbackStore = new LruCache({
  max: config.limits.inMemorySessions,
  ttlMs: config.limits.chatHistoryTtlSeconds * 1000,
});

const historyKey = (sessionId) => `chat_history:${sessionId}`;

async function getHistory(sessionId) {
  const stored = await safeRedis('history fetch', (r) => r.get(historyKey(sessionId)));
  if (Array.isArray(stored)) return stored;
  // Upstash normally deserialises JSON for us, but tolerate a raw string.
  if (typeof stored === 'string') {
    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to the local copy */
    }
  }
  return fallbackStore.get(sessionId) || [];
}

/** True when a history entry is a real user turn rather than a tool result. */
function isUserTurn(message) {
  return (
    message?.role === 'user' &&
    Array.isArray(message.parts) &&
    !message.parts.some((part) => part.functionResponse)
  );
}

function lastTextByRole(history, role) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message?.role !== role) continue;
    if (role === 'user' && !isUserTurn(message)) continue;

    const text = (message.parts || [])
      .filter((part) => part.text)
      .map((part) => part.text)
      .join(' ')
      .trim();
    if (text) return text;
  }
  return '';
}

/**
 * Trims to the configured turn budget, then drops any leading fragment that would
 * make the transcript invalid: Gemini rejects a history that starts with a model
 * message or with a functionResponse whose matching call has been cut away.
 */
function truncate(history) {
  const max = config.limits.chatHistoryTurns;
  if (history.length <= max) return history;

  const trimmed = history.slice(history.length - max);
  const firstValid = trimmed.findIndex(isUserTurn);
  if (firstValid === -1) return [];
  return trimmed.slice(firstValid);
}

async function saveHistory(sessionId, history) {
  const trimmed = truncate(Array.isArray(history) ? history : []);

  // Extract long-term facts from the exchange that just completed.
  memoryService.remember(
    sessionId,
    lastTextByRole(trimmed, 'user'),
    lastTextByRole(trimmed, 'model')
  );

  const saved = await safeRedis(
    'history save',
    async (r) => {
      await r.set(historyKey(sessionId), trimmed, { ex: config.limits.chatHistoryTtlSeconds });
      return true;
    },
    false
  );

  if (!saved) fallbackStore.set(sessionId, trimmed);
  return trimmed;
}

async function clearHistory(sessionId) {
  fallbackStore.delete(sessionId);
  if (redis) await safeRedis('history delete', (r) => r.del(historyKey(sessionId)));
}

/**
 * Removes fragments Gemini would reject with a 400. Kept separate from truncate()
 * because histories can also be left malformed by a crash mid tool-call, not just
 * by trimming.
 */
function sanitizeForModel(history, sessionId) {
  let cleaned = Array.isArray(history) ? [...history] : [];

  // A transcript must open on a user turn.
  while (cleaned.length > 0 && !isUserTurn(cleaned[0])) {
    cleaned.shift();
  }

  // A trailing functionCall with no response would be an unanswered tool call.
  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];
    if (last?.role === 'model' && last.parts?.some((part) => part.functionCall)) {
      cleaned.pop();
      console.warn(`⚠️  [${sessionId}] Dropped a dangling functionCall from history.`);
    } else {
      break;
    }
  }

  return cleaned;
}

module.exports = { getHistory, saveHistory, clearHistory, sanitizeForModel, truncate };
