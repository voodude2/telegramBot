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

  // `expose` marks an error we raised deliberately to describe a known
  // operational state (e.g. "Google Sheets is not configured"). Those carry a
  // useful, safe message and are not bugs, so they are logged as one-line
  // warnings rather than stack traces, and the reason reaches the caller —
  // otherwise an admin sees "Internal server error" and has nothing to act on.
  const isOperational = err.expose === true;

  if (status >= 500 && !isOperational) {
    console.error(`❌ [${req.method} ${req.path}]`, err);
  } else if (status >= 500) {
    console.warn(`⚠️  [${req.method} ${req.path}] ${err.message}`);
  }

  if (res.headersSent) {
    // A streaming response already started; just close it.
    return res.end();
  }

  const safeToShow = status < 500 || isOperational;
  const body = { error: safeToShow ? err.message || 'Bad request' : 'Internal server error' };
  if (!config.isProduction && !safeToShow) body.detail = err.message;

  res.status(status).json(body);
}

module.exports = { securityHeaders, notFound, errorHandler };
