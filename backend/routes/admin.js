const express = require('express');
const analytics = require('../services/analytics');
const memoryService = require('../services/memoryService');
const { refreshRAG, getIndexSize } = require('../services/ragService');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route below is admin-gated. requireAdmin fails closed when
// ADMIN_API_KEY is unset in production.
router.use(requireAdmin);

// Catalogue management (create/update/delete), admin-gated by the line above.
router.use('/products', require('./adminProducts'));

router.get('/stats', async (_req, res, next) => {
  try {
    res.json(await analytics.getStats());
  } catch (err) {
    next(err);
  }
});

router.get('/questions', async (_req, res, next) => {
  try {
    res.json(await analytics.getQuestions());
  } catch (err) {
    next(err);
  }
});

router.get('/costs', async (_req, res, next) => {
  try {
    res.json(await analytics.getCosts());
  } catch (err) {
    next(err);
  }
});

router.get('/timeline', async (_req, res, next) => {
  try {
    res.json(await analytics.getTimeline());
  } catch (err) {
    next(err);
  }
});

router.get('/memories', async (_req, res, next) => {
  try {
    res.json(await memoryService.listAll());
  } catch (err) {
    next(err);
  }
});

router.delete('/memories', async (_req, res, next) => {
  try {
    await memoryService.clearAll();
    res.json({ message: 'Memories cleared successfully' });
  } catch (err) {
    next(err);
  }
});

// Re-index the policy sheet without a redeploy.
router.post('/rag/refresh', async (_req, res, next) => {
  try {
    res.json({ message: 'Knowledge base reindexed', policies: await refreshRAG() });
  } catch (err) {
    next(err);
  }
});

router.get('/health', (_req, res) => {
  const config = require('../config');
  res.json({
    ragPolicies: getIndexSize(),
    mem0: memoryService.isEnabled,
    redis: config.redis.enabled,
    sheets: Boolean(config.google.serviceAccountEmail && config.google.spreadsheetId),
    models: config.gemini.candidateModels,
    locales: config.locales.enabled,
    uiLocale: config.locales.uiCode,
    uptimeSeconds: Math.round(process.uptime()),
    nodeEnv: config.NODE_ENV,
  });
});

module.exports = router;
