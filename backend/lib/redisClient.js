const { Redis } = require('@upstash/redis');
const config = require('../config');

/**
 * Upstash client, or null when credentials are absent. Every consumer must treat
 * null as "degraded but operational" rather than crashing — Redis holds sessions
 * and analytics, not anything the request path cannot survive without.
 */
const redis = config.redis.enabled
  ? new Redis({ url: config.redis.url, token: config.redis.token })
  : null;

if (!redis && !config.isTest) {
  console.warn('⚠️  Upstash Redis is not configured. Falling back to in-process storage.');
}

/**
 * Runs a Redis operation, returning `fallback` instead of throwing when Redis is
 * unavailable or errors. Keeps every call site from repeating the same try/catch.
 */
async function safeRedis(label, fn, fallback = null) {
  if (!redis) return fallback;
  try {
    return await fn(redis);
  } catch (err) {
    console.warn(`⚠️  Redis ${label} failed:`, err.message);
    return fallback;
  }
}

module.exports = { redis, safeRedis };
