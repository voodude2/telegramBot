const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Password hashing built on node's native scrypt.
 *
 * bcryptjs is a pure-JavaScript implementation, so every hash burns ~100ms of
 * *synchronous* CPU and stalls the event loop for every other in-flight request,
 * including live AI streams. crypto.scrypt runs on the libuv threadpool, so it
 * costs the same CPU without blocking, and needs no native build step on Render.
 *
 * Existing bcrypt hashes stay valid: verify() detects them, checks them with
 * bcryptjs, and reports that the record should be re-hashed on next login.
 */

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const SALT_BYTES = 16;
const PREFIX = 'scrypt';

function scryptAsync(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(
      password,
      salt,
      SCRYPT_PARAMS.keylen,
      { N: SCRYPT_PARAMS.N, r: SCRYPT_PARAMS.r, p: SCRYPT_PARAMS.p },
      (err, derived) => (err ? reject(err) : resolve(derived))
    );
  });
}

async function hash(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scryptAsync(password, salt);
  const { N, r, p } = SCRYPT_PARAMS;
  return `${PREFIX}$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function isLegacyBcrypt(stored) {
  return typeof stored === 'string' && /^\$2[aby]?\$/.test(stored);
}

/**
 * @returns {Promise<{ valid: boolean, needsRehash: boolean }>}
 */
async function verify(password, stored) {
  if (typeof stored !== 'string' || stored.length === 0) {
    return { valid: false, needsRehash: false };
  }

  if (isLegacyBcrypt(stored)) {
    const valid = await bcrypt.compare(password, stored);
    return { valid, needsRehash: valid };
  }

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return { valid: false, needsRehash: false };
  }

  const [, N, r, p, saltB64, hashB64] = parts;
  let derived;
  try {
    derived = await new Promise((resolve, reject) => {
      crypto.scrypt(
        password,
        Buffer.from(saltB64, 'base64'),
        Buffer.from(hashB64, 'base64').length,
        { N: Number(N), r: Number(r), p: Number(p) },
        (err, out) => (err ? reject(err) : resolve(out))
      );
    });
  } catch {
    return { valid: false, needsRehash: false };
  }

  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== derived.length) return { valid: false, needsRehash: false };

  const valid = crypto.timingSafeEqual(expected, derived);
  const stale = Number(N) !== SCRYPT_PARAMS.N || Number(r) !== SCRYPT_PARAMS.r;
  return { valid, needsRehash: valid && stale };
}

module.exports = { hash, verify };
