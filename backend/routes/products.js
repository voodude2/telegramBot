const express = require('express');
const { getProducts, getProductById } = require('../services/googleSheets');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    res.json(await getProducts(req.query.refresh === 'true'));
  } catch (err) {
    next(err);
  }
});

// Bypasses the cache and hits the Sheets API, so it is admin-gated rather than
// open — it was previously an unauthenticated way to force upstream traffic.
router.post('/refresh', requireAdmin, async (_req, res, next) => {
  try {
    const products = await getProducts(true);
    res.json({ message: 'Cache refreshed successfully', count: products.length, products });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const product = await getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
