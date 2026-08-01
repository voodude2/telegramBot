const { MemoryClient } = require('mem0ai');
const config = require('../config');

/**
 * Mem0 Cloud wrapper for long-term user profiles.
 *
 * NOTE ON A PREVIOUSLY SILENT BUG: MemoryClient#search resolves to
 * `{ results: Memory[] }`, not a bare array. The old call site tested
 * `results.length > 0`, which is always false on an object, so no remembered fact
 * ever reached a prompt. Normalising the shape in one place here is what stops
 * that class of mistake recurring — every consumer now gets a plain array.
 */

const client = config.mem0.apiKey ? new MemoryClient({ apiKey: config.mem0.apiKey }) : null;

if (!client && !config.isTest) {
  console.warn('⚠️  MEM0_API_KEY is not set. Long-term memory is disabled.');
}

const APP_ID = config.mem0.appId;

/** Mem0 returns either `{ results: [...] }` or a bare array depending on the call. */
function toArray(response) {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.results)) return response.results;
  return [];
}

function textOf(memory) {
  return memory?.memory || memory?.content || memory?.text || null;
}

/**
 * Facts relevant to the current message, as plain strings.
 * Never throws — memory is an enhancement, not a dependency of the chat path.
 */
async function recall(sessionId, query, { limit = 8 } = {}) {
  if (!client || !query) return [];
  try {
    const response = await client.search(query, {
      filters: { user_id: sessionId, app_id: APP_ID },
      topK: limit,
    });
    return toArray(response).map(textOf).filter(Boolean);
  } catch (err) {
    console.warn(`⚠️  [${sessionId}] Mem0 search failed:`, err.message);
    return [];
  }
}

/**
 * Queues fact extraction for a completed exchange. Fire-and-forget by design so
 * the reply is never held up, but the rejection is always handled.
 */
function remember(sessionId, userText, assistantText) {
  if (!client || !userText || !assistantText) return;
  client
    .add(
      [
        { role: 'user', content: userText },
        { role: 'assistant', content: assistantText },
      ],
      { user_id: sessionId, app_id: APP_ID }
    )
    .catch((err) => console.warn(`⚠️  [${sessionId}] Mem0 extraction failed:`, err.message));
}

async function listAll() {
  if (!client) return [];
  return toArray(await client.getAll({ filters: { app_id: APP_ID } }));
}

async function clearAll() {
  if (!client) return { message: 'Mem0 is not configured' };
  return client.deleteAll({ app_id: APP_ID });
}

module.exports = { recall, remember, listAll, clearAll, isEnabled: Boolean(client) };
