const express = require('express');
const analytics = require('../services/analytics');
const memoryService = require('../services/memoryService');
const { refreshRAG, getIndexSize } = require('../services/ragService');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Every route below is admin-gated. requireAdmin fails closed when
// ADMIN_API_KEY is unset in production.
router.use(requireAdmin);

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
  res.json({ ragPolicies: getIndexSize(), mem0: memoryService.isEnabled });
});

module.exports = router;
