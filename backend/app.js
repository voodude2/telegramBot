const express = require('express');
const cors = require('cors');
const config = require('./config');
const { securityHeaders, notFound, errorHandler } = require('./middleware/errors');
const { apiLimiter } = require('./middleware/rateLimit');
const { getIndexSize } = require('./services/ragService');

const app = express();

// Render terminates TLS at its proxy; without this req.ip is the proxy address
// and every client shares one rate-limit bucket.
app.set('trust proxy', 1);

const allowAllOrigins = config.corsOrigins.includes('*');
console.log(
  `🌐 CORS allowlist: ${allowAllOrigins ? '* (all origins)' : config.corsOrigins.join(', ')}`
);

/**
 * A rejected origin produces a response with no Access-Control-Allow-Origin, which
 * the browser blocks *silently* — the server sees a normal 200 and logs nothing.
 * That made a FRONTEND_URL typo undiagnosable from the logs, so every distinct
 * rejected origin is reported once here.
 */
const reportedOrigins = new Set();
app.use(
  cors({
    origin(origin, callback) {
      // No Origin header: same-origin, curl, or a server-to-server call.
      if (!origin) return callback(null, true);
      if (allowAllOrigins) return callback(null, true);

      const normalized = config.normalizeOrigin(origin);
      if (config.isOriginAllowed(normalized)) return callback(null, true);

      if (!reportedOrigins.has(normalized)) {
        reportedOrigins.add(normalized);
        console.warn(
          `⛔ CORS: blocked origin "${normalized}". ` +
            `FRONTEND_URL currently allows: ${config.corsOrigins.join(', ')}. ` +
            `If that origin is your frontend, add it to FRONTEND_URL.`
        );
      }
      // Resolve false rather than erroring: the request still completes without
      // the CORS header, which is what the browser expects for a denial.
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  })
);

app.use(securityHeaders);
app.use(express.json({ limit: `${config.limits.jsonBodyMb}mb` }));
app.use(express.urlencoded({ limit: `${config.limits.jsonBodyMb}mb`, extended: true }));

app.get('/', (_req, res) => {
  res.send({ status: 'E-commerce Backend API is running' });
});

app.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    uptime: Math.round(process.uptime()),
    redis: config.redis.enabled,
    ragPolicies: getIndexSize(),
  });
});

app.use('/api', apiLimiter);
app.use('/api/products', require('./routes/products'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/chat', require('./routes/chat'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
