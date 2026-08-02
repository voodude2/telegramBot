const express = require('express');
const config = require('../config');
const { processAIChat } = require('../services/aiChat');
const { resolveSessionId, issueAnonymousSession } = require('../lib/sessions');
const { optionalUser } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimit');

const router = express.Router();

/** Lets a client obtain a signed session up front rather than on first message. */
router.get('/session', (_req, res) => {
  res.json({ sessionId: issueAnonymousSession() });
});

/**
 * Streaming chat endpoint (Server-Sent Events).
 *
 * The session is resolved server-side from the bearer token or from a signed
 * anonymous id. It is never read straight from the request body: doing so let
 * anyone pass someone else's id — including a Telegram session, whose id is just
 * the chat number — and read or continue that conversation.
 */
router.post('/', chatLimiter, optionalUser, async (req, res) => {
  const { message, sessionId: requested, media, cart } = req.body || {};

  if (!message && !media) {
    return res.status(400).json({ error: 'Message or media is required' });
  }

  const mediaPayload = media?.inlineData || media;
  if (mediaPayload?.data && mediaPayload.data.length > config.limits.maxMediaBytes * 1.4) {
    return res.status(413).json({ error: 'Attached media is too large' });
  }

  const { sessionId, issued } = resolveSessionId({
    user: req.user,
    requestedSessionId: requested,
  });

  // The display name comes from the verified token, not the request body — it is
  // interpolated into the system prompt, so a client-supplied value was a direct
  // prompt-injection channel.
  const userName = req.user?.name || null;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // stop Render's proxy buffering the stream
  res.flushHeaders();

  // Abort the model run when the browser goes away, instead of streaming into a
  // dead socket and paying for tokens nobody will read.
  const controller = new AbortController();
  let closed = false;
  req.on('close', () => {
    closed = true;
    controller.abort();
  });

  const send = (payload) => {
    if (closed || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  // Tell the client which session this is so it can resume the thread next time.
  if (issued) send({ sessionId });

  try {
    const result = await processAIChat({
      sessionId,
      userMessage: message || 'What is in this photo?',
      platform: 'web',
      media,
      userName,
      // Display context so the agent can act on the cart. Sanitised downstream;
      // the cart lives in the browser, so this is the only way to see it.
      cart,
      signal: controller.signal,
      onChunk: (text) => send({ text }),
      onReset: () => send({ reset: true }),
    });

    if (result.aborted) return res.end();

    send({ done: true, actions: result.actions, finalReply: result.reply, sessionId });
  } catch (err) {
    console.error('❌ [POST /api/chat]', err);
    send({ error: 'Failed to process AI chat request' });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
