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
app.use(
  cors({
    origin: allowAllOrigins ? '*' : config.corsOrigins,
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
