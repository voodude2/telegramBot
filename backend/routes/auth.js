const crypto = require('crypto');
const express = require('express');
const { redis } = require('../lib/redisClient');
const password = require('../lib/password');
const { requireUser, signUserToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');
const loginGuard = require('../lib/loginGuard');
const tokenVersions = require('../lib/tokenVersions');

const router = express.Router();

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Emails are the account key, so they must normalise to exactly one form.
 * Without this, Alex@x.com and alex@x.com registered as two separate accounts.
 */
function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function userKey(email) {
  return `user:${email}`;
}

async function readUser(email) {
  const raw = await redis.get(userKey(email));
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/** Never let a hash or any other internal field reach the client. */
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name };
}

function validateCredentials({ email, password: pw, name, requireName }) {
  if (!email || !pw || (requireName && !name)) return 'All fields are required';
  if (!EMAIL_PATTERN.test(email)) return 'Please provide a valid email address';
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (pw.length > MAX_PASSWORD_LENGTH) return 'Password is too long';
  return null;
}

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const pw = String(req.body?.password || '');
    const name = String(req.body?.name || '').trim().slice(0, 80);

    // Validate before touching storage so a bad request is a 400 regardless of
    // whether Redis happens to be reachable.
    const invalid = validateCredentials({ email, password: pw, name, requireName: true });
    if (invalid) return res.status(400).json({ error: invalid });

    if (!redis) return res.status(503).json({ error: 'Account storage is not configured' });

    const user = {
      // crypto.randomUUID, not Math.random — account ids are security-relevant.
      id: `usr_${crypto.randomUUID()}`,
      email,
      name,
      passwordHash: await password.hash(pw),
      createdAt: new Date().toISOString(),
    };

    // Atomic create. The old check-then-set had an await between the existence
    // check and the write, so two concurrent signups for the same address both
    // passed the check and the second silently overwrote the first.
    const created = await redis.set(userKey(email), JSON.stringify(user), { nx: true });
    if (!created) {
      // Deliberately vague. A distinct "Email already registered" turns this
      // endpoint into an account-enumeration oracle: anyone can test an address
      // list and learn who holds an account here. The wording still tells a
      // genuine returning user what to do.
      return res.status(409).json({
        error: 'That email cannot be registered. If you already have an account, please sign in.',
      });
    }

    await redis.set(`userId:${user.id}`, email);

    // A brand-new account starts at version 0; reading it also covers the case
    // where an id is somehow reused after a revocation.
    const version = await tokenVersions.getVersion(user.id);
    res.status(201).json({ token: signUserToken(user, version), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const pw = String(req.body?.password || '');
    if (!email || !pw) return res.status(400).json({ error: 'Email and password required' });

    if (!redis) return res.status(503).json({ error: 'Account storage is not configured' });

    // Per-account lockout, checked before any password work is done.
    const { locked, retryAfter } = await loginGuard.checkLock(email);
    if (locked) {
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Too many failed sign-in attempts. Please try again later.',
      });
    }

    const user = await readUser(email);
    if (!user) {
      await loginGuard.recordFailure(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const { valid, needsRehash } = await password.verify(pw, user.passwordHash);
    if (!valid) {
      await loginGuard.recordFailure(email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // A legitimate user got in, so the mistyped-password counter resets.
    await loginGuard.clearFailures(email);

    // Transparently migrate legacy bcrypt records to scrypt on successful login.
    if (needsRehash) {
      try {
        user.passwordHash = await password.hash(pw);
        await redis.set(userKey(email), JSON.stringify(user));
      } catch (err) {
        console.warn('⚠️  Could not upgrade password hash:', err.message);
      }
    }

    const version = await tokenVersions.getVersion(user.id);
    res.json({ token: signUserToken(user, version), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: { id: req.user.id, email: req.user.email, name: req.user.name } });
});

/**
 * Signs the account out everywhere by bumping its token version, invalidating
 * every token issued so far. This is the remedy if a token is ever exposed —
 * previously a leaked token stayed valid for its full 7-day lifetime.
 */
router.post('/logout-all', requireUser, async (req, res, next) => {
  try {
    const revoked = await tokenVersions.revokeAll(req.user.id);
    if (!revoked) {
      return res.status(503).json({ error: 'Session revocation is unavailable' });
    }
    res.json({ message: 'All sessions signed out. Please sign in again.' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
