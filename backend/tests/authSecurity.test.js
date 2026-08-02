process.env.LOGIN_MAX_ATTEMPTS = '3';
process.env.TOKEN_VERSION_CACHE_MS = '0'; // check every time, so tests are deterministic

const jwt = require('jsonwebtoken');
const config = require('../config');
const tokenVersions = require('../lib/tokenVersions');
const loginGuard = require('../lib/loginGuard');
const { verifyUserToken, signUserToken } = require('../middleware/auth');

const USER = { id: 'usr_test', email: 'a@b.co', name: 'Test' };

describe('Token versioning and revocation', () => {
  it('embeds the token version', () => {
    const decoded = jwt.decode(signUserToken(USER, 3));
    expect(decoded.v).toBe(3);
  });

  it('accepts a token whose version matches', async () => {
    const decoded = verifyUserToken(signUserToken(USER, 0));
    await expect(tokenVersions.isCurrent(decoded)).resolves.toBe(true);
  });

  it('rejects a token issued before a revocation', () => {
    const { isVersionCurrent } = tokenVersions;
    // Account revoked: stored version bumped to 5.
    expect(isVersionCurrent(4, 5)).toBe(false); // issued before the bump
    expect(isVersionCurrent(5, 5)).toBe(true); // issued after
    expect(isVersionCurrent(6, 5)).toBe(true);
  });

  it('keeps pre-feature tokens valid against a never-revoked account', () => {
    expect(tokenVersions.isVersionCurrent(undefined, 0)).toBe(true);
    expect(tokenVersions.isVersionCurrent(undefined, 1)).toBe(false);
  });

  it('treats a pre-feature token with no version as version 0', async () => {
    const legacy = jwt.sign({ id: USER.id, email: USER.email }, config.jwt.secret, {
      issuer: config.jwt.issuer,
    });
    await expect(tokenVersions.isCurrent(verifyUserToken(legacy))).resolves.toBe(true);
  });

  it('rejects a payload with no user id', async () => {
    await expect(tokenVersions.isCurrent({})).resolves.toBe(false);
    await expect(tokenVersions.isCurrent(null)).resolves.toBe(false);
  });

  it('still rejects a token signed with the wrong secret', () => {
    const forged = jwt.sign({ id: USER.id, v: 0 }, 'wrong-secret', { issuer: config.jwt.issuer });
    expect(verifyUserToken(forged)).toBeNull();
  });

  it('rejects a token with the wrong issuer', () => {
    const forged = jwt.sign({ id: USER.id, v: 0 }, config.jwt.secret, { issuer: 'somewhere-else' });
    expect(verifyUserToken(forged)).toBeNull();
  });
});

describe('Per-account login lockout', () => {
  const email = `lock-${Date.now()}@example.com`;

  afterEach(() => loginGuard.clearFailures(email));

  it('starts unlocked', async () => {
    await expect(loginGuard.checkLock(email)).resolves.toMatchObject({ locked: false });
  });

  it('locks the account after the configured number of failures', async () => {
    // The IP limiter cannot catch credential stuffing spread across a proxy
    // pool; this counter follows the account being attacked instead.
    for (let i = 0; i < loginGuard.MAX_ATTEMPTS; i += 1) {
      await loginGuard.recordFailure(email);
    }
    const result = await loginGuard.checkLock(email);
    expect(result.locked).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('clears the counter on a successful sign-in', async () => {
    for (let i = 0; i < loginGuard.MAX_ATTEMPTS; i += 1) {
      await loginGuard.recordFailure(email);
    }
    await loginGuard.clearFailures(email);
    await expect(loginGuard.checkLock(email)).resolves.toMatchObject({ locked: false });
  });

  it('keeps accounts independent', async () => {
    const other = `other-${Date.now()}@example.com`;
    for (let i = 0; i < loginGuard.MAX_ATTEMPTS; i += 1) {
      await loginGuard.recordFailure(email);
    }
    await expect(loginGuard.checkLock(other)).resolves.toMatchObject({ locked: false });
  });
});
