const { redis, safeRedis } = require('../lib/redisClient');
const { LruCache } = require('./lruCache');

/**
 * Per-account brute-force protection.
 *
 * The IP rate limiter alone is not enough: credential stuffing is run from a
 * botnet or a proxy pool, so every attempt against one account arrives from a
 * different address and no per-IP counter ever trips. This counts failures
 * against the ACCOUNT, which is the thing actually under attack.
 *
 * Lockout is temporary and failures are cleared on a successful login, so a user
 * who simply mistyped their password is never locked out for long. A permanent
 * lock would hand attackers a denial-of-service against any account whose email
 * they know.
 */

const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 8;
const LOCKOUT_SECONDS = parseInt(process.env.LOGIN_LOCKOUT_SECONDS, 10) || 900;

// Fallback when Redis is unavailable, so the control degrades rather than vanishing.
const localAttempts = new LruCache({ max: 5000, ttlMs: LOCKOUT_SECONDS * 1000 });

const key = (email) => `login_attempts:${email}`;

async function getFailures(email) {
  if (!redis) return localAttempts.get(email)?.count || 0;
  const value = await safeRedis('login attempts', (r) => r.get(key(email)), 0);
  return Number(value) || 0;
}

/**
 * @returns {Promise<{ locked: boolean, retryAfter: number }>}
 */
async function checkLock(email) {
  const failures = await getFailures(email);
  if (failures < MAX_ATTEMPTS) return { locked: false, retryAfter: 0 };

  const ttl = redis
    ? await safeRedis('login ttl', (r) => r.ttl(key(email)), LOCKOUT_SECONDS)
    : LOCKOUT_SECONDS;

  return { locked: true, retryAfter: ttl > 0 ? ttl : LOCKOUT_SECONDS };
}

async function recordFailure(email) {
  if (!redis) {
    const entry = localAttempts.get(email) || { count: 0 };
    entry.count += 1;
    localAttempts.set(email, entry);
    return;
  }

  await safeRedis('login failure', async (r) => {
    const pipe = r.pipeline();
    pipe.incr(key(email));
    // NX so the window starts at the first failure and is not extended by
    // later ones — otherwise an attacker could keep an account locked forever.
    pipe.expire(key(email), LOCKOUT_SECONDS, 'NX');
    await pipe.exec();
  });
}

async function clearFailures(email) {
  localAttempts.delete(email);
  if (redis) await safeRedis('login reset', (r) => r.del(key(email)));
}

module.exports = { checkLock, recordFailure, clearFailures, MAX_ATTEMPTS, LOCKOUT_SECONDS };
