const { redis, safeRedis } = require('./redisClient');
const { LruCache } = require('./lruCache');

/**
 * Token revocation for stateless JWTs.
 *
 * A JWT is valid until it expires, so before this there was no way to end a
 * session early — a stolen token stayed usable for the full 7 days, and there
 * was no "sign out of all devices".
 *
 * Each token carries the account's token version. Bumping the stored version
 * invalidates every token issued before the bump, without any per-token
 * bookkeeping.
 *
 * The version is cached in-process for a few seconds so the common case costs no
 * Redis round-trip. Revocation therefore takes effect within CACHE_TTL_MS rather
 * than instantly — the right trade for an endpoint on the hot path. Drop the TTL
 * to 0 if you need immediate revocation more than you need the latency.
 */

const CACHE_TTL_MS = parseInt(process.env.TOKEN_VERSION_CACHE_MS, 10) || 5000;

const cache = new LruCache({ max: 5000, ttlMs: CACHE_TTL_MS });

const key = (userId) => `token_version:${userId}`;

/** Current version for an account. 0 means "never revoked". */
async function getVersion(userId) {
  const cached = cache.get(userId);
  if (cached !== undefined) return cached;

  const stored = await safeRedis('token version', (r) => r.get(key(userId)), 0);
  const version = Number(stored) || 0;
  cache.set(userId, version);
  return version;
}

/** Invalidates every token issued for this account so far. */
async function revokeAll(userId) {
  if (!redis) return false;
  const next = await safeRedis('token revoke', (r) => r.incr(key(userId)), null);
  if (next === null) return false;
  cache.set(userId, Number(next));
  return true;
}

/**
 * The revocation rule, as a pure function so it can be tested without Redis.
 *
 * Tokens issued before this feature existed carry no version and are treated as
 * version 0, so they keep working until they expire naturally rather than
 * logging every existing user out on deploy.
 */
function isVersionCurrent(tokenVersion, storedVersion) {
  return (Number(tokenVersion) || 0) >= (Number(storedVersion) || 0);
}

/** True when the version embedded in a token is still current for the account. */
async function isCurrent(payload) {
  if (!payload?.id) return false;
  return isVersionCurrent(payload.v, await getVersion(payload.id));
}

module.exports = { getVersion, revokeAll, isCurrent, isVersionCurrent, CACHE_TTL_MS };
