const config = require('../config');
const { redis, safeRedis } = require('../lib/redisClient');

/**
 * Usage analytics in Redis.
 *
 * Two things were costing real money here. First, every request re-issued EXPIRE
 * on all seven keys — Upstash bills per command, so that was seven wasted commands
 * per chat. TTLs are now set once per process per day (`expiryMarked`), which
 * costs nothing extra and is idempotent across instances and restarts.
 *
 * Second, cost was computed from hardcoded Gemini 1.5 Flash rates regardless of
 * which model actually ran, so the dashboard understated spend. Rates now come
 * from a per-model table in config.
 */

const KEY_GROUPS = ['chats', 'sessions', 'questions', 'tokens', 'models', 'platforms', 'tools'];
const MAX_QUESTIONS_PER_DAY = 500;

/** Tracks which day's TTLs this process has already applied. */
let expiryMarked = null;

function today() {
  return new Date().toISOString().split('T')[0];
}

function estimateCost(modelName, inputTokens, outputTokens) {
  const rate = config.pricing[modelName] || config.pricing.default;
  return (inputTokens || 0) * rate.input + (outputTokens || 0) * rate.output;
}

function track({
  sessionId,
  platform = 'unknown',
  userMessage,
  modelName,
  inputTokens = 0,
  outputTokens = 0,
  toolsUsed = [],
}) {
  if (!redis) return Promise.resolve();

  return safeRedis('analytics', async (r) => {
    const date = today();
    const pipe = r.pipeline();

    pipe.incr(`analytics:chats:${date}`);
    if (sessionId) pipe.sadd(`analytics:sessions:${date}`, sessionId);

    if (userMessage) {
      pipe.lpush(`analytics:questions:${date}`, userMessage.substring(0, 200));
      // Bound the list so a busy day cannot grow it without limit.
      pipe.ltrim(`analytics:questions:${date}`, 0, MAX_QUESTIONS_PER_DAY - 1);
    }

    if (inputTokens || outputTokens) {
      pipe.hincrby(`analytics:tokens:${date}`, 'input', inputTokens);
      pipe.hincrby(`analytics:tokens:${date}`, 'output', outputTokens);
      pipe.hincrbyfloat(
        `analytics:tokens:${date}`,
        'cost',
        estimateCost(modelName, inputTokens, outputTokens)
      );
    }

    if (modelName) pipe.hincrby(`analytics:models:${date}`, modelName, 1);
    pipe.hincrby(`analytics:platforms:${date}`, platform, 1);

    // Count each distinct tool once per turn, not once per invocation.
    for (const tool of new Set(toolsUsed)) {
      pipe.hincrby(`analytics:tools:${date}`, tool, 1);
    }

    if (expiryMarked !== date) {
      for (const group of KEY_GROUPS) {
        pipe.expire(`analytics:${group}:${date}`, config.limits.analyticsTtlSeconds);
      }
      expiryMarked = date;
    }

    await pipe.exec();
  });
}

function emptyStats(date) {
  return {
    totalChats: 0,
    uniqueSessions: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: '0.000000',
    platforms: {},
    date,
  };
}

async function getStats() {
  const date = today();
  if (!redis) return emptyStats(date);

  const result = await safeRedis('stats', async (r) => {
    const pipe = r.pipeline();
    pipe.get(`analytics:chats:${date}`);
    pipe.scard(`analytics:sessions:${date}`);
    pipe.hgetall(`analytics:tokens:${date}`);
    pipe.hgetall(`analytics:platforms:${date}`);
    return pipe.exec();
  });
  if (!result) return emptyStats(date);

  const [chats, sessions, tokens, platforms] = result;
  const input = parseInt(tokens?.input || 0, 10);
  const output = parseInt(tokens?.output || 0, 10);

  return {
    totalChats: parseInt(chats || 0, 10),
    uniqueSessions: parseInt(sessions || 0, 10),
    totalTokens: input + output,
    inputTokens: input,
    outputTokens: output,
    estimatedCost: parseFloat(tokens?.cost || 0).toFixed(6),
    platforms: platforms || {},
    date,
  };
}

async function getQuestions() {
  const date = today();
  if (!redis) return { questions: [], totalQuestions: 0, date };

  const rows =
    (await safeRedis('questions', (r) =>
      r.lrange(`analytics:questions:${date}`, 0, MAX_QUESTIONS_PER_DAY - 1)
    )) || [];

  const frequency = new Map();
  for (const row of rows) {
    const normalized = String(row).toLowerCase().trim();
    frequency.set(normalized, (frequency.get(normalized) || 0) + 1);
  }

  const questions = [...frequency.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([question, count]) => ({ question, count }));

  return { questions, totalQuestions: rows.length, date };
}

async function getCosts() {
  const date = today();
  const empty = { models: {}, tools: {}, tokens: { input: 0, output: 0, cost: '0.000000' }, date };
  if (!redis) return empty;

  const result = await safeRedis('costs', async (r) => {
    const pipe = r.pipeline();
    pipe.hgetall(`analytics:models:${date}`);
    pipe.hgetall(`analytics:tools:${date}`);
    pipe.hgetall(`analytics:tokens:${date}`);
    return pipe.exec();
  });
  if (!result) return empty;

  const [models, tools, tokens] = result;
  return {
    models: models || {},
    tools: tools || {},
    tokens: {
      input: parseInt(tokens?.input || 0, 10),
      output: parseInt(tokens?.output || 0, 10),
      cost: parseFloat(tokens?.cost || 0).toFixed(6),
    },
    date,
  };
}

/**
 * Seven-day rollup. Previously this issued 21 sequential round-trips and the
 * dashboard re-ran it every 30 seconds; it is now a single pipeline.
 */
async function getTimeline(days = 7) {
  if (!redis) return { timeline: [] };

  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    dates.push({ key: d.toISOString().split('T')[0], date: d });
  }

  const result = await safeRedis('timeline', async (r) => {
    const pipe = r.pipeline();
    for (const { key } of dates) {
      pipe.get(`analytics:chats:${key}`);
      pipe.scard(`analytics:sessions:${key}`);
      pipe.hgetall(`analytics:tokens:${key}`);
    }
    return pipe.exec();
  });
  if (!result) return { timeline: [] };

  const timeline = dates.map(({ key, date }, index) => {
    const [chats, sessions, tokens] = result.slice(index * 3, index * 3 + 3);
    return {
      date: key,
      label: date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      }),
      chats: parseInt(chats || 0, 10),
      sessions: parseInt(sessions || 0, 10),
      tokens: parseInt(tokens?.input || 0, 10) + parseInt(tokens?.output || 0, 10),
      cost: parseFloat(tokens?.cost || 0),
    };
  });

  return { timeline };
}

module.exports = { track, getStats, getQuestions, getCosts, getTimeline, estimateCost };
