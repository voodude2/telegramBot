const config = require('../config');
const { redis } = require('../lib/redisClient');
const { LruCache } = require('../lib/lruCache');

/**
 * Fixed-window rate limiter.
 *
 * Backed by Redis so the limit holds across every instance behind the load
 * balancer; falls back to a bounded in-process counter when Redis is unavailable,
 * which still blunts a single-source flood.
 *
 * The chat endpoint is unauthenticated and calls Gemini, Mem0 and the embedding
 * API on every request, so an unmetered caller can run up a real bill. Login is
 * limited separately to slow credential stuffing.
 */

const localCounters = new LruCache({ max: 10000, ttlMs: 60 * 60 * 1000 });

function defaultKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

async function incrementRedis(key, windowSeconds) {
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expire(key, windowSeconds, 'NX'); // only sets a TTL on the first hit of the window
  const [count] = await pipe.exec();
  return Number(count) || 0;
}

function incrementLocal(key, windowSeconds) {
  const now = Date.now();
  const entry = localCounters.get(key);
  if (entry && entry.resetAt > now) {
    entry.count += 1;
    localCounters.set(key, entry);
    return entry.count;
  }
  localCounters.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
  return 1;
}

function rateLimit({ name, windowSeconds, max, keyFn = defaultKey }) {
  return async function rateLimitMiddleware(req, res, next) {
    if (config.isTest) return next();

    const window = Math.floor(Date.now() / 1000 / windowSeconds);
    const key = `ratelimit:${name}:${keyFn(req)}:${window}`;

    let count;
    try {
      count = redis ? await incrementRedis(key, windowSeconds) : incrementLocal(key, windowSeconds);
    } catch (err) {
      // Never let the limiter itself take the API down.
      console.warn(`⚠️  Rate limiter (${name}) failed open:`, err.message);
      return next();
    }

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - count));

    if (count > max) {
      res.setHeader('Retry-After', windowSeconds);
      return res.status(429).json({
        error: 'Too many requests. Please slow down and try again shortly.',
      });
    }
    next();
  };
}

const chatLimiter = rateLimit({ name: 'chat', ...config.rateLimits.chat });
const authLimiter = rateLimit({ name: 'auth', ...config.rateLimits.auth });
const apiLimiter = rateLimit({ name: 'api', ...config.rateLimits.api });

module.exports = { rateLimit, chatLimiter, authLimiter, apiLimiter };
