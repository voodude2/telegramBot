const crypto = require('crypto');
const config = require('../config');

/**
 * Signed anonymous chat-session identifiers.
 *
 * The chat endpoint used to trust whatever sessionId the client sent, which made
 * every conversation readable by anyone who could guess or observe an id —
 * including Telegram sessions, whose ids are just the chat number. Anonymous
 * sessions are now minted and signed server-side, so a caller can only ever
 * resume a session this server issued to them.
 *
 * Format: anon_<24 bytes base64url>.<truncated HMAC>
 */

const PREFIX = 'anon_';
const SIG_LENGTH = 32;

function sign(body) {
  return crypto
    .createHmac('sha256', config.sessionSigningKey)
    .update(body)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

function issueAnonymousSession() {
  const body = PREFIX + crypto.randomBytes(24).toString('base64url');
  return `${body}.${sign(body)}`;
}

function isValidAnonymousSession(token) {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) return false;

  const separator = token.lastIndexOf('.');
  if (separator <= PREFIX.length) return false;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (signature.length !== SIG_LENGTH) return false;

  const expected = Buffer.from(sign(body));
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return false;

  return crypto.timingSafeEqual(expected, provided);
}

/**
 * Resolves the session a chat request is allowed to touch.
 *
 * Precedence:
 *  1. An authenticated user always uses their own account id — a supplied
 *     sessionId is ignored, so a token holder cannot read someone else's thread.
 *  2. An anonymous caller may resume a session only if it carries our signature.
 *  3. Anything else gets a freshly issued session.
 *
 * @returns {{ sessionId: string, issued: boolean }} `issued` tells the caller to
 *   send the id back to the client so it can be stored for the next turn.
 */
function resolveSessionId({ user, requestedSessionId }) {
  if (user && user.id) {
    return { sessionId: String(user.id), issued: false };
  }
  if (isValidAnonymousSession(requestedSessionId)) {
    return { sessionId: requestedSessionId, issued: false };
  }
  return { sessionId: issueAnonymousSession(), issued: true };
}

module.exports = { issueAnonymousSession, isValidAnonymousSession, resolveSessionId };
