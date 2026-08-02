const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const tokenVersions = require('../lib/tokenVersions');

function readBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * @param {object} user
 * @param {number} [tokenVersion] Embedded as `v`; bumping the account's stored
 *   version invalidates every token issued before the bump.
 */
function signUserToken(user, tokenVersion = 0) {
  return jwt.sign(
    { id: user.id, email: user.email, name: user.name, v: tokenVersion },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn, issuer: config.jwt.issuer }
  );
}

function verifyUserToken(token) {
  try {
    return jwt.verify(token, config.jwt.secret, { issuer: config.jwt.issuer });
  } catch {
    return null;
  }
}

/** Rejects the request unless it carries a valid, unrevoked user token. */
async function requireUser(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ error: 'No token provided' });

    const decoded = verifyUserToken(token);
    if (!decoded) return res.status(401).json({ error: 'Invalid or expired token' });

    if (!(await tokenVersions.isCurrent(decoded))) {
      return res.status(401).json({ error: 'Session has been revoked. Please sign in again.' });
    }

    req.user = decoded;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches req.user when a valid, unrevoked token is present, but never rejects.
 * Used by the chat endpoint, which serves both signed-in and anonymous visitors.
 */
async function optionalUser(req, _res, next) {
  try {
    const token = readBearerToken(req);
    if (token) {
      const decoded = verifyUserToken(token);
      if (decoded && (await tokenVersions.isCurrent(decoded))) req.user = decoded;
    }
  } catch (err) {
    // A revocation-check failure must not block an anonymous-capable endpoint.
    console.warn('⚠️  optionalUser check failed:', err.message);
  }
  next();
}

function safeEquals(a, b) {
  // Hash first so timingSafeEqual always receives equal-length buffers and the
  // comparison leaks neither the value nor its length.
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Admin gate. Fails CLOSED: a missing ADMIN_API_KEY denies access rather than
 * waving everyone through, so one unset environment variable can no longer expose
 * customer memories and cost data. Local development stays open, loudly.
 */
function requireAdmin(req, res, next) {
  if (!config.admin.apiKey) {
    if (config.isProduction) {
      return res.status(503).json({ error: 'Admin API is not configured' });
    }
    console.warn('⚠️  ADMIN_API_KEY is unset — admin route allowed because NODE_ENV is not production.');
    return next();
  }

  const token = readBearerToken(req);
  if (!token || !safeEquals(token, config.admin.apiKey)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireUser, optionalUser, requireAdmin, signUserToken, verifyUserToken };
