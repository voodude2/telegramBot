const config = require('../config');

/** Baseline security headers. Kept dependency-free; swap for helmet if you add it. */
function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // 'cross-origin', not 'same-site': this is a public API consumed by a frontend
  // on a different host. Render gives each service its own *.onrender.com
  // subdomain and onrender.com is a public suffix, so the two are not even
  // same-site. CORS is what governs access here; CORP must not second-guess it.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.removeHeader('X-Powered-By');
  next();
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

/**
 * Terminal error handler. Without one, Express renders an HTML error page and, when
 * NODE_ENV is not 'production', includes the stack trace in the response body — a
 * malformed JSON request body was enough to leak internals.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(`❌ [${req.method} ${req.path}]`, err);
  }

  if (res.headersSent) {
    // A streaming response already started; just close it.
    return res.end();
  }

  const body = { error: status >= 500 ? 'Internal server error' : err.message || 'Bad request' };
  if (!config.isProduction && status >= 500) body.detail = err.message;

  res.status(status).json(body);
}

module.exports = { securityHeaders, notFound, errorHandler };
